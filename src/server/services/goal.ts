// Сервис «Копилка на мечту» (тикет 44, ADR-0008) — зона «Просто деньги».
//
// ЧТО ЭТО. Хозяйка называет цель («на велосипед, 45 000 ₽»). Гость видит цель,
// прогресс и «N человек уже скинулись», может сказать «я участвую» и назвать
// обещанную сумму. Деньги передаются НАПРЯМУЮ, мимо сервиса: он их не
// принимает, не хранит и не переводит (PRD §12а, ADR-0008). Поэтому здесь нет
// ни платежа, ни статуса оплаты, ни провайдера — только договорённость.
//
// ЧЕМ ЭТО НЕ ЯВЛЯЕТСЯ. Не режимом брони: `BookingMode.POOL` остаётся Phase 2 и
// этим сервисом не разблокируется (services/bookings не тронут). Не вещью:
// цель в зал славы не уезжает и в агрегаты зоны (вилка цен, марки) не входит —
// её просто нет среди Item.
//
// ИНВАРИАНТ №1 (тихая бронь) — здесь его легче всего нарушить:
//   - прогресс сбора, обещанные суммы и число участников видят ТОЛЬКО гости.
//     Хозяйка прогресс своей копилки НЕ ВИДИТ (dto/goal.ts держит две формы,
//     и в форме хозяйки этих ключей нет вовсе);
//   - хозяйке достаётся один общий счётчик «N вещей уже забрали», где копилка
//     считается ОДНОЙ вещью при любом числе участников — `ownerTakenTotal`;
//   - как и бронь, участие не шлёт хозяйке уведомлений и не ревалидирует кэш
//     комнаты: в кэшируемых данных /r/{slug} копилки нет вовсе, карточка
//     забирает её отдельным некэшируемым запросом.
//
// ИНВАРИАНТ №2. Имена участников раскрываются ровно один раз — на экране «что
// подарили» (`revealedPledges`, зовёт services/occasions под существующим
// OccasionSummary). До этого имён нет ни в одном ответе.
import { randomBytes } from "node:crypto";
import { Prisma, type RoomGoal } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import { MONEY_ZONE_KEY } from "@/config/design";
import { ownerTakenCount } from "@/server/services/bookings";
import {
  goalForGuest,
  goalForOwner,
  type GuestGoalDto,
  type OwnerGoalDto,
} from "@/server/dto/goal";

/** Ключ зоны «Просто деньги» — копилка живёт в ней (src/config/design). */
export { MONEY_ZONE_KEY };

const idSchema = z.string().min(1).max(64);
/** Слаг приходит из URL от кого угодно: мусор режем до похода в БД. */
const slugSchema = z.string().min(1).max(64);

/** Токен участия: randomBytes(24) в hex — ровно 48 символов [0-9a-f]. */
const TOKEN_RE = /^[0-9a-f]{48}$/;

// ---------- Доменные отказы ----------

export type GoalErrorCode =
  | "NO_ROOM" // у пользователя нет комнаты — сначала онбординг
  | "ROOM_NOT_FOUND" // неизвестный слаг
  | "NO_GOAL" // цели нет: участвовать не в чем
  | "OWN_GOAL" // хозяйка «участвует» в своей копилке — подарка себе не бывает
  | "ALREADY_PLEDGED" // этот гость уже участвует (по своему же токену)
  | "TOKEN_NOT_FOUND"; // операция по чужому/несуществующему токену

export class GoalError extends Error {
  constructor(
    readonly code: GoalErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GoalError";
  }
}

// ---------- Деньги ----------

/** Колонка Decimal(12,2): больше десяти знаков до точки в неё не влезет. */
const MAX_AMOUNT = new Prisma.Decimal("9999999999");

/**
 * Сумма из недоверенного ввода — сразу в Decimal, минуя float (CLAUDE.md).
 * Принимаем строку и число (JSON-тело даёт и то и другое), но арифметики над
 * `number` не делаем: `new Prisma.Decimal` получает исходное представление.
 */
