// Сервис «Тихая бронь» (тикет 08): гость занимает вещь «хочу» без регистрации
// и управляет своими бронями по cancelToken из HTTP-only cookie.
//
// ИНВАРИАНТ №1 (CLAUDE.md, никогда не нарушать): хозяйке — НИЧЕГО. Ни одна
// функция этого сервиса не шлёт уведомлений, не пишет ничего видимого хозяйке
// и НЕ ревалидирует кэш комнаты (брони в guest-DTO нет по построению —
// тикет 07). Счётчик «N вещей уже забраны» — тикет 09, отдельный канал.
// Имена/почты гостей наружу не выходят нигде, кроме «моих броней» самого
// гостя, — и даже там их сейчас нет: DTO собирается allowlist'ом без
// guestName/guestEmail (под тестом).
import { randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { itemPhotoUrl } from "@/server/dto/items";

const idSchema = z.string().min(1).max(64);
// Слаг приходит из URL от кого угодно: мусор режем до похода в БД (как в guest-room).
const slugSchema = z.string().min(1).max(64);

/** Токен отмены: randomBytes(24) в hex — ровно 48 символов [0-9a-f]. */
const TOKEN_RE = /^[0-9a-f]{48}$/;

// ---------- Доменные отказы ----------

export type BookingErrorCode =
  | "NOT_FOUND" // вещи нет (или гостю её «не существует»: hidden / зона выключена)
  | "DEMO_ITEM" // демо-призрак «пример» — не бронируется (гриллинг №4)
  | "NOT_WANT" // бронируются только вещи «хочу»
  | "ALREADY_BOOKED" // уникальность Booking.itemId (P2002) — уже занято
  | "POOL_NOT_SUPPORTED" // складчина — Phase 2 (каркас в БД есть, UI нет)
  | "TOKEN_NOT_FOUND"; // операция по чужому/несуществующему токену

export class BookingError extends Error {
  constructor(
    readonly code: BookingErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "BookingError";
  }
}

// ---------- Бронирование ----------

/** Пустая строка/null → undefined («поле не заполнено»), как в services/items. */
const optionalEmail = z.preprocess(
  (value) =>
    value == null || (typeof value === "string" && value.trim() === "") ? undefined : value,
  z.email("почта выглядит неправильно").max(254).optional(),
);

/**
 * Вход брони. POOL входит в enum сознательно: отказ по нему — доменный,
 * с честным сообщением (400), а не безликий ZodError.
 */
export const bookItemInputSchema = z.object({
  itemId: idSchema,
  name: z.string({ error: "имя обязательно" }).trim().min(1, "имя обязательно").max(120),
  email: optionalEmail,
  mode: z.enum(["QUIET", "SIGNED", "POOL"]).default("QUIET"),
});

export type BookItemInput = z.input<typeof bookItemInputSchema>;

/**
 * Гость тихо занимает вещь «хочу». Возврат — ТОЛЬКО cancelToken: единственный
 * ключ гостя к своей брони (уйдёт в HTTP-only cookie на роуте).
 *
 * Правила:
 * - демо-призраки (id `demo:...`) не бронируются — их нет в БД, отказ честный;
 * - спрятанная вещь и вещь выключенной зоны для гостя «не существуют»
 *   (инвариант №5) — тот же NOT_FOUND, что у незнакомого id, без утечки факта;
 * - только state=WANT; только без активной брони — уникальность Booking.itemId
 *   держит СХЕМА (гонка двух гостей решается P2002, не проверкой заранее);
 * - режим QUIET|SIGNED; POOL — Phase 2, отказ с честным сообщением.
 */
export async function bookItem(input: unknown): Promise<{ cancelToken: string }> {
  const data = bookItemInputSchema.parse(input);

  if (data.mode === "POOL") {
    throw new BookingError(
      "POOL_NOT_SUPPORTED",
      "складчина появится позже — пока можно занять вещь тихо или с подписью",
    );
  }
  // Демо-призраки не бронируются (гриллинг №4). Их id (`demo:{zone}:{n}`)
  // в БД не живут, но отказ должен быть честным, а не «вещь не найдена».
  if (data.itemId.startsWith("demo:")) {
    throw new BookingError("DEMO_ITEM", "это пример для пустой зоны — подарить его нельзя");
  }

  const item = await prisma.item.findUnique({
    where: { id: data.itemId },
    select: { id: true, state: true, hidden: true, zone: true, room: { select: { zonesOff: true } } },
  });
  // Спрятанные вещи и вещи выключенных зон гостям не отдаются (инвариант №5) —
  // и не бронируются; отказ неотличим от несуществующего id.
  if (!item || item.hidden || item.room.zonesOff.includes(item.zone)) {
    throw new BookingError("NOT_FOUND", "такой вещи нет");
  }
  if (item.state !== "WANT") {
    throw new BookingError("NOT_WANT", "подарить можно только вещь «хочу»");
  }

  const cancelToken = randomBytes(24).toString("hex");
  try {
    await prisma.booking.create({
      data: {
        itemId: item.id,
        mode: data.mode,
        guestName: data.name,
        guestEmail: data.email ?? null,
        cancelToken,
      },
    });
  } catch (error) {
    // Уникальность itemId уже в схеме: параллельная бронь = P2002 → «занято».
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new BookingError("ALREADY_BOOKED", "уже занято — кто-то успел раньше");
    }
    throw error;
  }

  return { cancelToken };
}

