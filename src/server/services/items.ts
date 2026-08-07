// Сервис «Вещь» (Item): чтение зоны для сетки «Люблю»/«Хочу» (тикет 03),
// создание вещи вручную (тикет 04, source=MANUAL) и по ссылке (тикет 06,
// source=URL: canonicalUrl/domain + очередь image.ingest + дедуп),
// скрытие/удаление вещи хозяйкой (тикет 13), правка вещи и перенос между
// зонами (тикет 39).
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

/**
 * Единый порядок вещей в сетке (контракт тикета 03): группа «люблю» —
 * новые выше; группа «хочу» — desire ↓ (без desire — в конец), затем новые
 * выше. Экспортирован для guest-room (тикет 07 держал дубль — полировка 16).
 */
export function compareZoneItems(a: Item, b: Item): number {
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
 * id владельцу другой комнаты не подтверждаем. NOT_WANT/NOT_LOVE — операции
 * строго одного состояния (тикет 10): «уже моё» только у «хочу», зал славы
 * только у «люблю». ZONE_NOT_VISIBLE — перенос в полку, которой в комнате
 * нет или которая выключена (тикет 39). */
export class ItemMutationError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "NOT_WANT" | "NOT_LOVE" | "ZONE_NOT_VISIBLE",
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
 * Вещь своей комнаты для карточки хозяйки (тикет 39) — или null, если её
 * нет или она чужая (страница отвечает 404: существование чужого id не
 * подтверждаем). Booking намеренно НЕ включается: карточка не должна знать
 * о брони даже случайно (инвариант №1).
 */
export async function getOwnItem(userId: string, itemId: string): Promise<Item | null> {
  return prisma.item.findFirst({
    where: { id: idSchema.parse(itemId), room: { userId: idSchema.parse(userId) } },
  });
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
 * Массовое скрытие/показ (тикет 74, турн 29b): хозяйка выбирает несколько
 * вещей галочками и прячет их одной кнопкой.
 *
 * ХОДИТ ТОЙ ЖЕ ДОРОГОЙ, что и одиночное скрытие, — циклом по `setItemHidden`,
 * а не своим update. Это требование тикета, и оно не про красоту: при скрытии
 * сервис ОБЯЗАН снять активную бронь (`releaseBookingForItem`, контракт
 * тикета 09). Свой batch-update молча оставил бы брони висеть — ровно та
 * «дыра до тикета 13», которую однажды уже чинили.
 *
 * Чужая вещь роняет всю операцию: `requireOwnItem` внутри бросает, и наверх
 * уходит `ItemMutationError`. Полумер тут быть не должно — хозяйка нажала
 * «Скрыть 3 вещи» и вправе считать, что спрятаны либо три, либо ни одной.
 */
export async function setItemsHidden(
  userId: string,
  itemIds: readonly string[],
  hidden: boolean,
): Promise<number> {
  const ids = z.array(z.string().min(1)).min(1).max(200).parse(itemIds);
  for (const id of ids) {
    await setItemHidden(userId, id, hidden);
  }
  return ids.length;
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

// ---------- Правка вещи и перенос между зонами (тикет 39) ----------

/**
 * Поля правки — те же, что человек заполнял при добавлении, и ровно они.
 * Ключа `state` в схемах НЕТ ВОВСЕ: правка не меняет состояние вещи. Zod
 * отбрасывает лишние ключи молча, поэтому `{state:"WANT"}`, присланный
 * руками вещи «люблю», не доедет до БД — переход «хочу → люблю» остаётся
 * необратимым (инвариант №2, тест в tests/items.update.test.ts).
 * Схемы намеренно НЕ экспортируются: в поверхности сервиса не должно быть
 * имён с «want» (замок инварианта №2 в tests/occasions.test.ts).
 */
const updateCommonFields = {
  zone: z.string().min(1),
  title: z.string().trim().min(1, "заголовок обязателен").max(200),
  note: optionalTrimmed(2000),
};

const updateDesiredSchema = z.object({
  ...updateCommonFields,
  price: priceSchema,
  currency: currencySchema,
  priceVisibility: z.enum(["ALL", "FRIENDS", "ME", "NONE"]).default("ALL"),
  size: optionalTrimmed(80),
  color: optionalTrimmed(80),
  desire: desireSchema,
});

const updateOwnedSchema = z.object({
  ...updateCommonFields,
  giverName: optionalTrimmed(120),
  receivedYear: receivedYearSchema,
});

export type UpdateItemInput = z.input<typeof updateDesiredSchema> | z.input<typeof updateOwnedSchema>;

/**
 * Правка вещи и перенос между зонами (тикет 39, турны 11e и 8c). До неё
 * опечатку в названии или ошибку парсера в зоне можно было исправить только
 * удалением и заведением заново.
 *
 * Что правится: название, заметка, зона; у «хочу» — цена, валюта, видимость
 * цены, размер, цвет, степень желания; у «люблю» — даритель и год. Набор
 * полей выбирается по СОСТОЯНИЮ ИЗ БД, а не по инпуту: цена в строку «люблю»
 * не попадает даже полем (инвариант №8), а «хочу» не получает дарителя.
 *
 * Перенос: целевая зона обязана быть видимой зоной этой комнаты — есть в
 * пресете (`rooms.json` минус скрытые продуктом, ADR-0004) и не выключена
 * (`zonesOff`). Иначе ZONE_NOT_VISIBLE: полка, которой в комнате нет, не
 * должна молча проглатывать вещь.
 *
 * ВЕЩЬ С АКТИВНОЙ БРОНЬЮ ПРАВИТСЯ КАК ЛЮБАЯ ДРУГАЯ, и бронь остаётся жива.
 * Ни запретить, ни предупредить нельзя: и отказ, и предупреждение сообщили бы
 * хозяйке, что вещь занята, — это ровно то, что запрещает инвариант №1
 * (тихая бронь). Бронь ссылается на вещь, а не на снимок её текста: гость
 * всегда видит текущие название, цену и полку. Снимают бронь операции, после
 * которых вещь у гостя ИСЧЕЗАЕТ (скрытие и удаление); правка вещь на месте
 * оставляет — значит и бронь остаётся. Перенос безопасен по той же причине:
 * зона назначения проверена на видимость, вещь не проваливается в невидимую
 * полку. Покрыто тестом (бронь и счётчик после правки не двигаются).
 *
 * Гонка с «уже моё»: guard `state` прямо в updateMany — если вещь успела
 * стать «люблю», правка формы «хочу» не запишется ни одним полем.
 * После записи инвалидируется кэш комнаты (roomCacheTag): без этого гость
 * видел бы вещь на старой полке до конца окна ISR.
 */
export async function updateItem(userId: string, itemId: string, input: unknown): Promise<Item> {
  const item = await requireOwnItem(userId, itemId);
  const data =
    item.state === "WANT" ? updateDesiredSchema.parse(input) : updateOwnedSchema.parse(input);

  const room = await prisma.room.findUniqueOrThrow({ where: { id: item.roomId } });
  if (!visibleZoneKeys(room.preset, room.zonesOff).has(data.zone)) {
    throw new ItemMutationError("ZONE_NOT_VISIBLE", `зона «${data.zone}» не из видимых зон комнаты`);
  }

  const common = { zone: data.zone, title: data.title, note: data.note ?? null };
  const changed = await prisma.item.updateMany({
    where: { id: item.id, state: item.state },
    data:
      "price" in data
        ? {
            ...common,
            price: new Prisma.Decimal(data.price),
            currency: data.currency,
            priceVisibility: data.priceVisibility,
            size: data.size ?? null,
            color: data.color ?? null,
            desire: data.desire ?? null,
          }
        : {
            ...common,
            giverName: data.giverName ?? null,
            receivedAt: nextReceivedAt(item.receivedAt, data.receivedYear),
          },
  });
  if (changed.count === 0) {
    throw new ItemMutationError("NOT_FOUND", "вещь успела измениться — открой её заново");
  }

  revalidateRoom(item.roomId);
  return prisma.item.findUniqueOrThrow({ where: { id: item.id } });
}

/**
 * Год «подарен в …» → дата. Тот же год, что уже стоит, дату НЕ переписывает:
 * у подарка из «что подарили» receivedAt — точный момент отметки «Дошло», и
 * сохранение карточки без правки года не должно ронять его на 1 января
 * (по нему сортируется витрина зала славы).
 */
function nextReceivedAt(current: Date | null, year: number | undefined): Date | null {
  if (year === undefined) return null;
  if (current !== null && current.getUTCFullYear() === year) return current;
  return new Date(Date.UTC(year, 0, 1, 12));
}

// ---------- Ручные переходы и зал славы (тикет 10) ----------
// Переход LOVE → WANT НЕ СУЩЕСТВУЕТ (правило items.json, решение гриллинга
// №6): ни одна функция сервиса не пишет state=WANT существующей вещи —
// закреплено тестом tests/occasions.test.ts.

/**
 * «Уже моё» (US 15): ручной перевод WANT → LOVE без дарителя, раскрытий и
 * связи — хозяйка купила сама. inHall=false: в зал славы — руками, если
 * захочет (там подпись «уже моё»). Активная бронь, если была, тихо снимается
 * releaseBookingForItem (контракт тикета 09: одиночное снятие вне транзакций;
 * порядок «сначала переход, потом снятие» — чтобы гонка двух кликов не могла
 * снять бронь без перехода). Guard state=WANT в самом updateMany: повтор или
 * вызов на «люблю» — отказ NOT_WANT, ничего не меняется (переход необратим).
 */
export async function selfFulfill(userId: string, itemId: string): Promise<Item> {
  const item = await requireOwnItem(userId, itemId);
  if (item.state !== "WANT") {
    throw new ItemMutationError("NOT_WANT", "«уже моё» бывает только у вещи «хочу»");
  }

  const flipped = await prisma.item.updateMany({
    where: { id: item.id, state: "WANT" },
    data: { state: "LOVE", receivedAt: new Date(), giverName: null, inHall: false },
  });
  if (flipped.count === 0) {
    throw new ItemMutationError("NOT_WANT", "«уже моё» бывает только у вещи «хочу»");
  }
  await releaseBookingForItem(item.id);

  revalidateRoom(item.roomId);
  return prisma.item.findUniqueOrThrow({ where: { id: item.id } });
}

/**
 * Добавить/убрать вещь «люблю» в витрину зала славы (US 16). Только LOVE:
 * «хочу» в зале не живёт (NOT_LOVE). При on=true сбрасывается hiddenFromHall —
 * возврат в витрину показывает вещь, как бы её раньше ни прятали.
 */
export async function toggleHall(userId: string, itemId: string, on: boolean): Promise<Item> {
  const wantOn = z.boolean().parse(on);
  const item = await requireOwnItem(userId, itemId);
  if (item.state !== "LOVE") {
    throw new ItemMutationError("NOT_LOVE", "в зал славы попадают только вещи «люблю»");
  }

  const updated = await prisma.item.update({
    where: { id: item.id },
    data: wantOn ? { inHall: true, hiddenFromHall: false } : { inHall: false },
  });
  revalidateRoom(item.roomId);
  return updated;
}

/**
 * Скрыть/показать цену ОТДЕЛЬНОЙ вещи в зале славы (тикет 35, доска 12d:
 * «у любой вещи можно скрыть цену отдельно — даже если весь зал её
 * показывает»).
 *
 * Отдельной колонки под это нет: `Item.priceVisibility` уже отвечает на
 * вопрос «кто видит цену этой вещи», переживает переход «хочу → люблю» и
 * читается залом теми же четырьмя значениями, что и комнатой. Скрыть =
 * NONE, показать = ALL; шире, чем открыт сам зал, вещь всё равно не станет
 * (dto/hall.guestSeesHallItemPrice). Хозяйке цена видна всегда.
 */
export async function setHallPriceHidden(
  userId: string,
  itemId: string,
  hidden: boolean,
): Promise<Item> {
  const wantHidden = z.boolean().parse(hidden);
  const item = await requireOwnItem(userId, itemId);
  if (item.state !== "LOVE") {
    throw new ItemMutationError("NOT_LOVE", "в зал славы попадают только вещи «люблю»");
  }

  const updated = await prisma.item.update({
    where: { id: item.id },
    data: { priceVisibility: wantHidden ? "NONE" : "ALL" },
  });
  revalidateRoom(item.roomId);
  return updated;
}

/**
 * Витрина зала славы: вещи LOVE с inHall и БЕЗ hiddenFromHall — ровно два
 * фильтра (тест tests/hall.test.ts). hidden (спрятанная от гостей) хозяйку
 * не ограничивает — /room/hall её страница; гостевой зал — не Phase 1.
 * Порядок: свежеподаренные выше (receivedAt desc, без даты — в конец).
 */
export async function listHallItems(roomId: string): Promise<Item[]> {
  const items = await prisma.item.findMany({
    where: { roomId: idSchema.parse(roomId), state: "LOVE", inHall: true, hiddenFromHall: false },
  });
  return items.sort((a, b) => {
    const at = a.receivedAt?.getTime() ?? -1;
    const bt = b.receivedAt?.getTime() ?? -1;
    if (at !== bt) return bt - at;
    const byCreated = b.createdAt.getTime() - a.createdAt.getTime();
    if (byCreated !== 0) return byCreated;
    return a.id < b.id ? 1 : -1;
  });
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
