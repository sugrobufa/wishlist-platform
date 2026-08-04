// Сервис «Вещь» (Item): чтение зоны для сетки «Люблю»/«Хочу» (тикет 03),
// создание вещи вручную (тикет 04, source=MANUAL) и по ссылке (тикет 06,
// source=URL: canonicalUrl/domain + очередь image.ingest + дедуп),
// скрытие/удаление вещи хозяйкой (тикет 13).
// Бизнес-логика живёт здесь, роуты/страницы остаются тонкими (CLAUDE.md).
import { randomBytes } from "node:crypto";
import { revalidateTag } from "next/cache";
import { Prisma, type Item } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { rooms as roomPresets } from "@/config/design";
import { domainOf, normalizeUrl } from "@/server/parser";
import { enqueueImageIngest } from "@/server/queues";
import { releaseBookingForItem } from "@/server/services/bookings";

const idSchema = z.string().min(1);

/**
 * Вещи одной зоны комнаты для хозяйки (включая спрятанные — их видит
 * только она; фильтр для гостя — тикет 07).
 *
 * Порядок (контракт тикета 03):
 * - группа «люблю» — по createdAt (новые выше);
 * - группа «хочу» — по desire по убыванию (без desire — в конец), затем
 *   по createdAt (новые выше).
 * Группы отдаются подряд: сначала «люблю», затем «хочу» — как вкладки в UI.
 */
export async function listZoneItems(roomId: string, zoneKey: string): Promise<Item[]> {
  const items = await prisma.item.findMany({
    where: { roomId: idSchema.parse(roomId), zone: idSchema.parse(zoneKey) },
  });
  return items.sort(compareZoneItems);
}

function compareZoneItems(a: Item, b: Item): number {
  if (a.state !== b.state) return a.state === "LOVE" ? -1 : 1;
  if (a.state === "WANT") {
    // desire: 4 → 1, null — в конец (степень желания не указана).
    const desireA = a.desire ?? -1;
    const desireB = b.desire ?? -1;
    if (desireA !== desireB) return desireB - desireA;
  }
  const byDate = b.createdAt.getTime() - a.createdAt.getTime();
  if (byDate !== 0) return byDate;
  // Детерминированный добивочный ключ на случай равных таймстампов.
  return a.id < b.id ? 1 : -1;
}

// ---------- Кэш комнаты ----------

/**
 * Тег кэша комнаты: мутации хозяйки бьют по нему revalidateTag'ом, гостевая
 * страница (тикет 07, ISR) подписывается этим же тегом.
 */
export function roomCacheTag(roomId: string): string {
  return `room-${roomId}`;
}

/** revalidateTag работает только в request-scope Next; вне его (vitest,
 * скрипты) кэша не существует — и инвалидировать нечего. Профиль "max" —
 * документированный эквивалент старого одноаргументного вызова (Next 16). */
function revalidateRoom(roomId: string): void {
  try {
    revalidateTag(roomCacheTag(roomId), "max");
  } catch {
    // вне Next-запроса — сознательно молчим
  }
}

// ---------- Создание вещи вручную (тикет 04) ----------

/** Пустая строка и null приводятся к undefined — поле «не заполнено». */
function optionalTrimmed(max: number) {
  return z.preprocess(
    (value) => (value == null || (typeof value === "string" && value.trim() === "") ? undefined : value),
    z.string().trim().max(max).optional(),
  );
}

/**
 * Деньги: строка под Decimal(12,2) — float запрещён (CLAUDE.md). Запятая
 * приводится к точке («14900,50» из формы), максимум 2 знака после точки.
 */
const priceSchema = z.preprocess(
  (value) => (typeof value === "number" ? String(value) : value),
  z
    .string()
    .trim()
    .transform((value) => value.replace(",", "."))
    .refine((value) => /^\d{1,10}(\.\d{1,2})?$/.test(value), "цена: число, максимум 2 знака после точки")
    .refine((value) => Number(value) > 0, "цена должна быть больше нуля"),
);

/** ISO 4217: три буквы («RUB»); форма подставляет ₽ по умолчанию. */
const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "валюта — трёхбуквенный код ISO 4217");

