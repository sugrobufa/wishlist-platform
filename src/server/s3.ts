// S3/MinIO — единая точка работы с хранилищем (тикет 04; аватар тикета 13
// ходит через этот же модуль). Клиент собирается из env (.env.example):
// S3_ENDPOINT (dev — MinIO из docker-compose), S3_ACCESS_KEY, S3_SECRET_KEY,
// S3_BUCKET. Для MinIO обязателен forcePathStyle: бакет в пути, не в поддомене.
//
// Свежий MinIO пуст — бакета нет, поэтому каждый вход в модуль проходит через
// ensureBucket(): HeadBucket → CreateBucket при 404 (результат мемоизируется
// на процесс, гонка параллельных создающих гасится BucketAlreadyOwnedByYou).
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const PRESIGN_TTL_SECONDS = 300;

let client: S3Client | null = null;

/** Ленивый singleton: env читается при первом обращении, не при импорте. */
function s3(): S3Client {
  if (!client) {
    const endpoint = process.env.S3_ENDPOINT || undefined;
    client = new S3Client({
      region: process.env.S3_REGION || "us-east-1",
      endpoint,
      // MinIO не умеет virtual-hosted бакеты на localhost — только путь.
      forcePathStyle: Boolean(endpoint),
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY ?? "",
        secretAccessKey: process.env.S3_SECRET_KEY ?? "",
      },
    });
  }
  return client;
}

function s3Bucket(): string {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) throw new Error("s3: S3_BUCKET не задан (см. .env.example)");
  return bucket;
}

// ---------- Бакет ----------

const ensured = new Map<string, Promise<void>>();

/**
 * Гарантирует существование бакета (по умолчанию — S3_BUCKET). Успех
 * мемоизируется на процесс; неудача — нет, следующий вызов попробует снова.
 */
export function ensureBucket(bucket: string = s3Bucket()): Promise<void> {
  let pending = ensured.get(bucket);
  if (!pending) {
    pending = createBucketIfMissing(bucket);
    pending.catch(() => ensured.delete(bucket));
    ensured.set(bucket, pending);
  }
  return pending;
}

async function createBucketIfMissing(bucket: string): Promise<void> {
  try {
    await s3().send(new HeadBucketCommand({ Bucket: bucket }));
    return;
  } catch (error) {
    if (!isMissingBucket(error)) throw error;
  }
  try {
    await s3().send(new CreateBucketCommand({ Bucket: bucket }));
  } catch (error) {
    // Параллельный процесс успел первым — это успех, а не ошибка.
    if (errorName(error) !== "BucketAlreadyOwnedByYou") throw error;
  }
}

// ---------- Загрузка (pre-signed PUT) ----------

/**
 * Pre-signed PUT для прямой загрузки из браузера, срок жизни 5 минут.
 *
 * PUT-подпись не умеет ограничения «не больше N байт» (диапазон умеет только
 * POST-policy), поэтому подписываем ТОЧНЫЙ Content-Length: вызывающий экшен
 * валидирует заявленный размер против своего лимита (≤10 МБ у фото вещи),
 * а хранилище не примет тело другой длины или другого Content-Type —
 * оба заголовка входят в подпись.
 */
export async function presignPut(
  key: string,
  contentType: string,
  contentLength: number,
): Promise<string> {
  if (!Number.isInteger(contentLength) || contentLength <= 0) {
    throw new Error("s3.presignPut: contentLength должен быть положительным целым");
  }
  await ensureBucket();
  return getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: s3Bucket(),
      Key: key,
      ContentType: contentType,
      ContentLength: contentLength,
    }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  );
}

/**
 * Положить объект в S3 ТЕМ ЖЕ путём, каким его кладёт браузер: подписываем
 * PUT и ходим по подписанному адресу. Отдельного «серверного» способа записи
 * в хранилище нет намеренно — иначе у фото вещи было бы два разных пути
 * загрузки с разными правилами (лимит, Content-Type, форма ключа).
 *
 * Кто зовёт: воркер image.ingest (фото магазина, тикет 06) и посев стенда
 * (тикет 61). Оба сначала берут ключ у newItemPhotoKey — своей формы ключа
 * здесь не изобретается.
 */