const amountSchema = z
  .union([z.string().trim().min(1).max(20), z.number()])
  .transform((value, ctx) => {
    let decimal: Prisma.Decimal;
    try {
      decimal = new Prisma.Decimal(typeof value === "number" ? value.toString() : value);
    } catch {
      ctx.addIssue({ code: "custom", message: "сумма выглядит неправильно" });
      return z.NEVER;
    }
    if (!decimal.isFinite() || decimal.lessThanOrEqualTo(0)) {
      ctx.addIssue({ code: "custom", message: "сумма должна быть больше нуля" });
      return z.NEVER;
    }
    if (decimal.greaterThan(MAX_AMOUNT)) {
      ctx.addIssue({ code: "custom", message: "сумма слишком большая" });
      return z.NEVER;
    }
    return decimal.toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
  });

/** ISO 4217 — три латинские буквы, как в остальном продукте. */
const currencySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/u, "валюта — три буквы по ISO 4217");

/** Запасная валюта, когда в комнате ещё нет ни одной вещи с ценой. */
const FALLBACK_CURRENCY = "RUB";

/**
 * Валюта копилки берётся ТАК ЖЕ, как у вещей комнаты (тикет 44): самая частая
 * валюта среди вещей «хочу» с ценой. Мультивалютной копилки нет — если
 * понадобится, это отдельное решение (ADR-0008, «что осталось открытым»).
 */
async function roomCurrency(roomId: string): Promise<string> {
  const rows = await prisma.item.groupBy({
    by: ["currency"],
    where: { roomId, state: "WANT", currency: { not: null } },
    _count: { currency: true },
    orderBy: { _count: { currency: "desc" } },
    take: 1,
  });
  return rows[0]?.currency ?? FALLBACK_CURRENCY;
}

// ---------- Цель: задаёт хозяйка ----------

export const roomGoalInputSchema = z.object({
  title: z
    .string({ error: "напиши, на что копишь" })
    .trim()
    .min(1, "напиши, на что копишь")
    .max(120),
  amount: amountSchema,
  /** Не прислали — возьмём валюту вещей комнаты. */
  currency: currencySchema.optional(),
});

export type RoomGoalInput = z.input<typeof roomGoalInputSchema>;

/** Комната хозяйки по userId сессии (слаг публичный — по нему цель не правят). */
async function ownRoomId(userId: string): Promise<string> {
  const room = await prisma.room.findUnique({
    where: { userId: idSchema.parse(userId) },
    select: { id: true },
  });
  if (!room) {
    throw new GoalError("NO_ROOM", "комнаты ещё нет — сначала соберём её");
  }
  return room.id;
}

/**
 * Задать или изменить цель. Одна цель на комнату (доска: «основной подарок ·
 * открыт для всех»), поэтому это upsert по roomId, а не создание второй.
 *
 * Участия при смене цели НЕ стираются: человек сказал «я участвую» в этой
 * копилке, а не в конкретной формулировке. Хозяйка, переписавшая «на
 * велосипед» в «на хороший велосипед», не должна молча обнулять чужие
 * обещания — а сообщить ей, что что-то обнулилось, мы не можем (инвариант №1).
 */
export async function setRoomGoal(userId: string, input: unknown): Promise<RoomGoal> {
  const data = roomGoalInputSchema.parse(input);
  const roomId = await ownRoomId(userId);
  const currency = data.currency ?? (await roomCurrency(roomId));

  return prisma.roomGoal.upsert({
    where: { roomId },
    create: { roomId, title: data.title, amount: data.amount, currency },
    update: { title: data.title, amount: data.amount, currency },
  });
}

/**
 * Убрать цель. Участия уезжают каскадом — по-другому и нельзя: обещание
 * существует только вместе с целью, ради которой его дали.
 * Идемпотентно: цели не было — честный false, без отказа.
 */
export async function clearRoomGoal(userId: string): Promise<boolean> {
  const roomId = await ownRoomId(userId);
  const { count } = await prisma.roomGoal.deleteMany({ where: { roomId } });
  return count > 0;
}

