// Сервис «Вещь» (Item): чтение зоны комнаты (тикет 03), создание вещи вручную
// (тикет 04, source=MANUAL) и по ссылке (тикет 06, source=URL: canonicalUrl/
// domain + очередь image.ingest + дедуп), скрытие/удаление вещи хозяйкой
// (тикет 13), правка вещи и перенос между зонами (тикет 39), переезд между
// комнатой и сокровищницей (тикет 124).
// Бизнес-логика живёт здесь, роуты/страницы остаются тонкими (CLAUDE.md).
//
// СОСТОЯНИЙ У ВЕЩИ БОЛЬШЕ НЕТ (тикет 124, решение владельца 09.08.2026).
// Есть два МЕСТА, и место — это `inHall`:
//   комната (`inHall = false`) — чего хочется: бронируется, цена по
//     `priceVisibility`, степень желания `desire`;
//   сокровищница (`inHall = true`) — что уже моё: не бронируется, цены гостю
//     не видно вовсе.
// `zone` вещь держит в обоих местах — иначе «Вернуть в комнату» некуда
// возвращать.
import { randomBytes } from "node:crypto";
import { revalidateTag } from "next/cache";
import { Prisma, type Item } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { rooms as roomPresets } from "@/config/design";
import { domainOf, normalizeUrl } from "@/server/parser";
import { enqueueImageIngest } from "@/server/queues";
import { recordItemAdded } from "@/server/services/room-events";
import { releaseBookingForItem } from "@/server/services/bookings";

const idSchema = z.string().min(1);

/**
 * Вещи одной зоны КОМНАТЫ для хозяйки (включая спрятанные — их видит
 * только она; фильтр для гостя — тикет 07).
 *
 * ВЕЩИ СОКРОВИЩНИЦЫ СЮДА НЕ ПОПАДАЮТ (тикет 124): комната — чего хочется,
 * витрина — что уже моё, и если бы витрина показывалась ещё и в зоне,
 * различие мест не значило бы ничего. `zone` у такой вещи остаётся, но
 * читает его витрина (`listHallItems`) и «Вернуть в комнату».
 *
 * Порядок (контракт тикета 03, без деления на состояния): desire по убыванию
 * (без desire — в конец), затем createdAt (новые выше).
 */
export async function listZoneItems(roomId: string, zoneKey: string): Promise<Item[]> {
  const items = await prisma.item.findMany({
    where: { roomId: idSchema.parse(roomId), zone: idSchema.parse(zoneKey), inHall: false },
  });
  return items.sort(compareZoneItems);
}

/**
 * Сколько СВОИХ вещей в каждой зоне комнаты — одним запросом (доска В2,
 * турн 11e: «Красота и уход · 31»). Нужен настройкам: выключая полку,
 * человек должен видеть, сколько на ней стоит.
 *
 * Считаются ВСЕ вещи зоны, включая спрятанные и уехавшие в сокровищницу:
 * это счётчик того, ЧТО ИСЧЕЗНЕТ ВМЕСТЕ С ПОЛКОЙ, а выключенная зона уносит
 * и витринные вещи тоже (guest-hall фильтрует по видимым зонам). У гостя
 * своё число — `guest-room`, там фильтр на чтении.
 * Зоны без вещей в карте отсутствуют — вызывающий читает их как ноль.
 */
export async function countItemsByZone(roomId: string): Promise<Map<string, number>> {
  const rows = await prisma.item.groupBy({
    by: ["zone"],
    where: { roomId: z.string().min(1).max(64).parse(roomId) },
    _count: { _all: true },
  });
  return new Map(rows.map((row) => [row.zone, row._count._all]));
}

/**
 * Единый порядок вещей в сетке зоны. Экспортирован для guest-room (тикет 07
 * держал дубль — полировка 16).
 *
 * ГРУПП БОЛЬШЕ НЕТ (тикет 124): делить сетку было нечем — состояние ушло, а
 * витринные вещи в зону не приезжают вовсе. Осталась ЕДИНСТВЕННАЯ градация
 * вещи — степень желания: desire 4 → 1, без desire («не скажу») — в конец,
 * дальше новые выше.
 */
