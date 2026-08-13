// Сервис «Что подарили» (тикет 10): закрытие праздника (OccasionSummary),
// gated-чтение имён дарителей и переход «Дошло» (receiveGift).
//
// ИНВАРИАНТ №2 (CLAUDE.md, никогда не нарушать): имена дарителей раскрываются
// РОВНО ОДИН РАЗ — на экране «что подарили», под OccasionSummary.revealedAt.
// Раскрытие = существование summary: пока праздник не закрыт, getOccasionView
// не отдаёт ни имён, ни вещей с бронями — ВООБЩЕ ничего повещного о бронях
// (инвариант №1 продолжает действовать). receiveGift без summary отказывает:
// вне «что подарили» перехода с раскрытием не существует.
//
// НЕОБРАТИМО ТОЛЬКО РАСКРЫТИЕ ИМЕНИ, А НЕ МЕСТО ВЕЩИ (тикет 124). Прежняя
// формулировка «переход хочу → люблю необратим» умерла вместе с состояниями:
// вещь, уехавшую «Дошло» в сокровищницу, хозяйка может вернуть в комнату
// (items.toggleHall) — и это ничего не меняет в именах. `giverName` пишется
// здесь один раз и после этого не трогается ни переездом, ни возвратом.
import { revalidateTag } from "next/cache";
import { Prisma, type Item, type OccasionSummary } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/server/db";
import {
  birthdayOf,
  dueOccasion,
  isoDay,
  nextOccasion,
  type BirthdayColumns,
} from "@/server/birthday";
import { roomCacheTag } from "@/server/services/items";
import {
  listPendingConsent,
  upsertGiftConnection,
  type PendingConsentRow,
} from "@/server/services/connections";
import { ownerTakenTotal, revealedPledges } from "@/server/services/goal";
import { itemPhotoUrl } from "@/server/dto/items";
import { enqueueOccasionOwnerMail } from "@/server/queues";

const idSchema = z.string().min(1).max(64);

// ---------- Доменные отказы ----------

export type OccasionErrorCode =
  | "NO_ROOM" // комнаты нет (или чужой roomId)
  | "NOT_FOUND" // вещи нет — или она чужая (не подтверждаем существование)
  | "ALREADY_IN_HALL" // «Дошло» уже отмечено: вещь в сокровищнице, повтор — отказ
  | "NO_SUMMARY"; // праздник не закрыт — раскрытия вне summary не существует

export class OccasionError extends Error {
  constructor(
    readonly code: OccasionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "OccasionError";
  }
}

/** revalidateTag живёт только в request-scope Next; вне его (vitest, воркер)
 * кэша нет — и инвалидировать нечего (паттерн services/items). */
function revalidateRoom(roomId: string): void {
  try {
    revalidateTag(roomCacheTag(roomId), "max");
  } catch {
    // вне Next-запроса — сознательно молчим
  }
}

// ---------- Закрытие праздника ----------

/** Границы UTC-суток даты: идемпотентность closeOccasion — «summary этой даты». */
function utcDayRange(date: Date): { gte: Date; lt: Date } {
  const gte = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const lt = new Date(gte.getTime() + 24 * 60 * 60 * 1000);
  return { gte, lt };
}

/**
 * ПРАЗДНИК КОМНАТЫ В ДВУХ ВИДАХ — одно место на весь сервис (тикет 216).
 *
 * Экран «что подарили» и тихая строка комнаты отвечают на ОДИН вопрос —
 * «праздник уже прошёл?» — и разошлись они ровно потому, что считали его в
 * разных местах: комната по `dueOccasion`, экран по существованию итога.
 * Владелец нажал в комнате «Праздник прошёл» и попал на «Праздник ещё
 * впереди». Поэтому арифметика живёт в `server/birthday`, а этот вопрос к БД —
 * здесь, и обе поверхности зовут его, а не переписывают.
 *
 * О БРОНЯХ НЕ ГОВОРИТ НИЧЕГО (инвариант №1): считается по колонкам дня
 * рождения комнаты и по факту существования итога — ни одной строки о том,
 * кто что занял.
 */
