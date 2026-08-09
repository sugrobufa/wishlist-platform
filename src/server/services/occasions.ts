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
import { roomCacheTag } from "@/server/services/items";
import {
  listPendingConsent,
  upsertGiftConnection,
  type PendingConsentRow,
} from "@/server/services/connections";
import { revealedPledges } from "@/server/services/goal";
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
 * Дата итога: наступившая occasionDate — это итог ПРАЗДНИКА, не клика;
 * без даты (или дата ещё впереди) ручной запуск закрывает «сегодня» (now).
 * Автозапуск (воркер) без наступившей даты не закрывает ничего → null.
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
  const dueDate = room.occasionDate && room.occasionDate <= now ? room.occasionDate : null;
  const date = dueDate ?? (options.manual ? now : null);
  if (!date) return null; // автозакрытию нечего закрывать — даты нет или впереди

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
};

/** Уже отмеченное «Дошло» этого праздника — «уже в зале славы». */
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
  pending: OccasionPendingGift[];
  received: OccasionReceivedGift[];
  /** «Осталось незабранным · N» — вещи комнаты без брони (голое число). */
  unclaimedCount: number;
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
    select: { id: true },
  });
  if (!room) {
    throw new OccasionError("NO_ROOM", "у пользователя нет комнаты — сначала онбординг");
  }

  // Незабранные вещи комнаты остаются в ней до следующего повода (спрятанные
  // хозяйкой в подарочном цикле не участвуют — их бронь снята при скрытии).
  const unclaimedCount = await prisma.item.count({
    where: { roomId: room.id, inHall: false, hidden: false, booking: null },
  });

  const summary = await prisma.occasionSummary.findFirst({
    where: { roomId: room.id },
    orderBy: [{ date: "desc" }, { createdAt: "desc" }],
  });
  if (!summary) {
    // Копилки здесь нет ни строкой: до закрытия праздника хозяйка не видит
    // ни прогресса сбора, ни участников (инвариант №1, ADR-0008).
    return { summary: null, pending: [], received: [], unclaimedCount, goal: null, consent: [] };
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
 * true, если (а) occasionDate прошла, а summary этой даты ещё нет, ИЛИ
 * (б) summary есть, а неотмеченные подарки (живые брони) остались — но не
 * когда хозяйка уже поставила НОВУЮ будущую дату: между праздниками комната
 * молчит, свежие брони копятся к следующему поводу.
 * Возврат — ГОЛЫЙ boolean: о бронях он говорит не больше, чем счётчик 09.
 */
export async function occasionBannerVisible(userId: string): Promise<boolean> {
  const room = await prisma.room.findUnique({
    where: { userId: idSchema.parse(userId) },
    select: { id: true, occasionDate: true },
  });
  if (!room) return false;

  const now = new Date();
  if (room.occasionDate && room.occasionDate <= now) {
    const closed = await prisma.occasionSummary.findFirst({
      where: { roomId: room.id, date: utcDayRange(room.occasionDate) },
      select: { id: true },
    });
    if (!closed) return true; // праздник прошёл, а итога ещё нет
  }
  if (room.occasionDate && room.occasionDate > now) return false;

  const summary = await prisma.occasionSummary.findFirst({
    where: { roomId: room.id },
    select: { id: true },
  });
  if (!summary) return false;
  const pending = await prisma.booking.count({ where: { item: { roomId: room.id } } });
  return pending > 0;
}