/**
 * Цель ГЛАЗАМИ ХОЗЯЙКИ — и только цель. Прогресса здесь нет и быть не может:
 * тип возврата его не содержит (dto/goal.ts). Нет комнаты — честный null,
 * а не отказ: страница просто покажет приглашение назвать цель.
 */
export async function getOwnerGoal(userId: string): Promise<OwnerGoalDto | null> {
  const room = await prisma.room.findUnique({
    where: { userId: idSchema.parse(userId) },
    select: { goal: true },
  });
  return goalForOwner(room?.goal ?? null);
}

// ---------- Канал копилки: гостю — прогресс, хозяйке — нет ----------

/**
 * Ответ канала целиком. Размеченное объединение, а не «одна форма с флагом»:
 * ветка `owner` физически не умеет унести прогресс, и это видно в типе.
 *
 * Хозяйка, открывшая СВОЮ ЖЕ ссылку /r/{slug}, попадает в ветку `owner` — тот
 * же приём, что в канале «занято» (тикет 41, services/bookings.takenForRoomSlug).
 * Без него кнопка «поделиться» показывала бы ей прогресс её же копилки.
 * Это не криптографическая защита, а обещание продукта (ADR-0007): выйдя из
 * аккаунта, она увидит гостевой ответ — как и с бронями.
 */
export type GoalChannelDto =
  { viewer: "guest"; goal: GuestGoalDto | null } | { viewer: "owner"; goal: OwnerGoalDto | null };

type RoomRef = { id: string; userId: string };

/** Адрес комнаты — ник ИЛИ короткий код, тем же порядком, что в guest-room. */
async function roomBySlug(slug: string): Promise<RoomRef | null> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  return (
    (await prisma.room.findUnique({
      where: { nick: parsed.data },
      select: { id: true, userId: true },
    })) ??
    (await prisma.room.findUnique({
      where: { shareSlug: parsed.data },
      select: { id: true, userId: true },
    }))
  );
}

/**
 * Копилка комнаты по слагу — единственная дверь канала: здесь комната
 * резолвится и здесь же выбирается ветка зрителя. Неизвестный слаг → null
 * (роут ответит 404).
 */
export async function goalForRoomSlug(
  slug: string,
  tokens: readonly string[] = [],
  options: { viewerUserId?: string | null } = {},
): Promise<GoalChannelDto | null> {
  const room = await roomBySlug(slug);
  if (!room) return null;

  const goal = await prisma.roomGoal.findUnique({
    where: { roomId: room.id },
    include: { pledges: { select: { amount: true, cancelToken: true } } },
  });

  const viewerUserId = options.viewerUserId ? idSchema.parse(options.viewerUserId) : null;
  if (viewerUserId !== null && viewerUserId === room.userId) {
    return { viewer: "owner", goal: goalForOwner(goal) };
  }

  return {
    viewer: "guest",
    goal: goal ? goalForGuest(goal, goal.pledges, { myTokens: validTokens(tokens) }) : null,
  };
}

// ---------- «Я участвую» ----------

export const pledgeInputSchema = z.object({
  name: z.string({ error: "имя обязательно" }).trim().min(1, "имя обязательно").max(120),
  email: z.preprocess(
    (value) =>
      value == null || (typeof value === "string" && value.trim() === "") ? undefined : value,
    z.email("почта выглядит неправильно").max(254).optional(),
  ),
  /** Обещанная сумма — необязательна: «я участвую» без суммы тоже участие. */
  amount: amountSchema.optional(),
});

export type PledgeInput = z.input<typeof pledgeInputSchema>;

/**
 * Гость говорит «я участвую». Возврат — ТОЛЬКО cancelToken: единственный ключ
 * гостя к своему обещанию (уйдёт в HTTP-only cookie на роуте).
 *
 * Валюта обещания — валюта цели: копилка одновалютная (ADR-0008), и просить у
 * гостя валюту значило бы обещать пересчёт, которого мы не делаем.
 *
 * Хозяйке ничего не шлём и кэш комнаты не ревалидируем (инвариант №1).
 */