async function roomOccasion(
  room: { id: string } & BirthdayColumns,
  now: Date,
): Promise<{
  /** Наступивший день рождения (полночь UTC); null — комната между праздниками или без даты. */
  due: Date | null;
  /** Итог ЭТОГО наступившего праздника уже закрыт. */
  dueClosed: boolean;
  /** Ближайший день рождения впереди; null — дня рождения нет вовсе. */
  next: Date | null;
}> {
  const birthday = birthdayOf(room);
  if (!birthday) return { due: null, dueClosed: false, next: null };

  const next = nextOccasion(birthday, now);
  const due = dueOccasion(birthday, now);
  if (!due) return { due: null, dueClosed: false, next };

  const closed = await prisma.occasionSummary.findFirst({
    where: { roomId: room.id, date: utcDayRange(due) },
    select: { id: true },
  });
  return { due, dueClosed: closed !== null, next };
}

export type CloseOccasionResult = {
  summary: OccasionSummary;
  /** false — summary этой даты уже был (повторный вызов); письмо не дублируется. */
  created: boolean;
};

/**
 * Закрыть праздник комнаты: создать OccasionSummary и поставить письмо
 * хозяйке «открой „что подарили"» (джоба occasion-owner в очереди mail;
 * enqueue не бросает — summary важнее письма, шаблон — тикет 12).
 *
 * Дата итога: наступивший день рождения — это итог ПРАЗДНИКА, не клика;
 * без него (даты нет вовсе или до неё ещё далеко) ручной запуск закрывает
 * «сегодня» (now). Автозапуск (воркер) без наступившего праздника не
 * закрывает ничего → null.
 *
 * Идемпотентно на «уже есть summary этой даты» (UTC-сутки): повторный вызов —
 * и ручной после автозакрытия, и автозакрытие после ручного — возвращает
 * существующий summary и НЕ ставит второе письмо.
 */
export async function closeOccasion(
  roomId: string,
  options: { manual?: boolean } = {},
): Promise<CloseOccasionResult | null> {
  const id = idSchema.parse(roomId);
  const room = await prisma.room.findUnique({
    where: { id },
    include: { user: { select: { email: true } } },
  });
  if (!room) {
    throw new OccasionError("NO_ROOM", "такой комнаты нет");
  }

  const now = new Date();
  // Наступивший день рождения — тот, что прошёл не раньше двух недель назад
  // (тикет 187, `birthday.dueOccasion`). Дата теперь повторяется, поэтому
  // «прошла» без хвоста означало бы «прошла год назад», и итог закрывался бы
  // у каждой комнаты в первый же тик.
  const birthday = birthdayOf(room);
  const dueDate = birthday ? dueOccasion(birthday, now) : null;
  const date = dueDate ?? (options.manual ? now : null);
  if (!date) return null; // автозакрытию нечего закрывать — праздник не наступил

  const existing = await prisma.occasionSummary.findFirst({
    where: { roomId: room.id, date: utcDayRange(date) },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return { summary: existing, created: false };

  let summary: OccasionSummary;
  try {
    summary = await prisma.occasionSummary.create({
      data: { roomId: room.id, date },
    });
  } catch (error) {
    // Гонка cron+клик (оба прошли findFirst до чужого коммита): уникальность
    // (roomId, date) — миграция occasion_unique_room_date, полировка 16 —
    // отдаёт проигравшему P2002; он берёт summary победителя. Письмо ставит
    // только победитель — второго не будет и под гонкой.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const winner = await prisma.occasionSummary.findUnique({
        where: { roomId_date: { roomId: room.id, date } },
      });
      if (winner) return { summary: winner, created: false };
    }
    throw error;
  }
  // Контракт payload для тикета 12: {userId, email, roomId}, джоба occasion-owner.
  await enqueueOccasionOwnerMail({ userId: room.userId, email: room.user.email, roomId: room.id });
  return { summary, created: true };
}