/** Снять бронь — только по своему cancelToken. Чужой/битый токен → отказ. */
export async function cancelBooking(cancelToken: string): Promise<void> {
  const token = z.string().min(1).max(128).parse(cancelToken);
  const { count } = await prisma.booking.deleteMany({ where: { cancelToken: token } });
  if (count === 0) {
    throw new BookingError("TOKEN_NOT_FOUND", "брони с таким токеном нет");
  }
}

/** Отметка «куплено» (переключатель) — только по своему cancelToken. */
export async function markPurchased(cancelToken: string, purchased = true): Promise<void> {
  const token = z.string().min(1).max(128).parse(cancelToken);
  const { count } = await prisma.booking.updateMany({
    where: { cancelToken: token },
    data: { purchased },
  });
  if (count === 0) {
    throw new BookingError("TOKEN_NOT_FOUND", "брони с таким токеном нет");
  }
}

// ---------- «Мои брони» гостя ----------

/**
 * Строка «моих броней». Сериализация — только allowlist: ключей guestName /
 * guestEmail в форме НЕ СУЩЕСТВУЕТ (даже своих — гостю они не нужны, а
 * инвариант №1 проще держать, когда их нет нигде). Покрыто тестом.
 */
export type MyBookingDto = {
  itemId: string;
  title: string;
  photoUrl: string | null;
  /** Комната вещи: слаг для ссылки /r/{slug} и имя хозяйки для подписи. */
  roomSlug: string;
  ownerName: string | null;
  mode: "QUIET" | "SIGNED" | "POOL";
  purchased: boolean;
  /** ISO-строка — когда занял. */
  createdAt: string;
};

/** Токены из cookie: только похожие на наши (48 hex), без дублей. */
function validTokens(tokens: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const token of tokens) {
    if (typeof token === "string" && TOKEN_RE.test(token)) unique.add(token);
  }
  return [...unique];
}

/**
 * Брони гостя по токенам из его cookie — для страницы «мои брони».
 * Отдаются ТОЛЬКО брони перечисленных токенов: чужого сюда не попадает
 * по построению (where cancelToken in …), и почт других гостей в выдаче
 * нет ни при каком входе.
 */
export async function listBookingsByTokens(tokens: readonly string[]): Promise<MyBookingDto[]> {
  const valid = validTokens(tokens);
  if (valid.length === 0) return [];

  const bookings = await prisma.booking.findMany({
    where: { cancelToken: { in: valid } },
    orderBy: { createdAt: "desc" },
    select: {
      mode: true,
      purchased: true,
      createdAt: true,
      item: {
        select: {
          id: true,
          title: true,
          photoKey: true,
          room: {
            select: {
              shareSlug: true,
              user: { select: { displayName: true, name: true } },
            },
          },
        },
      },
    },
  });

  return bookings.map((booking) => ({
    itemId: booking.item.id,
    title: booking.item.title,
    photoUrl: itemPhotoUrl(booking.item.photoKey),
    roomSlug: booking.item.room.shareSlug,
    ownerName: booking.item.room.user.displayName ?? booking.item.room.user.name ?? null,
    mode: booking.mode,
    purchased: booking.purchased,
    createdAt: booking.createdAt.toISOString(),
  }));
}

/** Сколько живых броней у гостя (для строки «Мои брони · N»). */
export async function countBookingsByTokens(tokens: readonly string[]): Promise<number> {
  const valid = validTokens(tokens);
  if (valid.length === 0) return 0;
  return prisma.booking.count({ where: { cancelToken: { in: valid } } });
}

/**
 * Токен гостя для конкретной вещи — сервер сам находит подходящий токен из
 * cookie (роуты отмены/«куплено» не принимают токен от клиента явно).
 */
export async function findTokenForItem(
  itemId: string,
  tokens: readonly string[],
): Promise<string | null> {
  const valid = validTokens(tokens);
  if (valid.length === 0) return null;
  const booking = await prisma.booking.findFirst({
    where: { itemId: idSchema.parse(itemId), cancelToken: { in: valid } },
    select: { cancelToken: true },
  });
  return booking?.cancelToken ?? null;
}

// ---------- Канал «занято» для гостей ----------

/**
 * id забронированных вещей комнаты — и НИЧЕГО больше: ни имён, ни режимов,
 * ни дат (тихое «занято» другим гостям, US 26). Канал живёт ВНЕ кэша комнаты
 * (некэшируемый роут) — кэшированный HTML одинаков для всех.
 */