export function compareZoneItems(a: Item, b: Item): number {
  // desire: 4 → 1, null — в конец (степень желания не указана).
  const desireA = a.desire ?? -1;
  const desireB = b.desire ?? -1;
  if (desireA !== desireB) return desireB - desireA;
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

/**
 * «Годен до» (тикет 97) — календарный день `YYYY-MM-DD`, как дата праздника.
 * Пишется полночью UTC и читается тем же поясом: иначе срок уедет на сутки
 * на машине восточнее Гринвича. Несуществующий день (31 февраля разбором
 * «переезжает» на 3 марта) сроком не считается — то же правило, что в
 * онбординге.
 */
const validUntilSchema = z.preprocess(
  (value) => (value == null || (typeof value === "string" && value.trim() === "") ? undefined : value),
  z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/u, "срок — календарный день ГГГГ-ММ-ДД")
    .refine(
      (day) => new Date(`${day}T00:00:00.000Z`).toISOString().slice(0, 10) === day,
      "такого дня не существует",
    )
    .optional(),
);

/** Календарный день `YYYY-MM-DD` → полночь UTC; пусто — null. */
function dayToUtc(day: string | undefined): Date | null {
  return day === undefined ? null : new Date(`${day}T00:00:00.000Z`);
}

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

/** Поля, общие обеим формам МЕСТА (турн 8: шаг 2). */
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
 * Дискриминированная схема по МЕСТУ, а не по состоянию (items.json v2,
 * тикет 124). Переключателя «люблю \ хочу» на экране добавления больше нет —
 * есть два входа: из зоны (вещь встаёт в комнату) и с витрины (`?hall=1`,
 * тикет 89 — вещь сразу в сокровищнице).
 *
 * У вещи КОМНАТЫ цена и валюта ОБЯЗАТЕЛЬНЫ: комната и есть список желаний,
 * и «у всего в комнате есть цена» — правило продукта (тикет 124 §3).
 * У вещи СОКРОВИЩНИЦЫ ключей price/currency нет вовсе: цена там не
 * показывается никому, и заводить её при создании незачем (инвариант №8).
 * Лишние ключи Zod отбрасывает молча — цена в новую витринную вещь не
 * попадает даже в БД.
 */
const createRoomItemSchema = z.object({
  inHall: z.literal(false),
  ...commonItemFields,
  price: priceSchema,
  currency: currencySchema,
  priceVisibility: z.enum(["ALL", "FRIENDS", "ME", "NONE"]).default("ALL"),
  size: optionalTrimmed(80),
  color: optionalTrimmed(80),
  desire: desireSchema,
  // Услуга-впечатление (тикет 97): «Когда · Где · Годен до». Все три
  // необязательны и живут у вещи комнаты — как размер и цвет.
  eventWhen: optionalTrimmed(80),
  eventWhere: optionalTrimmed(80),
  validUntil: validUntilSchema,
});

const createHallItemSchema = z.object({
  /**
   * «Сразу в сокровищницу» (тикет 89): вещь заводят с витрины, а не из зоны.
   * Зону вещь всё равно занимает — витрина зоне не замена, и «Вернуть в
   * комнату» без зоны не работает.
   */
  inHall: z.literal(true),
  ...commonItemFields,
  giverName: optionalTrimmed(120),
  /** Год «подарен в …»; в БД пишется как receivedAt (полдень UTC 1 января —
   * год не съезжает ни в одном реальном часовом поясе). */
  receivedYear: receivedYearSchema,
});

