// image.ingest (тикет 06): job {itemId, imageUrl} → скачать фото товара
// через safeFetch (единственная точка исходящих запросов — инвариант №6,
// image/* и ≤5 МБ внутри) → положить в S3 ключом items/{roomId}/{random}.{ext}
// → записать photoKey вещи, ЕСЛИ он ещё пуст (своё фото приоритетнее).
//
// Обработчик — чистая функция processImageIngest с сетевыми/хранилищными
// швами: тестируется напрямую, воркер (index.ts) лишь регистрирует её.
//
// TODO(тикет 16): resize ≤1600px + AVIF/WebP. sharp сознательно НЕ в
// зависимостях Phase 1 — кладём оригинал как есть (≤5 МБ гарантирует safeFetch).

import type { Buffer } from "node:buffer";
import { revalidateTag } from "next/cache";
import { z } from "zod";
import { prisma } from "../server/db";
import { safeFetch, SafeFetchError } from "../server/parser";
import type { LookupFn, SafeFetchErrorCode } from "../server/parser";
import { putObjectViaPresign } from "../server/s3";
import { newItemPhotoKey, roomCacheTag } from "../server/services/items";

/** Картинки качаем спокойнее, чем HTML: 10 с вместо парсерных 3 с. */
const IMAGE_FETCH_TIMEOUT_MS = 10_000;

const jobSchema = z.object({
  itemId: z.string().min(1),
  imageUrl: z.url(),
});

/** Эти ошибки могут пройти при повторе — джобе даём упасть (BullMQ attempts). */
const TRANSIENT_FETCH_CODES: ReadonlySet<SafeFetchErrorCode> = new Set([
  "timeout",
  "network",
  "dns-error",
]);

export type ImageIngestSkipReason =
  | "bad-data" // мусор вместо {itemId, imageUrl}
  | "item-missing" // вещь удалили, пока джоба ждала
  | "photo-exists" // у вещи уже есть фото (пользовательское — приоритетнее)
  | "not-image" // content-type не растровый (SVG сюда же — XSS-заслон)
  | "fetch-failed"; // SSRF-блок, 4xx, пустое тело — повтор не поможет

export type ImageIngestResult =
  | { status: "stored"; photoKey: string }
  | { status: "skipped"; reason: ImageIngestSkipReason };

export interface ImageIngestDeps {
  /** Сетевые швы safeFetch — в тестах реальная сеть не дёргается. */
  fetchImpl?: typeof fetch;
  lookupImpl?: LookupFn;
  /** Шов хранилища; по умолчанию — pre-signed PUT в S3/MinIO (src/server/s3). */
  putObject?: (key: string, body: Buffer, contentType: string) => Promise<void>;
}

/**
 * Оригинал в S3 через pre-signed PUT — тот же путь, что у фото из браузера.
 * Сама запись живёт в src/server/s3 (единая точка работы с хранилищем);
 * здесь остался только порядок аргументов шва putObject.
 */
async function putViaPresign(key: string, body: Buffer, contentType: string): Promise<void> {
  await putObjectViaPresign(key, contentType, body);
}

/**
 * Обработчик джобы image.ingest. Возвращает результат вместо исключения для
 * всех «окончательных» исходов (job completed, повторы не нужны); бросает
 * только на переходных ошибках (таймаут/сеть/5xx/хранилище) — их доиграет
 * BullMQ по attempts. Гонка с пользовательским фото решается условным
 * update'ом: photoKey пишется только если всё ещё NULL.
 */
export async function processImageIngest(
  data: unknown,
  deps: ImageIngestDeps = {},
): Promise<ImageIngestResult> {
  const job = jobSchema.safeParse(data);
  if (!job.success) return { status: "skipped", reason: "bad-data" };
  const { itemId, imageUrl } = job.data;

  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { roomId: true, photoKey: true },
  });
  if (!item) return { status: "skipped", reason: "item-missing" };
  if (item.photoKey) return { status: "skipped", reason: "photo-exists" };

  let response;
  try {
    response = await safeFetch(imageUrl, {
      accept: "image",
      timeoutMs: IMAGE_FETCH_TIMEOUT_MS,
      fetchImpl: deps.fetchImpl,
      lookupImpl: deps.lookupImpl,
    });
  } catch (error) {
    if (error instanceof SafeFetchError && !TRANSIENT_FETCH_CODES.has(error.code)) {
      // SSRF-блок, чужой content-type, >5 МБ — навсегда; повторять нечего.
      return { status: "skipped", reason: "fetch-failed" };
    }
    throw error;
  }
  if (!response.ok || !response.body || response.body.byteLength === 0) {
    if (response.status >= 500) {
      throw new Error(`image.ingest: магазин ответил ${response.status} — повторим`);
    }
    return { status: "skipped", reason: "fetch-failed" };
  }

  const contentType = (response.contentType?.split(";")[0] ?? "").trim().toLowerCase();
  const photoKey = newItemPhotoKey(item.roomId, contentType);
  if (!photoKey) return { status: "skipped", reason: "not-image" };

  await (deps.putObject ?? putViaPresign)(photoKey, response.body, contentType);

  // Только если фото всё ещё нет: пользовательское фото, успевшее за время
  // скачивания, не перетираем (его ключ остаётся; наш объект — сирота в S3,
  // мусор уберёт чистка тикета 14/16).
  const updated = await prisma.item.updateMany({
    where: { id: itemId, photoKey: null },
    data: { photoKey },
  });
  if (updated.count === 0) return { status: "skipped", reason: "photo-exists" };

  try {
    // Кэш комнаты: в связке app+worker на одном кэш-сторе тег протухнет сразу;
    // без общего стора гостевая страница дождётся штатной ревалидации.
    revalidateTag(roomCacheTag(item.roomId), "max");
  } catch {
    // вне request-scope Next (отдельный процесс воркера) — сознательно молчим
  }

  return { status: "stored", photoKey };
}