// ---------- Экран «что подарили» (gated-чтение имён) ----------

/** Строка ожидающего подарка. СУЩЕСТВУЕТ только при существующем summary —
 * до закрытия праздника этих объектов (и имён в них) не бывает нигде. */
export type OccasionPendingGift = {
  itemId: string;
  title: string;
  photoUrl: string | null;
  /** Режим брони: SIGNED подписался сам, QUIET раскрывается здесь же —
   * на этом экране раскрываются ВСЕ имена (README турн 21). */
  mode: "QUIET" | "SIGNED" | "POOL";
  guestName: string;
  /**
   * «СКАЗАТЬ СПАСИБО» ЕСТЬ КУДА СКАЗАТЬ (пакет 49, `thanksGuest.shownWhen`).
   * Почта гостя необязательна; нет её — строки благодарности нет ВОВСЕ: не
   * серой, не выключенной, никакой (правило раунда 3: не сообщаем человеку о
   * том, чего у нас нет). Флаг отделён от адреса нарочно: показ решается им, а
   * у складчины строка есть, если почта есть хотя бы у одного участника, —
   * там адресов может быть больше одного.
   */
  canThank: boolean;
  /**
   * Адрес для `mailto` — ТОЛЬКО там, где строка показывается (`canThank`).
   * Больше почта гостя на клиент не уезжает ни в каком виде: имя на этом
   * экране уже раскрыто (инвариант №2), а почта — нет, и раскрывать её незачем.
   */
  thanksEmail: string | null;
};

/**
 * Уже отмеченное «Дошло» этого праздника — «уже в зале славы».
 *
 * СТРОКИ «СПАСИБО» ЗДЕСЬ НЕТ, И ЭТО НЕ ЗАБЫТО: «Дошло» закрывает бронь
 * (`receiveGift`, контракт тикета 09), а почта гостя жила только в ней —
 * у вещи её нет и не заводится. Писать некуда, значит и звать писать нельзя.
 */
export type OccasionReceivedGift = {
  itemId: string;
  title: string;
  photoUrl: string | null;
  giverName: string | null;
  /** ISO — момент «Дошло». */
  receivedAt: string;
};

/**
 * Копилка на мечту на экране «что подарили» (тикет 44, доска — турн 6:
 * «Просто деньги · Вложились трое · 22 000 ₽ · Кто»). СУЩЕСТВУЕТ только при
 * существующем summary: до праздника хозяйка не знает о копилке ничего —
 * ни суммы, ни числа участников, ни тем более имён (инварианты №1 и №2).
 */
export type OccasionGoal = {
  /** На что копила — цель словами. */
  title: string;
  /** Собранное по названным обещаниям, Decimal строкой. */
  pledged: string;
  /** ISO 4217. */
  currency: string;
  /** Кто скинулся — то самое «Кто» с доски, раскрытое ровно здесь. */
  givers: string[];
};