export async function pledgeToGoal(
  slug: string,
  input: unknown,
  options: { sessionUserId?: string | null; tokens?: readonly string[] } = {},
): Promise<{ cancelToken: string }> {
  const data = pledgeInputSchema.parse(input);
  const room = await roomBySlug(slug);
  if (!room) {
    throw new GoalError("ROOM_NOT_FOUND", "такой комнаты нет");
  }

  const sessionUserId = options.sessionUserId ? idSchema.parse(options.sessionUserId) : null;
  if (sessionUserId !== null && sessionUserId === room.userId) {
    throw new GoalError("OWN_GOAL", "это твоя копилка — участвовать в ней нельзя");
  }

  const goal = await prisma.roomGoal.findUnique({
    where: { roomId: room.id },
    select: { id: true, currency: true },
  });
  if (!goal) {
    throw new GoalError("NO_GOAL", "цели пока нет — участвовать не в чем");
  }

  // Второе обещание того же гостя не заводим: полоса и «N человек» иначе
  // растут от одной пары нажатий, и число перестаёт означать людей.
  if (await findPledgeToken(goal.id, options.tokens ?? [])) {
    throw new GoalError("ALREADY_PLEDGED", "ты уже участвуешь — спасибо");
  }

  const cancelToken = randomBytes(24).toString("hex");
  await prisma.goalPledge.create({
    data: {
      goalId: goal.id,
      guestName: data.name,
      guestEmail: data.email ?? null,
      guestUserId: sessionUserId,
      amount: data.amount ?? null,
      currency: goal.currency,
      cancelToken,
    },
  });
  return { cancelToken };
}

/** Токены из cookie: только похожие на наши (48 hex), без дублей. */
function validTokens(tokens: readonly string[]): string[] {
  const unique = new Set<string>();
  for (const token of tokens) {
    if (typeof token === "string" && TOKEN_RE.test(token)) unique.add(token);
  }
  return [...unique];
}

/** Токен ЭТОГО гостя в ЭТОЙ копилке — сервер сам находит его среди cookie. */
async function findPledgeToken(goalId: string, tokens: readonly string[]): Promise<string | null> {
  const valid = validTokens(tokens);
  if (valid.length === 0) return null;
  const pledge = await prisma.goalPledge.findFirst({
    where: { goalId, cancelToken: { in: valid } },
    select: { cancelToken: true },
  });
  return pledge?.cancelToken ?? null;
}

/** То же по слагу комнаты — для роута «передумал». */
export async function findPledgeTokenForRoom(
  slug: string,
  tokens: readonly string[],
): Promise<string | null> {
  const room = await roomBySlug(slug);
  if (!room) return null;
  const goal = await prisma.roomGoal.findUnique({
    where: { roomId: room.id },
    select: { id: true },
  });
  return goal ? findPledgeToken(goal.id, tokens) : null;
}

/** Передумал — только по своему токену. Чужой/битый токен → отказ. */
export async function cancelPledge(cancelToken: string): Promise<void> {
  const token = z.string().min(1).max(128).parse(cancelToken);
  const { count } = await prisma.goalPledge.deleteMany({ where: { cancelToken: token } });
  if (count === 0) {
    throw new GoalError("TOKEN_NOT_FOUND", "твоего участия здесь нет");
  }
}

// ---------- Счётчик хозяйки: копилка — ОДНА вещь ----------

/**
 * Вклад копилки в счётчик «N вещей уже забрали»: 1, если участвует хоть кто-то,
 * иначе 0. ПРИ ЛЮБОМ ЧИСЛЕ УЧАСТНИКОВ — единица (ADR-0008, инвариант №1):
 * счётчик по числу участников был бы прогрессом сбора, показанным хозяйке
 * окольным путём.
 */