export const createItemInputSchema = z.preprocess(
  // Место по умолчанию — комната: форма из зоны ключа `inHall` не шлёт вовсе,
  // и требовать его от неё значило бы усложнить самый частый путь ради
  // самого редкого. Дискриминатор Zod обязан существовать до разбора,
  // поэтому подставляем его здесь, а не `.default()` внутри ветки.
  (value) =>
    typeof value === "object" && value !== null && !Array.isArray(value) && !("inHall" in value)
      ? { ...value, inHall: false }
      : value,
  z
    .discriminatedUnion("inHall", [createRoomItemSchema, createHallItemSchema])
    // «Родилась из ссылки» без ссылки не бывает: source=URL требует url.
    .refine((data) => data.source !== "URL" || data.url !== undefined, {
      path: ["url"],
      message: "source=URL требует ссылку",
    }),
);

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

  // Сколько вещей в зоне БЫЛО — для события «появилась полка» (тикет 114).
  // Считаем до создания: иначе первая вещь второй зоны выглядела бы как
  // открытие первой.
  const zoneCountBefore = await prisma.item.count({
    where: { roomId: room.id, zone: data.zone },
  });

  const item = await prisma.item.create({
    data: {
      roomId: room.id,
      zone: data.zone,
      title: data.title,
      note: data.note ?? null,
      photoKey: data.photoKey ?? null,
      url: data.url ?? null,
      canonicalUrl,
      domain,
      source: data.source,
      inHall: data.inHall,
      ...(data.inHall
        ? {
            giverName: data.giverName ?? null,
            receivedAt:
              data.receivedYear == null ? null : new Date(Date.UTC(data.receivedYear, 0, 1, 12)),
          }
        : {
            price: new Prisma.Decimal(data.price),
            currency: data.currency,
            priceVisibility: data.priceVisibility,
            size: data.size ?? null,
            color: data.color ?? null,
            desire: data.desire ?? null,
            eventWhen: data.eventWhen ?? null,
            eventWhere: data.eventWhere ?? null,
            validUntil: dayToUtc(data.validUntil),
          }),
    },
  });

  revalidateRoom(room.id);

  // Событие ленты (тикет 114): «У Милы 3 новых желания» и «появилась полка».
  // Ошибка записи наверх не поднимается — лента украшение, а добавление вещи
  // важнее.
  await recordItemAdded(room.id, data.zone, zoneCountBefore);

  // Фото магазина — в СВОЁ S3 через воркер (инвариант №6: не хотлинкуем).
  // Своё фото приоритетнее: при photoKey джоба не ставится вовсе.
  if (data.source === "URL" && data.imageUrl && !data.photoKey) {
    await enqueueImageIngest({ itemId: item.id, imageUrl: data.imageUrl });
  }

  return item;
}

// ---------- Скрытие и удаление вещи (тикет 13) ----------

/**
 * Отказы мутаций вещи. NOT_FOUND и для чужой вещи — существование чужого id
 * владельцу другой комнаты не подтверждаем. ZONE_NOT_VISIBLE — перенос в
 * полку, которой в комнате нет или которая выключена (тикет 39).
 * NOT_IN_HALL — глазок «скрыть от гостей» у вещи, которая на витрине не
 * лежит: прятать её оттуда нечем.
 *
 * КОДОВ NOT_WANT/NOT_LOVE БОЛЬШЕ НЕТ (тикет 124): они означали «операция
 * бывает только у одного состояния», а состояний не осталось. Переезд между
 * комнатой и сокровищницей доступен ЛЮБОЙ вещи в обе стороны.
 */