export type OccasionView = {
  /** null — праздник не закрыт: имена и вещи с бронями НЕ отдаются вообще. */
  summary: { id: string; date: string; revealedAt: string | null } | null;
  /**
   * НАСТУПИВШИЙ праздник, по которому итог ещё не закрыт (календарный день
   * `YYYY-MM-DD`); null — закрывать нечего. Ровно то, по чему в комнате горит
   * тихая строка «Праздник прошёл» (`occasionBannerVisible`): состояний у
   * экрана три, а не два, и это третье — «дело есть, но оно не сделано»
   * (тикет 216). О бронях не говорит ничего — считается по дню рождения.
   */
  due: string | null;
  /**
   * БЛИЖАЙШИЙ праздник, когда он ВПЕРЕДИ (календарный день `YYYY-MM-DD`);
   * null — праздник наступил (тогда есть `due`) или дня рождения нет вовсе.
   * Взаимно исключает `due`: одна дата не бывает одновременно прошедшей и
   * будущей, и экран не должен выбирать между двумя ответами.
   */
  next: string | null;
  pending: OccasionPendingGift[];
  received: OccasionReceivedGift[];
  /** «Осталось незабранным · N» — вещи комнаты без брони (голое число). */
  unclaimedCount: number;
  /**
   * «N вещей уже забрали» — ТОТ ЖЕ счётчик, что в комнате
   * (`services/goal.ownerTakenTotal`: занятые вещи плюс копилка одной вещью
   * при любом числе участников). Экран показывает его до раскрытия — на
   * пороге числом в лиде, в ожидании блоком (пакет 48, тикет 219).
   *
   * ЭТО ЕДИНСТВЕННОЕ, ЧТО ХОЗЯЙКА УЗНАЁТ О ДВИЖЕНИИ ДО ПРАЗДНИКА (инвариант
   * №1): голое число по комнате — ни имени, ни названия вещи, ни списка.
   * Считается той же функцией, что в шапке комнаты и в роуте
   * `/api/v1/room/taken-count`: три поверхности, одно место — иначе они
   * разъедутся, как разъехались комната и экран в тикете 216.
   */
  takenTotal: number;
  /** Копилка с раскрытыми участниками; null — цели нет или в неё не скидывались. */
  goal: OccasionGoal | null;
  /**
   * «Остаться на связи?» — дарители, чья связь ждёт ответа (тикет 98, доска
   * Б12). Пусто без summary: до закрытия праздника связей из подарков не
   * существует, а значит и спрашивать не о ком.
   */
  consent: PendingConsentRow[];
};

/**
 * Данные экрана «что подарили» для хозяйки (по userId сессии).
 *
 * Раскрытие живёт исключительно здесь:
 * - БЕЗ summary: ни одной строки о бронях — ни имён, ни вещей (инвариант №1);
 *   отдаётся только счётчик незабранных «хочу».
 * - С summary: строки живых броней комнаты С именами (QUIET и SIGNED — все:
 *   README турн 21), плюс уже отмеченные «Дошло» этого праздника.
 * - revealedAt проставляется при ПЕРВОМ открытии экрана и больше никогда
 *   не меняется (updateMany с guard'ом revealedAt=null — идемпотентно).
 */