export async function goalTakenCount(roomId: string): Promise<number> {
  const pledged = await prisma.goalPledge.findFirst({
    where: { goal: { roomId: idSchema.parse(roomId) } },
    select: { id: true },
  });
  return pledged ? 1 : 0;
}

/**
 * Счётчик комнаты целиком: занятые вещи (services/bookings.ownerTakenCount) +
 * копилка одной вещью. ЕДИНСТВЕННОЕ, что хозяйка узнаёт о движении в комнате
 * до праздника, — и оба слагаемых обязаны идти через эту функцию, иначе
 * счётчик в шапке и счётчик в роуте разъедутся.
 *
 * Сервис брони не тронут сознательно (тикет 44): копилка — отдельный лёгкий
 * сценарий, а не режим брони, и складывать их правильно здесь, а не внутри
 * тихой брони.
 */
export async function ownerTakenTotal(userId: string): Promise<number> {
  const id = idSchema.parse(userId);
  const room = await prisma.room.findUnique({ where: { userId: id }, select: { id: true } });
  const items = await ownerTakenCount(id);
  return room ? items + (await goalTakenCount(room.id)) : items;
}

// ---------- Раскрытие имён: только «что подарили» (инвариант №2) ----------

/** Участник копилки на экране «что подарили» — имя и обещанная сумма. */
export type RevealedPledge = {
  name: string;
  /** Decimal строкой; null — участие без названной суммы. */
  amount: string | null;
  currency: string;
};

/**
 * Кто скинулся — вместе с остальными дарителями и ровно один раз.
 *
 * Функция НЕ решает, можно ли раскрывать: раскрытие живёт в
 * services/occasions.getOccasionView под существующим OccasionSummary, и
 * зовётся отсюда только он. Вне этого экрана имён участников не отдаёт
 * никто — ни один другой экспорт этого файла имени не содержит.
 */
export async function revealedPledges(roomId: string): Promise<RevealedPledge[]> {
  const pledges = await prisma.goalPledge.findMany({
    where: { goal: { roomId: idSchema.parse(roomId) } },
    orderBy: { createdAt: "asc" },
    select: { guestName: true, amount: true, currency: true },
  });
  return pledges.map((pledge) => ({
    name: pledge.guestName,
    amount: pledge.amount?.toString() ?? null,
    currency: pledge.currency,
  }));
}

// ---------- Cookie гостя `guest_pledges` ----------
// Тот же контракт, что у `guest_bookings` (services/bookings): HTTP-only,
// значение — JSON-массив токенов (48 hex каждый), path=/, maxAge год,
// sameSite=lax, secure в production. Cookie ОТДЕЛЬНАЯ: обещание — не бронь,
// и смешивать два вида токенов в одном списке значило бы искать бронь среди
// обещаний на каждом запросе.

export const GUEST_PLEDGES_COOKIE = "guest_pledges";
export const GUEST_PLEDGES_COOKIE_MAX_AGE = 365 * 24 * 60 * 60; // год, в секундах
/** Копилка одна на комнату, комнат у гостя немного — с большим запасом. */
export const MAX_GUEST_PLEDGE_TOKENS = 50;

/** Значение cookie → массив токенов. Мусор любого вида → пустой список. */
export function parseGuestPledgeTokens(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return validTokens(parsed.filter((entry): entry is string => typeof entry === "string")).slice(
      -MAX_GUEST_PLEDGE_TOKENS,
    );
  } catch {
    return [];
  }
}

export function addGuestPledgeToken(tokens: readonly string[], token: string): string[] {
  return [...tokens.filter((entry) => entry !== token), token].slice(-MAX_GUEST_PLEDGE_TOKENS);
}

export function removeGuestPledgeToken(tokens: readonly string[], token: string): string[] {
  return tokens.filter((entry) => entry !== token);
}

/** Опции cookie — одинаковые во всех роутах, чтобы cookie не «расслаивалась». */
export function guestPledgesCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: GUEST_PLEDGES_COOKIE_MAX_AGE,
  } as const;
}