export async function putObjectViaPresign(
  key: string,
  contentType: string,
  body: Uint8Array,
): Promise<void> {
  const url = await presignPut(key, contentType, body.byteLength);
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": contentType },
    // Buffer/Uint8Array формально не BodyInit в свежих lib.dom — сужаем,
    // как в tests/parser/testUtils.
    body: body as unknown as BodyInit,
  });
  if (!response.ok) {
    throw new Error(`s3.putObjectViaPresign: PUT ${key} ответил ${response.status}`);
  }
}

// ---------- Чтение (стрим для маршрута раздачи /media/…) ----------

export type S3ObjectStream = {
  stream: ReadableStream<Uint8Array>;
  contentType: string | null;
  contentLength: number | null;
};

/** Объект по ключу веб-стримом; null — ключа (или ещё и бакета) нет. */
export async function getObjectStream(key: string): Promise<S3ObjectStream | null> {
  await ensureBucket();
  try {
    const out = await s3().send(new GetObjectCommand({ Bucket: s3Bucket(), Key: key }));
    if (!out.Body) return null;
    return {
      stream: out.Body.transformToWebStream() as ReadableStream<Uint8Array>,
      contentType: out.ContentType ?? null,
      contentLength: out.ContentLength ?? null,
    };
  } catch (error) {
    if (isMissingObject(error)) return null;
    throw error;
  }
}

// ---------- Массовая чистка (GDPR, тикет 14) ----------

/**
 * Все ключи бакета с данным префиксом — ListObjectsV2 с пагинацией
 * (страница ≤1000 ключей). Пустой/кривой префикс не принимаем: без него
 * листался бы ВЕСЬ бакет, а единственный потребитель — чистка по
 * `items/{roomId}/` и `avatars/{userId}/`.
 */
export async function listKeysByPrefix(prefix: string): Promise<string[]> {
  if (!prefix || prefix.length < 3) {
    throw new Error("s3.listKeysByPrefix: нужен содержательный префикс, не весь бакет");
  }
  await ensureBucket();
  const keys: string[] = [];
  let token: string | undefined;
  do {
    const out = await s3().send(
      new ListObjectsV2Command({
        Bucket: s3Bucket(),
        Prefix: prefix,
        ContinuationToken: token,
      }),
    );
    for (const object of out.Contents ?? []) {
      if (object.Key) keys.push(object.Key);
    }
    token = out.IsTruncated ? out.NextContinuationToken : undefined;
  } while (token);
  return keys;
}

/** Лимит одного DeleteObjects в API S3 — 1000 ключей. */
const DELETE_BATCH_SIZE = 1000;

/**
 * Удалить объекты по списку ключей, батчами по 1000 (Quiet-режим: S3
 * отвечает только ошибками). Пустой список — no-op; несуществующий ключ
 * для S3 не ошибка (удаление идемпотентно). Частичный отказ — исключение:
 * вызывающий решает, валить ли операцию (GDPR-чистка — не валит, логирует).
 */
export async function deleteObjects(keys: readonly string[]): Promise<void> {
  if (keys.length === 0) return;
  await ensureBucket();
  for (let start = 0; start < keys.length; start += DELETE_BATCH_SIZE) {
    const batch = keys.slice(start, start + DELETE_BATCH_SIZE);
    const out = await s3().send(
      new DeleteObjectsCommand({
        Bucket: s3Bucket(),
        Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
      }),
    );
    const failed = out.Errors ?? [];
    const first = failed[0];
    if (first) {
      throw new Error(
        `s3.deleteObjects: не удалилось ${failed.length} из ${batch.length} ключей ` +
          `(первый: ${first.Key ?? "?"} — ${first.Code ?? "?"})`,
      );
    }
  }
}

// ---------- Разбор ошибок SDK ----------

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : "";
}

function errorStatus(error: unknown): number | undefined {
  const meta = (error as { $metadata?: { httpStatusCode?: number } } | null)?.$metadata;
  return meta?.httpStatusCode;
}

function isMissingBucket(error: unknown): boolean {
  const name = errorName(error);
  return name === "NotFound" || name === "NoSuchBucket" || errorStatus(error) === 404;
}

function isMissingObject(error: unknown): boolean {
  const name = errorName(error);
  return name === "NoSuchKey" || name === "NotFound" || errorStatus(error) === 404;
}