export async function takenItemIds(roomId: string): Promise<string[]> {
  const rows = await prisma.booking.findMany({
    where: { item: { roomId: idSchema.parse(roomId) } },
    select: { itemId: true },
  });
  return rows.map((row) => row.itemId);
}

/**
 * «Занято» для гостевой страницы по слагу: все занятые вещи комнаты плюс
 * `mine` — какие из них заняты ЭТИМ гостем (по токенам его же cookie; о чужих
 * бронях это не говорит ничего). Неизвестный слаг → null (роут ответит 404).
 */
export async function takenForRoomSlug(
  slug: string,
  tokens: readonly string[],
): Promise<{ itemIds: string[]; mine: string[] } | null> {
  const parsedSlug = slugSchema.safeParse(slug);
  if (!parsedSlug.success) return null;

  const room = await prisma.room.findUnique({
    where: { shareSlug: parsedSlug.data },
    select: { id: true },
  });
  if (!room) return null;

  const itemIds = await takenItemIds(room.id);
  const valid = validTokens(tokens);
  const mine =
    valid.length === 0 || itemIds.length === 0
      ? []
      : (
          await prisma.booking.findMany({
            where: { cancelToken: { in: valid }, item: { roomId: room.id } },
            select: { itemId: true },
          })
        ).map((row) => row.itemId);

  return { itemIds, mine };
}

// ---------- Канал хозяйки: счётчик «N вещей уже забраны» (тикет 09) ----------

/**
 * ЕДИНСТВЕННОЕ, что хозяйка узнаёт о бронях до праздника (инвариант №1), —
 * одно ГОЛОЕ число: сколько вещей её комнаты сейчас занято. Ни id вещей,
 * ни имён, ни режимов, ни дат — тип возврата number не даёт унести больше.
 *
 * Комната ищется по userId СЕССИИ (не по slug: слаг публичный, чужой счётчик
 * по нему спрашивать нельзя). Гостевой канал (`takenItemIds`,
 * /rooms/{slug}/taken) сюда сознательно не переиспользуется — он отдаёт id
 * занятых вещей, а хозяйке нельзя знать, КАКИЕ вещи заняты.
 * Нет комнаты — честный 0: нет комнаты, нет и занятых вещей.
 */
export async function ownerTakenCount(userId: string): Promise<number> {
  return prisma.booking.count({
    where: { item: { room: { userId: idSchema.parse(userId) } } },
  });
}

/**
 * Автоснятие брони вещи: deleteMany — идемпотентно (нет брони → false, без
 * ошибки). Возврат — снялась ли бронь фактически.
 *
 * Это МЕХАНИЗМ для мутаций хозяйки: UI скрытия/удаления вещи (тикет 13)
 * обязан звать эту функцию, чтобы спрятанная вещь не осталась «занятой» и
 * счётчик не врал. Гостю не шлём ничего — бронь тихо исчезает из его
 * «моих броней» (симметрично тому, что хозяйка не знала о её появлении).
 */
export async function releaseBookingForItem(itemId: string): Promise<boolean> {
  const { count } = await prisma.booking.deleteMany({
    where: { itemId: idSchema.parse(itemId) },
  });
  return count > 0;
}

// ---------- Cookie гостя `guest_bookings` ----------
// Контракт (тикеты 09/15): HTTP-only cookie, значение — JSON-массив
// cancelToken'ов (48 hex каждый), path=/, maxAge год, sameSite=lax,
// secure в production. Хвост длиннее 50 токенов режется с СТАРОГО конца.

export const GUEST_BOOKINGS_COOKIE = "guest_bookings";
export const GUEST_BOOKINGS_COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // год, в секундах
/** 50 токенов ≈ 2.6 КБ JSON — с запасом до браузерного лимита cookie 4 КБ. */
export const MAX_GUEST_BOOKING_TOKENS = 50;

/** Значение cookie → массив токенов. Мусор любого вида → пустой список. */
export function parseGuestBookingTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return validTokens(parsed.filter((entry): entry is string => typeof entry === "string")).slice(
      -MAX_GUEST_BOOKING_TOKENS,
    );
  } catch {
    return [];
  }
}

/** Новый токен — в конец; дубль не плодится; старейшие выпадают за лимитом. */
export function addGuestBookingToken(tokens: readonly string[], token: string): string[] {
  return [...tokens.filter((entry) => entry !== token), token].slice(-MAX_GUEST_BOOKING_TOKENS);
}

export function removeGuestBookingToken(tokens: readonly string[], token: string): string[] {
  return tokens.filter((entry) => entry !== token);
}

/** Опции cookie — одинаковые во всех роутах, чтобы cookie не «расслаивалась». */
export function guestBookingsCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_BOOKINGS_COOKIE_MAX_AGE,
  } as const;
}