/**
 * photoKey принимаем только своего вида `items/{roomId}/{random}.{ext}`
 * (принадлежность комнате проверяется в createItem). Готовые URL и пути
 * пакета сюда не проходят — чужие картинки не хотлинкуем (инвариант №6).
 */
const photoKeySchema = z.preprocess(
  (value) => (value == null || value === "" ? undefined : value),
  z
    .string()
    .regex(/^items\/[a-z0-9-]+\/[a-z0-9]+\.[a-z0-9]{2,5}$/i, "photoKey не нашего вида")
    .optional(),
);

const urlSchema = z.preprocess(
  (value) => (value == null || (typeof value === "string" && value.trim() === "") ? undefined : value),
  z
    .url()
    .refine((value) => /^https?:\/\//i.test(value), "ссылка — только http(s)")
    .optional(),
);

const desireSchema = z.preprocess(
  (value) => (value == null ? undefined : value),
  z.number().int().min(1).max(4).optional(),
);

const receivedYearSchema = z.preprocess(
  (value) => (value == null ? undefined : value),
  z
    .number()
    .int()
    .min(1900, "год не раньше 1900")
    .refine((year) => year <= new Date().getFullYear(), "год из будущего")
    .optional(),
);

/**
 * Источник вещи на этой фазе: MANUAL (руки, тикет 04) или URL (по ссылке,
 * тикет 06). Остальные значения ItemSource (PHOTO/CATALOG/…) — будущие фазы,
 * из формы их прислать нельзя. Дефолт MANUAL — контракт тикета 04 не меняется.
 */
const sourceSchema = z.enum(["MANUAL", "URL"]).default("MANUAL");

/** Поля, общие обеим формам состояния (турн 8: шаг 2). */
const commonItemFields = {
  zone: z.string().min(1),
  title: z.string().trim().min(1, "заголовок обязателен").max(200),
  note: optionalTrimmed(2000),
  photoKey: photoKeySchema,
  url: urlSchema,
  source: sourceSchema,
  /** Фото магазина (только source=URL): скачается воркером в своё S3 —
   * в БД это поле не пишется, хотлинков нет (инвариант №6). */
  imageUrl: urlSchema,
};

/**
 * Дискриминированная схема по state (items.json: два состояния — два словаря
 * полей). У WANT цена и валюта ОБЯЗАТЕЛЬНЫ (продукт), у LOVE ключей
 * price/currency нет вовсе: лишние поля инпута отбрасываются ДО записи —
 * цена «люблю» не существует даже в БД при создании (инвариант §8).
 */
export const createItemInputSchema = z
  .discriminatedUnion("state", [
    z.object({
      state: z.literal("WANT"),
      ...commonItemFields,
      price: priceSchema,
      currency: currencySchema,
      priceVisibility: z.enum(["ALL", "FRIENDS", "ME", "NONE"]).default("ALL"),
      size: optionalTrimmed(80),
      color: optionalTrimmed(80),
      desire: desireSchema,
    }),
    z.object({
      state: z.literal("LOVE"),
      ...commonItemFields,
      giverName: optionalTrimmed(120),
      /** Год «подарен в …»; в БД пишется как receivedAt (полдень UTC 1 января —
       * год не съезжает ни в одном реальном часовом поясе). */
      receivedYear: receivedYearSchema,
    }),
  ])
  // «Родилась из ссылки» без ссылки не бывает: source=URL требует url.
  .refine((data) => data.source !== "URL" || data.url !== undefined, {
    path: ["url"],
    message: "source=URL требует ссылку",
  });

export type CreateItemInput = z.input<typeof createItemInputSchema>;

/** Доменные отказы createItem — поверх ZodError самой схемы. */
export class CreateItemError extends Error {
  constructor(
    readonly code: "NO_ROOM" | "ZONE_NOT_VISIBLE" | "FOREIGN_PHOTO_KEY",
    message: string,
  ) {
    super(message);
    this.name = "CreateItemError";
  }
}

/** Видимые зоны пресета: rooms.json минус выключенные (исчезают с мебелью). */
function visibleZoneKeys(preset: string, zonesOff: readonly string[]): Set<string> {
  const room = roomPresets.find((candidate) => candidate.id === preset);
  const off = new Set(zonesOff);
  return new Set((room?.zones ?? []).filter((zone) => !off.has(zone.key)).map((zone) => zone.key));
}

/**
 * canonicalUrl/domain для source=URL — считаются ТОЛЬКО на сервере из url
 * (клиенту это поле не доверяем: canonicalUrl — ключ дедупа). Нормализация
 * не удалась (экзотический, но валидный http-URL) — честно пишем null.
 */
function urlMetaFor(data: { source: "MANUAL" | "URL"; url?: string }): {
  canonicalUrl: string | null;
  domain: string | null;
} {
  if (data.source !== "URL" || !data.url) return { canonicalUrl: null, domain: null };
  try {
    const canonicalUrl = normalizeUrl(data.url);
    return { canonicalUrl, domain: domainOf(canonicalUrl) };
  } catch {
    return { canonicalUrl: null, domain: null };
  }
}

/**
 * Создать вещь (турн 8; вручную — тикет 04, по ссылке — тикет 06).
 * Ownership: вещь встаёт ТОЛЬКО в комнату самого пользователя — roomId
 * в инпуте не существует, подменить некуда. Зона обязана входить в видимые
 * зоны комнаты; photoKey — принадлежать ей же.
 * source=URL: пишутся url/canonicalUrl/domain, а при imageUrl без своего
 * фото ставится джоба image.ingest (фото магазина скачается в наше S3 —
 * сохранение вещи не ждёт и не ломается, если очередь недоступна).
 * После записи инвалидируется кэш комнаты (roomCacheTag).
 */
export async function createItem(userId: string, input: unknown): Promise<Item> {
  const data = createItemInputSchema.parse(input);

  const room = await prisma.room.findUnique({ where: { userId: idSchema.parse(userId) } });
  if (!room) {
    throw new CreateItemError("NO_ROOM", "у пользователя нет комнаты — сначала онбординг");
  }
  if (!visibleZoneKeys(room.preset, room.zonesOff).has(data.zone)) {
    throw new CreateItemError("ZONE_NOT_VISIBLE", `зона «${data.zone}» не из видимых зон комнаты`);
  }
  if (data.photoKey && !data.photoKey.startsWith(`items/${room.id}/`)) {
    throw new CreateItemError("FOREIGN_PHOTO_KEY", "photoKey из чужой комнаты");
  }

  const { canonicalUrl, domain } = urlMetaFor(data);

  const item = await prisma.item.create({
    data: {
      roomId: room.id,
      zone: data.zone,
      state: data.state,
      title: data.title,
      note: data.note ?? null,
      photoKey: data.photoKey ?? null,
      url: data.url ?? null,
      canonicalUrl,
      domain,
      source: data.source,
      ...(data.state === "WANT"
        ? {
            price: new Prisma.Decimal(data.price),
            currency: data.currency,
            priceVisibility: data.priceVisibility,
            size: data.size ?? null,
            color: data.color ?? null,
            desire: data.desire ?? null,
          }
        : {
            giverName: data.giverName ?? null,
            receivedAt:
              data.receivedYear == null ? null : new Date(Date.UTC(data.receivedYear, 0, 1, 12)),
          }),
    },
  });

  revalidateRoom(room.id);

  // Фото магазина — в СВОЁ S3 через воркер (инвариант №6: не хотлинкуем).
  // Своё фото приоритетнее: при photoKey джоба не ставится вовсе.
  if (data.source === "URL" && data.imageUrl && !data.photoKey) {
    await enqueueImageIngest({ itemId: item.id, imageUrl: data.imageUrl });
  }

  return item;
}

// ---------- Скрытие и удаление вещи (тикет 13) ----------

/** Отказы мутаций вещи. NOT_FOUND и для чужой вещи — существование чужого
 * id владельцу другой комнаты не подтверждаем. */
export class ItemMutationError extends Error {
  constructor(
    readonly code: "NOT_FOUND",
    message: string,
  ) {
    super(message);
    this.name = "ItemMutationError";
  }
}

/** Вещь СВОЕЙ комнаты — или NOT_FOUND (чужая неотличима от несуществующей).
 * Ownership — фильтром по room.userId прямо в запросе: подменить некуда. */
async function requireOwnItem(userId: string, itemId: string): Promise<Item> {
  const item = await prisma.item.findFirst({
    where: { id: idSchema.parse(itemId), room: { userId: idSchema.parse(userId) } },
  });
  if (!item) {
    throw new ItemMutationError("NOT_FOUND", "такой вещи нет");
  }
  return item;
}

/**
 * Спрятать/показать вещь (US 17): hidden видит только хозяйка, гостю она
 * не отдаётся (фильтр тикета 07 — в SQL, спрятанное не попадает даже в кэш).
 *
 * КОНТРАКТ ТИКЕТА 09: при hidden=true ОБЯЗАТЕЛЬНО снимается активная бронь
 * (releaseBookingForItem) — иначе спрятанная вещь оставалась бы «занятой»
 * и счётчик хозяйки врал. Гость не уведомляется: бронь тихо исчезает из
 * его «моих броней» (симметрично тихому появлению). Показ обратно (false)
 * бронь НЕ воскрешает. Идемпотентно.
 */
export async function setItemHidden(userId: string, itemId: string, hidden: boolean): Promise<Item> {
  const wantHidden = z.boolean().parse(hidden);
  const item = await requireOwnItem(userId, itemId);

  const updated =
    item.hidden === wantHidden
      ? item
      : await prisma.item.update({ where: { id: item.id }, data: { hidden: wantHidden } });
  // Снятие — и при повторном скрытии уже спрятанной: закрывает «дыру до
  // тикета 13» (бронь, повисшую на вещи, спрятанной до этого релиза).
  if (wantHidden) {
    await releaseBookingForItem(item.id);
  }

  revalidateRoom(item.roomId);
  return updated;
}

/**
 * Удалить вещь навсегда (подтверждение — на клиенте). Бронь снимается явно
 * ДО удаления (контракт тикета 09: честнее и дешевле, чем полагаться на
 * каскад молча), затем строка удаляется; PriceSnapshot уходит каскадом.
 * Фото-объект в S3 не трогаем — чистка осиротевших ключей вместе с
 * экспортом/удалением аккаунта (TODO тикет 16, GDPR — тикет 14).
 */
export async function deleteItem(userId: string, itemId: string): Promise<void> {
  const item = await requireOwnItem(userId, itemId);
  await releaseBookingForItem(item.id);
  await prisma.item.delete({ where: { id: item.id } });
  revalidateRoom(item.roomId);
}

// ---------- Дедуп по canonicalUrl (тикет 06) ----------

export type DuplicateItem = { id: string; title: string; zone: string };

/**
 * Вещь СВОЕЙ комнаты с тем же canonicalUrl — предупреждение «такая ссылка
 * уже есть», не запрет (user story 10). Ищем только по своей комнате:
 * чужие комнаты в дедупе не участвуют. Мусорный URL дубликатом не бывает.
 */
export async function findDuplicateByUrl(
  userId: string,
  rawUrl: string,
): Promise<DuplicateItem | null> {
  const room = await prisma.room.findUnique({ where: { userId: idSchema.parse(userId) } });
  if (!room) return null;

  let canonicalUrl: string;
  try {
    canonicalUrl = normalizeUrl(rawUrl);
  } catch {
    return null;
  }

  return prisma.item.findFirst({
    where: { roomId: room.id, canonicalUrl },
    select: { id: true, title: true, zone: true },
    orderBy: { createdAt: "asc" },
  });
}

// ---------- Фото вещи: ключ и лимиты (для pre-signed загрузки) ----------

export const ITEM_PHOTO_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Разрешённые типы фото — только растровые (image/svg+xml намеренно НЕТ:
 * SVG со скриптом, отданный с нашего origin через /media, — это XSS).
 */
const ITEM_PHOTO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
};

/**
 * Ключ фото вещи `items/{roomId}/{random}.{ext}` — или null, если тип
 * не из разрешённых. Ключ случайный: имя файла пользователя не участвует.
 */
export function newItemPhotoKey(roomId: string, contentType: string): string | null {
  const ext = ITEM_PHOTO_EXT[contentType.trim().toLowerCase()];
  if (!ext) return null;
  return `items/${idSchema.parse(roomId)}/${randomBytes(8).toString("hex")}.${ext}`;
}