export async function getOccasionView(userId: string): Promise<OccasionView> {
  const room = await prisma.room.findUnique({
    where: { userId: idSchema.parse(userId) },
    select: { id: true, birthdayDay: true, birthdayMonth: true, birthdayYear: true },
  });
  if (!room) {
    throw new OccasionError("NO_ROOM", "у пользователя нет комнаты — сначала онбординг");
  }

  // ПРОШЁЛ ЛИ ПРАЗДНИК — тем же вопросом, что и тихая строка комнаты (тикет
  // 216). Наступивший праздник живёт в ответе, только пока итог по нему НЕ
  // закрыт: закрытый рассказывает о себе строками summary, а не обещанием
  // «дело есть». Пока `due` есть, «впереди» не бывает — иначе экран получил бы
  // два ответа на один вопрос и снова выбрал не тот.
  const { due, dueClosed, next } = await roomOccasion(room, new Date());
  const openDue = due !== null && !dueClosed ? due : null;
  const dates = {
    due: openDue === null ? null : isoDay(openDue),
    next: openDue !== null || next === null ? null : isoDay(next),
  };

  // Незабранные вещи комнаты остаются в ней до следующего повода (спрятанные
  // хозяйкой в подарочном цикле не участвуют — их бронь снята при скрытии).
  const unclaimedCount = await prisma.item.count({
    where: { roomId: room.id, inHall: false, hidden: false, booking: null },
  });

  // Счётчик забранного — НЕ СВОЙ, а тот же, что показывает комната: копилка
  // входит в него одной вещью при любом числе участников (ADR-0008), и второе
  // сложение здесь однажды разошлось бы с первым. О том, КТО и ЧТО забрал, он
  // не говорит ничего — это по-прежнему голое число (инвариант №1).
  const takenTotal = await ownerTakenTotal(userId);

  const summary = await prisma.occasionSummary.findFirst({
    where: { roomId: room.id },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  if (!summary) {
    // Копилки здесь нет ни строкой: до закрытия праздника хозяйка не видит
    // ни прогресса сбора, ни участников (инвариант №1, ADR-0008).
    return {
      summary: null,
      ...dates,
      pending: [],
      received: [],
      unclaimedCount,
      takenTotal,
      goal: null,
      consent: [],
    };
  }

  // Первое открытие экрана = момент раскрытия. Guard revealedAt=null держит
  // идемпотентность и под гонкой; настоящий момент перечитываем из БД.
  await prisma.occasionSummary.updateMany({
    where: { id: summary.id, revealedAt: null },
    data: { revealedAt: new Date() },
  });
  const revealed = await prisma.occasionSummary.findUniqueOrThrow({ where: { id: summary.id } });

  // Живые брони комнаты. Брони бывают только у вещи комнаты (bookItem), а
  // «Дошло» закрывает бронь в той же транзакции — фильтра по месту не нужно.
  const bookings = await prisma.booking.findMany({
    where: { item: { roomId: room.id } },
    orderBy: { createdAt: "asc" },
    select: {
      mode: true,
      guestName: true,
      // Почта — ради одной строки «Сказать спасибо» (пакет 49) и только под
      // существующим summary: до раскрытия этих строк не бывает вовсе.
      guestEmail: true,
      item: { select: { id: true, title: true, photoKey: true } },
    },
  });

  // «Дошло» этого праздника: receiveGift существует только после summary,
  // поэтому receivedAt >= createdAt summary отсекает и прошлые праздники, и
  // ручные переезды на витрину (`giverName` при ручном переезде не
  // проставляется никогда — его пишет только «Дошло»).
  const receivedItems = await prisma.item.findMany({
    where: {
      roomId: room.id,
      inHall: true,
      giverName: { not: null },
      receivedAt: { gte: revealed.createdAt },
    },
    orderBy: { receivedAt: "desc" },
    select: { id: true, title: true, photoKey: true, giverName: true, receivedAt: true },
  });

  return {
    ...dates,
    goal: await revealedGoal(room.id),
    // Вопрос о связи (тикет 98) — ровно здесь: доска Б12 ставит его после
    // праздника, и здесь же имя дарителя уже раскрыто (инвариант №2).
    consent: await listPendingConsent(userId),
    summary: {
      id: revealed.id,
      date: revealed.date.toISOString(),
      revealedAt: revealed.revealedAt?.toISOString() ?? null,
    },
    pending: bookings.map((booking) => ({
      itemId: booking.item.id,
      title: booking.item.title,
      photoUrl: itemPhotoUrl(booking.item.photoKey),
      mode: booking.mode,
      guestName: booking.guestName,
      canThank: booking.guestEmail !== null,
      thanksEmail: booking.guestEmail,
    })),
    received: receivedItems.map((item) => ({
      itemId: item.id,
      title: item.title,
      photoUrl: itemPhotoUrl(item.photoKey),
      giverName: item.giverName,
      // receivedAt здесь не бывает null: фильтр gte его гарантирует.
      receivedAt: (item.receivedAt ?? new Date(0)).toISOString(),
    })),
    unclaimedCount,
    takenTotal,
  };
}

/**
 * Копилка с раскрытыми именами. Зовётся ТОЛЬКО из ветки «summary существует»
 * выше — иначе имена участников покинули бы «что подарили», а это единственное
 * место, где они раскрываются (инвариант №2).
 *
 * Сумма складывается здесь, а не в сервисе копилки: там её нет ни в одной
 * форме, отдаваемой хозяйке (dto/goal.ts), и заводить её ради этого экрана
 * значило бы открыть дверь, которую инвариант №1 держит закрытой.
 *
 * Копилка без единого участника — null: строка «Вложились ноль» ничего не
 * рассказывает, а цель хозяйка и так знает.
 */
async function revealedGoal(roomId: string): Promise<OccasionGoal | null> {
  const goal = await prisma.roomGoal.findUnique({
    where: { roomId },
    select: { title: true, currency: true },
  });
  if (!goal) return null;

  const pledges = await revealedPledges(roomId);
  if (pledges.length === 0) return null;

  const pledged = pledges.reduce(
    (sum, pledge) => (pledge.amount ? sum.add(new Prisma.Decimal(pledge.amount)) : sum),
    new Prisma.Decimal(0),
  );

  return {
    title: goal.title,
    pledged: pledged.toString(),
    currency: goal.currency,
    givers: pledges.map((pledge) => pledge.name),
  };
}

// ---------- Переход «Дошло» (receiveGift) ----------

/**
 * «Дошло»: ЕДИНСТВЕННЫЙ системный переезд «комната → сокровищница», и
 * единственное место, где раскрывается имя дарителя. ОДНА транзакция — все
 * эффекты вместе или никакие:
 * - inHall=true (вещь уезжает из комнаты на витрину), receivedAt=now,
 *   giverName из брони (или null — брони не было);
 * - бронь закрывается (tx.booking.deleteMany — контракт тикета 09);
 * - Связь: если у брони есть guestUserId (гость дарил залогиненным) — у
 *   хозяйки появляется Connection с гостем, origin `gift:{itemId}`, kind
 *   MUTUAL при своей комнате гостя, иначе FOLLOW (upsertGiftConnection,
 *   сервис связей тикета 11: history «дарил(а) тебе N раз», дедуп зеркальной
 *   пары, апгрейд VIEWED→FOLLOW/MUTUAL). Существующая пара kind/origin не
 *   перезаписывает. Без guestUserId связи нет — есть только имя.
 *   С тикета 98 новая связь рождается ЖДУЩЕЙ согласия обеих сторон: до
 *   ответа её нет ни в чьём списке друзей. Вопрос задаётся ниже на этом же
 *   экране (хозяйке) и на странице друзей (дарителю).
 *
 * Требует существующего OccasionSummary комнаты: раскрытие живёт только
 * в рамках «что подарили» (инвариант №2). Повторный вызов на вещи, которая
 * уже на витрине, — отказ ALREADY_IN_HALL, ничего не меняется: раскрытие
 * бывает ровно один раз.
 *
 * ЧТО ИМЕННО НЕОБРАТИМО. Не место вещи: хозяйка вправе вернуть её в комнату
 * («Вернуть в комнату», items.toggleHall) — и `giverName` при этом остаётся
 * как был, ни второй раз не раскрываясь, ни прячась. Необратимо САМО
 * РАСКРЫТИЕ, и держится оно на двух вещах: `revealedAt` у summary ставится
 * один раз, а имя в `giverName` пишет только эта функция и только у вещи,
 * которая на витрине ещё не лежит.
 */
export async function receiveGift(userId: string, itemId: string): Promise<Item> {
  const ownerId = idSchema.parse(userId);
  const id = idSchema.parse(itemId);

  const updated = await prisma.$transaction(async (tx) => {
    // Ownership фильтром прямо в запросе: чужая вещь неотличима от несуществующей.
    const item = await tx.item.findFirst({
      where: { id, room: { userId: ownerId } },
      include: { booking: true },
    });
    if (!item) {
      throw new OccasionError("NOT_FOUND", "такой вещи нет");
    }
    if (item.inHall) {
      throw new OccasionError("ALREADY_IN_HALL", "«Дошло» уже отмечено — имя раскрыто один раз");
    }
    const summary = await tx.occasionSummary.findFirst({ where: { roomId: item.roomId } });
    if (!summary) {
      throw new OccasionError(
        "NO_SUMMARY",
        "праздник ещё не закрыт — раскрытие живёт только в «что подарили»",
      );
    }

    const booking = item.booking;
    // Guard `inHall: false` в самом updateMany: параллельный двойной клик
    // вторым вызовом получает count=0 → ALREADY_IN_HALL → откат, giverName не
    // затирается.
    const flipped = await tx.item.updateMany({
      where: { id: item.id, inHall: false },
      data: {
        inHall: true,
        hiddenFromHall: false,
        receivedAt: new Date(),
        giverName: booking?.guestName ?? null,
      },
    });
    if (flipped.count === 0) {
      throw new OccasionError("ALREADY_IN_HALL", "«Дошло» уже отмечено — имя раскрыто один раз");
    }

    await tx.booking.deleteMany({ where: { itemId: item.id } });

    if (booking?.guestUserId && booking.guestUserId !== ownerId) {
      // Связь из подарка — сервис связей (тикет 11), в ЭТОЙ ЖЕ транзакции:
      // создание/зеркальный дедуп/апгрейд VIEWED + history «дарил(а) тебе N раз».
      await upsertGiftConnection(tx, {
        receiverUserId: ownerId,
        giverUserId: booking.guestUserId,
        itemId: item.id,
        itemTitle: item.title,
        // Ответ гостя дан ЗАРАНЕЕ, на подтверждении брони (тикет 98b, доска
        // 32a): здесь он только переносится в связь. Не предлагал — связь
        // рождается односторонней («знакомы · подарок в истории»), и хозяйку
        // мы ни о чём не спрашиваем: молчаливой дружбы больше нет, но и
        // вопроса без предложения тоже.
        guestOffered: booking.offersConnection,
      });
    }

    return tx.item.findUniqueOrThrow({ where: { id: item.id } });
  });

  revalidateRoom(updated.roomId);
  return updated;
}

// ---------- Баннер в комнате хозяйки ----------

/**
 * Показывать ли в /room тихую строку «Праздник прошёл — открой „что подарили"».
 * true, если (а) день рождения наступил, а summary этой даты ещё нет, ИЛИ
 * (б) summary есть, а неотмеченные подарки (живые брони) остались.
 *
 * МЕЖДУ ПРАЗДНИКАМИ КОМНАТА МОЛЧИТ — правило прежнее, изменилось только то,
 * чем «между» задаётся. Раньше тишину включала рука: хозяйка ставила новую
 * будущую дату, и свежие брони копились к ней. Дата теперь повторяется сама,
 * «впереди» она всегда, и рукой включать нечего — тишина наступает, когда
 * хвост праздника кончился (`birthday.dueOccasion` вернул null).
 *
 * Комната БЕЗ дня рождения ведёт себя как раньше: закрыть итог она может
 * только рукой, и пока в нём есть неотмеченные подарки, строка висит.
 * Возврат — ГОЛЫЙ boolean: о бронях он говорит не больше, чем счётчик 09.
 *
 * «Праздник прошёл?» спрашивается ОДНИМ местом с экраном «что подарили»
 * (`roomOccasion`, тикет 216) — раньше каждая поверхность считала это сама,
 * и они разошлись у владельца на глазах.
 */
export async function occasionBannerVisible(userId: string): Promise<boolean> {
  const room = await prisma.room.findUnique({
    where: { userId: idSchema.parse(userId) },
    select: { id: true, birthdayDay: true, birthdayMonth: true, birthdayYear: true },
  });
  if (!room) return false;

  const { due, dueClosed, next } = await roomOccasion(room, new Date());
  if (due) {
    if (!dueClosed) return true; // праздник прошёл, а итога ещё нет
  } else if (next) {
    // День рождения есть, но он впереди — до него комнате сказать нечего.
    return false;
  }

  const summary = await prisma.occasionSummary.findFirst({
    where: { roomId: room.id },
    select: { id: true },
  });
  if (!summary) return false;
  const pending = await prisma.booking.count({ where: { item: { roomId: room.id } } });
  return pending > 0;
}