export class ItemMutationError extends Error {
  constructor(
    readonly code: "NOT_FOUND" | "NOT_IN_HALL" | "ZONE_NOT_VISIBLE",
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
 * Ключа `inHall` в схемах НЕТ ВОВСЕ: правка не переселяет вещь. Zod
 * отбрасывает лишние ключи молча, поэтому `{inHall:true}`, присланный руками
 * в форме правки, до БД не доедет — переезд бывает только явным действием
 * («В сокровищницу» / «Вернуть в комнату», `toggleHall`) или системным
 * («Дошло», `receiveGift`). Тест в tests/items.update.test.ts.
 */
const updateCommonFields = {
  zone: z.string().min(1),
  title: z.string().trim().min(1, "заголовок обязателен").max(200),
  note: optionalTrimmed(2000),
};

/** Форма правки вещи КОМНАТЫ: цена, размеры, степень желания, впечатление. */
const updateRoomSchema = z.object({
  ...updateCommonFields,
  price: priceSchema,
  currency: currencySchema,
  priceVisibility: z.enum(["ALL", "FRIENDS", "ME", "NONE"]).default("ALL"),
  size: optionalTrimmed(80),
  color: optionalTrimmed(80),
  desire: desireSchema,
  eventWhen: optionalTrimmed(80),
  eventWhere: optionalTrimmed(80),
  validUntil: validUntilSchema,
});

/** Форма правки вещи СОКРОВИЩНИЦЫ: даритель и год, цены там нет. */
const updateHallSchema = z.object({
  ...updateCommonFields,
  giverName: optionalTrimmed(120),
  receivedYear: receivedYearSchema,
});

export type UpdateItemInput = z.input<typeof updateRoomSchema> | z.input<typeof updateHallSchema>;

/**
 * Правка вещи и перенос между зонами (тикет 39, турны 11e и 8c). До неё
 * опечатку в названии или ошибку парсера в зоне можно было исправить только
 * удалением и заведением заново.
 *
 * Что правится: название, заметка, зона; у вещи КОМНАТЫ — цена, валюта,
 * видимость цены, размер, цвет, степень желания, поля впечатления; у вещи
 * СОКРОВИЩНИЦЫ — даритель и год. Набор полей выбирается по МЕСТУ ИЗ БД, а не
 * по инпуту: витринная вещь не получает цену полем правки (цены там нет —
 * инвариант №8), а вещь комнаты не получает дарителя (имя раскрывается ровно
 * одним путём — инвариант №2).
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
 * Гонка с переездом: guard `inHall` прямо в updateMany — если вещь успела
 * уехать на витрину, правка формы комнаты не запишется ни одним полем.
 * После записи инвалидируется кэш комнаты (roomCacheTag): без этого гость
 * видел бы вещь на старой полке до конца окна ISR.
 */
export async function updateItem(userId: string, itemId: string, input: unknown): Promise<Item> {
  const item = await requireOwnItem(userId, itemId);
  const data = item.inHall ? updateHallSchema.parse(input) : updateRoomSchema.parse(input);

  const room = await prisma.room.findUniqueOrThrow({ where: { id: item.roomId } });
  if (!visibleZoneKeys(room.preset, room.zonesOff).has(data.zone)) {
    throw new ItemMutationError("ZONE_NOT_VISIBLE", `зона «${data.zone}» не из видимых зон комнаты`);
  }

  const common = { zone: data.zone, title: data.title, note: data.note ?? null };
  const changed = await prisma.item.updateMany({
    where: { id: item.id, inHall: item.inHall },
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
            eventWhen: data.eventWhen ?? null,
            eventWhere: data.eventWhere ?? null,
            validUntil: dayToUtc(data.validUntil),
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

// ---------- Переезд «комната ↔ сокровищница» (тикеты 10 и 124) ----------
//
// РУЧНОЙ ПЕРЕЕЗД ОДИН, И ОН В ОБЕ СТОРОНЫ. «Уже моё» (`selfFulfill`) больше
// не существует: оно переводило вещь из «хочу» в «люблю», а состояний нет —
// то же самое теперь означает «положить в сокровищницу», и двух дорог в одно
// место мы не держим (тикет 124 §7). Осталось `toggleHall`:
//   on = true  — «В сокровищницу»;
//   on = false — «Вернуть в комнату» (решение владельца 09.08: вещь попадает
//                на витрину и по ошибке, дорога назад обязана быть).
//
// СИСТЕМНЫЙ переезд ровно один и живёт отдельно — «Дошло» (`receiveGift`,
// services/occasions): только он раскрывает имя дарителя, и только один раз.

/**
 * Переезд вещи между комнатой и сокровищницей (US 16, тикет 124).
 *
 * ДЕЙСТВИЕ ДОСТУПНО ВСЕГДА И ВЕДЁТ СЕБЯ ОДИНАКОВО НА ЛЮБОЙ ВЕЩИ. Дизайн
 * просил блокировать переезд, пока на вещи висит бронь, и блокировать молча;
 * мы это отклонили (разбор — тикет 124): недоступное действие само сообщает
 * хозяйке, что вещь занята, а инвариант №1 запрещает ей узнавать это «ни в
 * API, ни в кэше». Поэтому:
 * - никаких проверок брони и никаких отказов из-за неё;
 * - бронь при переезде НА ВИТРИНУ снимается молча ДЛЯ ХОЗЯЙКИ — ровно так же,
 *   как её снимают скрытие и удаление (контракт тикета 09);
 * - возврат `Item` не зависит от того, была бронь или нет. `releaseBookingForItem`
 *   возвращает boolean, и этот boolean НИКУДА отсюда не уходит.
 *
 * «МОЛЧА» — ЭТО ПРО ХОЗЯЙКУ, А НЕ ПРО ГОСТЯ (раунд 28 дизайна, дополнение к
 * тикету 124). Гость обязан узнать: иначе он придёт на праздник с подарком,
 * который у хозяйки уже есть. Поэтому снятие идёт с `notifyGuest: true` —
 * ему уходит письмо «вещь уехала, выбери другую», а взносы складчины
 * возвращаются тем же каскадом, что у несобравшейся складчины (обе механики
 * живут в `releaseBookingForItem`, второй дороги нет). Хозяйка об этом письме
 * не узнаёт ничем: оно ставится в очередь, ничего сюда не возвращает и не
 * может уронить переезд.
 * По сути это тоже верно: хозяйка, переносящая вещь на витрину, говорит «она
 * уже у меня» — подарок потерял смысл, и снятие брони здесь правильное
 * поведение, а не потеря.
 *
 * Что происходит с полями:
 * - `inHall` — единственное, что меняется по смыслу;
 * - `hiddenFromHall` сбрасывается при въезде: витрина показывает вещь, как бы
 *   её раньше ни прятали глазком;
 * - `receivedAt` проставляется, только если его ещё нет: у подарка это момент
 *   «Дошло», и переезд не имеет права его переписать (по нему сортируется
 *   витрина и по нему считается «Подарок {year} года»);
 * - `giverName` НЕ ТРОГАЕТСЯ НИКОГДА — ни при въезде, ни при возврате.
 *   Раскрытие имени необратимо (инвариант №2), а место вещи обратимо: это две
 *   разные вещи, и связывать их было ошибкой;
 * - `zone`, цена и остальное сохраняются: вернувшаяся вещь встаёт на свою
 *   полку со своей ценой («цена снова видна»).
 * Порядок «сначала переезд, потом снятие брони» — чтобы гонка двух кликов не
 * могла снять бронь без переезда.
 */
export async function toggleHall(userId: string, itemId: string, on: boolean): Promise<Item> {
  const toHall = z.boolean().parse(on);
  const item = await requireOwnItem(userId, itemId);

  const updated = await prisma.item.update({
    where: { id: item.id },
    data: toHall
      ? { inHall: true, hiddenFromHall: false, receivedAt: item.receivedAt ?? new Date() }
      : { inHall: false },
  });
  if (toHall) {
    await releaseBookingForItem(item.id, { notifyGuest: true });
  }
  revalidateRoom(item.roomId);
  return updated;
}

/**
 * Скрыть вещь сокровищницы ОТ НАБЛЮДАТЕЛЕЙ — глазок на витрине (тикет 89).
 * До него колонка `hiddenFromHall` писалась только в false (сбросом в
 * toggleHall): механика была в данных и в чтении, а нажать было не на что.
 *
 * Это НЕ «Вернуть в комнату» (`toggleHall`): вещь остаётся на витрине
 * ХОЗЯЙКИ приглушённой — иначе снять скрытие было бы нечем, — и просто
 * пропадает у наблюдателей (`hallItemShownToObservers`, dto/hall.ts).
 * Обратимо тем же глазком.
 *
 * Отдельного «скрыть цену» рядом больше нет (тикет 124): цену вещи
 * сокровищницы гость не видит вовсе, и прятать было нечего.
 */
export async function setHiddenFromHall(
  userId: string,
  itemId: string,
  hidden: boolean,
): Promise<Item> {
  const wantHidden = z.boolean().parse(hidden);
  const item = await requireOwnItem(userId, itemId);
  if (!item.inHall) {
    throw new ItemMutationError("NOT_IN_HALL", "эта вещь не на витрине — прятать её оттуда нечем");
  }

  const updated = await prisma.item.update({
    where: { id: item.id },
    data: { hiddenFromHall: wantHidden },
  });
  revalidateRoom(item.roomId);
  return updated;
}

/**
 * Витрина сокровищницы ГЛАЗАМИ ХОЗЯЙКИ: вещи с `inHall` — один фильтр, и с
 * тикета 124 он же единственный (тест tests/hall.test.ts). `hiddenFromHall`
 * здесь НЕ фильтруется с тикета
 * 89: /room/hall — её собственная страница, и спрятанная глазком вещь обязана
 * остаться на ней (приглушённой), иначе снять скрытие было бы нечем. Фильтр
 * наблюдателя живёт в `hallItemShownToObservers` (dto/hall.ts).
 * `hidden` (спрятанная от гостей) хозяйку тоже не ограничивает.
 * Порядок: свежеподаренные выше (receivedAt desc, без даты — в конец).
 */
export async function listHallItems(roomId: string): Promise<Item[]> {
  const items = await prisma.item.findMany({
    where: { roomId: idSchema.parse(roomId), inHall: true },
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
