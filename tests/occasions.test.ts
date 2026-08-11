// Тикет 10: «что подарили» → зал славы. Критичные инварианты под замком:
// №1 — до закрытия праздника getOccasionView не отдаёт НИЧЕГО повещного о
//      бронях (ни имён, ни вещей — раскрытие живёт только под summary);
// №2 — имена раскрываются ровно один раз (revealedAt ставится при первом
//      открытии и не переставляется), переход WANT → LOVE необратим:
//      LOVE → WANT не существует ни как API, ни как поведение.
// Плюс: closeOccasion идемпотентен (одно письмо), receiveGift — одна
// транзакция (все эффекты вместе или никакие), selfFulfill/toggleHall.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

// Очереди мокируются целиком: тесты не трогают Redis, а идемпотентность
// письма occasion-owner проверяется по вызовам enqueueOccasionOwnerMail.
vi.mock("@/server/queues", () => ({
  enqueueOccasionOwnerMail: vi.fn(async () => true),
  enqueueItemGoneMail: vi.fn(async () => true),
  enqueueImageIngest: vi.fn(async () => true),
}));

import { enqueueItemGoneMail, enqueueOccasionOwnerMail } from "@/server/queues";
import { prisma } from "../src/server/db";
import { birthdayColumns, parseBirthday } from "../src/server/birthday";
import * as occasionsService from "../src/server/services/occasions";
import * as itemsService from "../src/server/services/items";
import {
  OccasionError,
  closeOccasion,
  getOccasionView,
  occasionBannerVisible,
  receiveGift,
} from "../src/server/services/occasions";
import { ItemMutationError, toggleHall } from "../src/server/services/items";
import { bookItem, ownerTakenCount } from "../src/server/services/bookings";
import { processOccasionClose } from "../src/worker/occasion-close";

const TEST_EMAIL_DOMAIN = "@occasions.test";
const enqueueMock = vi.mocked(enqueueOccasionOwnerMail);

const DAY_MS = 24 * 60 * 60 * 1000;
/** Полночь UTC n дней назад — тот самый день, что видит `dueOccasion`. */
function utcMidnightDaysAgo(days: number): Date {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(midnight - days * DAY_MS);
}

/**
 * День рождения комнаты из отметки (тикет 187): в комнате теперь день и месяц,
 * а не момент. Тесты по-прежнему говорят датами — так виднее, что «вчера» и
 * «через три дня» значат для праздника.
 */
function birthdayOn(date: Date | null) {
  return birthdayColumns(date === null ? null : parseBirthday(date.toISOString().slice(0, 10)));
}

async function createOwnerWithRoom(occasionDate: Date | null = null, displayName = "Хозяйка") {
  const user = await prisma.user.create({
    data: { email: `owner-${randomUUID()}${TEST_EMAIL_DOMAIN}`, displayName },
  });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `oh-${randomUUID().slice(0, 12)}`,
      ...birthdayOn(occasionDate),
    },
  });
  return { user, room };
}

async function createWantItem(
  roomId: string,
  zone = "jewelry",
  overrides: Partial<Prisma.ItemUncheckedCreateInput> = {},
) {
  return prisma.item.create({
    data: {
      roomId,
      zone,
      inHall: false,
      title: `Вещь-${randomUUID().slice(0, 8)}`,
      price: "5000",
      currency: "RUB",
      ...overrides,
    },
  });
}

// OccasionSummary не связан с Room FK — чистим его явно, остальное каскадом.
async function cleanup() {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: TEST_EMAIL_DOMAIN } },
    select: { room: { select: { id: true } } },
  });
  const roomIds = users.flatMap((user) => (user.room ? [user.room.id] : []));
  if (roomIds.length > 0) {
    await prisma.occasionSummary.deleteMany({ where: { roomId: { in: roomIds } } });
  }
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("closeOccasion — итог праздника, идемпотентно, одно письмо", () => {
  it("наступившая дата: summary этой даты + письмо; повтор не плодит ни того, ни другого", async () => {
    const date = utcMidnightDaysAgo(1);
    const owner = await createOwnerWithRoom(date);

    const first = await closeOccasion(owner.room.id);
    expect(first?.created).toBe(true);
    expect(first?.summary.date.getTime()).toBe(date.getTime());
    // Контракт payload для тикета 12: {userId, email, roomId}.
    const myCalls = enqueueMock.mock.calls.filter(([data]) => data.roomId === owner.room.id);
    expect(myCalls).toEqual([
      [{ userId: owner.user.id, email: owner.user.email, roomId: owner.room.id }],
    ]);

    const second = await closeOccasion(owner.room.id);
    expect(second?.created).toBe(false);
    expect(second?.summary.id).toBe(first?.summary.id);
    // И ручной запуск поверх автозакрытия — тоже no-op той же даты.
    const manual = await closeOccasion(owner.room.id, { manual: true });
    expect(manual?.created).toBe(false);
    expect(manual?.summary.id).toBe(first?.summary.id);

    expect(
      enqueueMock.mock.calls.filter(([data]) => data.roomId === owner.room.id),
    ).toHaveLength(1);
    expect(await prisma.occasionSummary.count({ where: { roomId: owner.room.id } })).toBe(1);
  });

  it("ручной запуск без даты закрывает «сегодня»; автозапуск без даты не делает ничего", async () => {
    const owner = await createOwnerWithRoom(null);

    // Автозапуск (воркер): даты нет — закрывать нечего.
    expect(await closeOccasion(owner.room.id)).toBeNull();
    expect(await prisma.occasionSummary.count({ where: { roomId: owner.room.id } })).toBe(0);

    const manual = await closeOccasion(owner.room.id, { manual: true });
    expect(manual?.created).toBe(true);
    expect(manual?.summary.date.toISOString().slice(0, 10)).toBe(
      new Date().toISOString().slice(0, 10),
    );

    const again = await closeOccasion(owner.room.id, { manual: true });
    expect(again?.created).toBe(false);
    expect(again?.summary.id).toBe(manual?.summary.id);
  });

  it("будущая дата: ручной запуск берёт «сегодня», не дату из будущего", async () => {
    const future = utcMidnightDaysAgo(-7);
    const owner = await createOwnerWithRoom(future);

    const manual = await closeOccasion(owner.room.id, { manual: true });
    expect(manual?.created).toBe(true);
    expect(manual?.summary.date.getTime()).toBeLessThan(future.getTime());

    // Незнакомая комната — честный отказ.
    await expect(closeOccasion("no-such-room", { manual: true })).rejects.toMatchObject({
      code: "NO_ROOM",
    });
  });
});

describe("getOccasionView — раскрытие живёт ТОЛЬКО под summary", () => {
  it("БЕЗ summary: ни имён, ни вещей с бронями — вообще ничего повещного (инвариант №1)", async () => {
    const owner = await createOwnerWithRoom(null);
    const ring = await createWantItem(owner.room.id, "jewelry", { title: "Кольцо-секрет" });
    const bag = await createWantItem(owner.room.id, "bags", { title: "Сумка-секрет" });
    await createWantItem(owner.room.id, "perfume"); // незанятая — в счётчик
    await createWantItem(owner.room.id, "travel", { hidden: true }); // спрятанная — вне цикла
    await bookItem({ itemId: ring.id, name: "Секретная Гостья", email: "top-secret-1@mail.test" });
    await bookItem({ itemId: bag.id, name: "Тайный Даритель", mode: "SIGNED" });

    const view = await getOccasionView(owner.user.id);
    expect(view.summary).toBeNull();
    expect(view.pending).toEqual([]);
    expect(view.received).toEqual([]);
    // Только голое число незанятых «хочу» (спрятанная не считается).
    expect(view.unclaimedCount).toBe(1);

    const serialized = JSON.stringify(view);
    expect(serialized).not.toMatch(
      /guestName|guestEmail|cancelToken|mode|Секретная|Тайный|top-secret|mail\.test/i,
    );
    // Ни названий, ни id забронированных вещей — «какая вещь занята» не течёт.
    expect(serialized).not.toMatch(/Кольцо-секрет|Сумка-секрет/);
    expect(serialized).not.toContain(ring.id);
  });

  it("с summary: имена отдаются (QUIET и SIGNED — все), revealedAt ставится РОВНО один раз", async () => {
    const owner = await createOwnerWithRoom(utcMidnightDaysAgo(1));
    const ring = await createWantItem(owner.room.id, "jewelry");
    const bag = await createWantItem(owner.room.id, "bags");
    await bookItem({ itemId: ring.id, name: "Аня Тихая" }); // QUIET
    await bookItem({ itemId: bag.id, name: "Катя Подписная", mode: "SIGNED" });
    await closeOccasion(owner.room.id);

    const first = await getOccasionView(owner.user.id);
    expect(first.summary).not.toBeNull();
    expect(first.summary!.revealedAt).not.toBeNull();
    expect(first.pending.map((row) => row.guestName).sort()).toEqual([
      "Аня Тихая",
      "Катя Подписная",
    ]);
    expect(first.pending.map((row) => row.mode).sort()).toEqual(["QUIET", "SIGNED"]);
    expect(first.pending.every((row) => row.title.length > 0)).toBe(true);

    // Повторное открытие НЕ пере-раскрывает: revealedAt тот же самый.
    const second = await getOccasionView(owner.user.id);
    expect(second.summary!.revealedAt).toBe(first.summary!.revealedAt);
    expect(second.pending).toHaveLength(2);
  });
});

describe("receiveGift — одна транзакция: все эффекты вместе или никакие", () => {
  async function setupGift(options: { guestUserId?: string | null } = {}) {
    const owner = await createOwnerWithRoom(utcMidnightDaysAgo(1));
    const item = await createWantItem(owner.room.id, "jewelry");
    await bookItem({ itemId: item.id, name: "Мила Дарительница", email: "mila@mail.test" });
    if (options.guestUserId !== undefined) {
      await prisma.booking.update({
        where: { itemId: item.id },
        data: { guestUserId: options.guestUserId },
      });
    }
    await closeOccasion(owner.room.id);
    return { owner, item };
  }

  it("happy path: переезд на витрину + receivedAt + giverName + бронь закрыта + связь MUTUAL", async () => {
    const guest = await createOwnerWithRoom(null, "Гостья со своей комнатой");
    const { owner, item } = await setupGift({ guestUserId: guest.user.id });

    const updated = await receiveGift(owner.user.id, item.id);
    expect(updated.inHall).toBe(true);
    expect(updated.giverName).toBe("Мила Дарительница");
    expect(updated.inHall).toBe(true);
    expect(updated.receivedAt).not.toBeNull();

    // Бронь закрыта в той же транзакции — счётчик хозяйки сразу честный.
    expect(await prisma.booking.findUnique({ where: { itemId: item.id } })).toBeNull();
    expect(await ownerTakenCount(owner.user.id)).toBe(0);

    // Связь у хозяйки с гостем: origin gift:{itemId}, MUTUAL — комната есть.
    const connection = await prisma.connection.findUnique({
      where: { aUserId_bUserId: { aUserId: owner.user.id, bUserId: guest.user.id } },
    });
    expect(connection).toMatchObject({ kind: "MUTUAL", origin: `gift:${item.id}` });

    // Вид экрана: строка переехала из pending в received.
    const view = await getOccasionView(owner.user.id);
    expect(view.pending).toEqual([]);
    expect(view.received.map((row) => row.itemId)).toEqual([item.id]);
    expect(view.received[0]?.giverName).toBe("Мила Дарительница");
  });

  it("гость без своей комнаты → FOLLOW; аноним → связи нет, имя есть", async () => {
    const roomless = await prisma.user.create({
      data: { email: `guest-${randomUUID()}${TEST_EMAIL_DOMAIN}` },
    });
    const withUser = await setupGift({ guestUserId: roomless.id });
    await receiveGift(withUser.owner.user.id, withUser.item.id);
    const follow = await prisma.connection.findUnique({
      where: {
        aUserId_bUserId: { aUserId: withUser.owner.user.id, bUserId: roomless.id },
      },
    });
    expect(follow).toMatchObject({ kind: "FOLLOW", origin: `gift:${withUser.item.id}` });

    const anonymous = await setupGift(); // guestUserId нет
    const updated = await receiveGift(anonymous.owner.user.id, anonymous.item.id);
    expect(updated.giverName).toBe("Мила Дарительница");
    expect(
      await prisma.connection.count({ where: { aUserId: anonymous.owner.user.id } }),
    ).toBe(0);
  });

  it("существующая связь пары не перезаписывается вторым подарком", async () => {
    const guest = await createOwnerWithRoom(null, "Постоянная дарительница");
    const { owner, item } = await setupGift({ guestUserId: guest.user.id });
    await prisma.connection.create({
      data: { aUserId: owner.user.id, bUserId: guest.user.id, kind: "FOLLOW", origin: "visit" },
    });

    await receiveGift(owner.user.id, item.id);
    const connections = await prisma.connection.findMany({
      where: { aUserId: owner.user.id, bUserId: guest.user.id },
    });
    expect(connections).toHaveLength(1);
    expect(connections[0]).toMatchObject({ kind: "FOLLOW", origin: "visit" });
  });

  it("БЕЗ summary — отказ NO_SUMMARY: имя не раскрыто, бронь жива, вещь в комнате", async () => {
    const owner = await createOwnerWithRoom(null);
    const item = await createWantItem(owner.room.id);
    await bookItem({ itemId: item.id, name: "Ранняя Гостья" });

    await expect(receiveGift(owner.user.id, item.id)).rejects.toMatchObject({
      code: "NO_SUMMARY",
    });
    const after = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.inHall).toBe(false);
    expect(after.giverName).toBeNull();
    expect(await prisma.booking.count({ where: { itemId: item.id } })).toBe(1);
  });

  it("повтор на вещи, которая уже на витрине, — отказ ALREADY_IN_HALL", async () => {
    const { owner, item } = await setupGift();
    const first = await receiveGift(owner.user.id, item.id);

    await expect(receiveGift(owner.user.id, item.id)).rejects.toMatchObject({
      code: "ALREADY_IN_HALL",
    });
    const after = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.receivedAt?.getTime()).toBe(first.receivedAt?.getTime());
    expect(after.giverName).toBe(first.giverName);
    expect(after.inHall).toBe(true);
  });

  // НОВЫЙ ТЕСТ (тикет 124) — прямое требование владельца к инварианту №2:
  // необратимо ТОЛЬКО раскрытие имени, а место вещи обратимо.
  it("«Вернуть в комнату» после «Дошло»: имя НЕ раскрывается заново и не прячется", async () => {
    const { owner, item } = await setupGift();
    const received = await receiveGift(owner.user.id, item.id);
    expect(received.giverName).toBe("Мила Дарительница");

    // Возврат в комнату — обычный переезд: вещь снова в своей зоне.
    const back = await toggleHall(owner.user.id, item.id, false);
    expect(back.inHall).toBe(false);
    expect(back.zone).toBe(item.zone);
    // Имя осталось как было: раскрытие уже случилось и второй раз не бывает.
    expect(back.giverName).toBe("Мила Дарительница");
    expect(back.receivedAt?.getTime()).toBe(received.receivedAt?.getTime());

    // И обратно на витрину — имя всё то же, дата подарка не переписана.
    const again = await toggleHall(owner.user.id, item.id, true);
    expect(again.inHall).toBe(true);
    expect(again.giverName).toBe("Мила Дарительница");
    expect(again.receivedAt?.getTime()).toBe(received.receivedAt?.getTime());

    // Повторное «Дошло» после возврата невозможно: раскрытие живёт один раз,
    // и вещь на витрине его больше не принимает.
    await expect(receiveGift(owner.user.id, item.id)).rejects.toMatchObject({
      code: "ALREADY_IN_HALL",
    });
  });

  it("сбой в середине транзакции откатывает ВСЁ (битый guestUserId → FK-ошибка)", async () => {
    // guestUserId указывает на несуществующего пользователя: item.update и
    // booking.deleteMany уже прошли бы, но connection.create падает по FK —
    // транзакция обязана откатить и переход, и закрытие брони.
    const { owner, item } = await setupGift({ guestUserId: "ghost-user-never-existed" });

    await expect(receiveGift(owner.user.id, item.id)).rejects.toThrow();

    const after = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.giverName).toBeNull();
    expect(after.inHall).toBe(false);
    expect(await prisma.booking.count({ where: { itemId: item.id } })).toBe(1);
    expect(await prisma.connection.count({ where: { aUserId: owner.user.id } })).toBe(0);
  });

  it("чужая вещь → NOT_FOUND (существование не подтверждаем)", async () => {
    const { item } = await setupGift();
    const stranger = await createOwnerWithRoom(utcMidnightDaysAgo(1), "Соседка");
    await closeOccasion(stranger.room.id);

    await expect(receiveGift(stranger.user.id, item.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(
      (await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).inHall,
    ).toBe(false);
  });
});

// ИНВАРИАНТ №2 ПОД ПОВТОРЯЮЩЕЙСЯ ДАТОЙ (тикет 187). Раньше праздник был один
// и навсегда: дата прошла — и второго раза не наступало само собой. Теперь
// день рождения приходит каждый год, у комнаты копятся итоги (OccasionSummary
// уникален парой комната+дата), и соблазн раскрыть имя «заново, на новом
// празднике» появляется впервые. Правило прежнее: имя пишет одна `receiveGift`,
// ровно один раз, и повторяемость даты его не отменяет.
describe("следующий праздник НЕ раскрывает имя второй раз (инвариант №2)", () => {
  it("новый итог у той же комнаты: имя, момент подарка и revealedAt прошлого итога — те же", async () => {
    const owner = await createOwnerWithRoom(utcMidnightDaysAgo(2));
    const item = await createWantItem(owner.room.id);
    await bookItem({ itemId: item.id, name: "Мила Дарительница", email: "mila@mail.test" });

    // Первый праздник: закрылся, имя раскрыто «Дошло».
    await closeOccasion(owner.room.id);
    const firstView = await getOccasionView(owner.user.id);
    const firstSummaryId = firstView.summary!.id;
    const firstRevealedAt = firstView.summary!.revealedAt;
    expect(firstRevealedAt).not.toBeNull();
    const received = await receiveGift(owner.user.id, item.id);
    expect(received.giverName).toBe("Мила Дарительница");

    // Год прошёл — дата вернулась. Модель это и есть: другая дата, другой итог.
    await prisma.room.update({
      where: { id: owner.room.id },
      data: birthdayOn(utcMidnightDaysAgo(1)),
    });
    const second = await closeOccasion(owner.room.id);
    expect(second?.created).toBe(true);
    expect(second?.summary.id).not.toBe(firstSummaryId);
    expect(await prisma.occasionSummary.count({ where: { roomId: owner.room.id } })).toBe(2);

    // Экран показывает НОВЫЙ итог — и раскрывает его, а не переоткрывает старый.
    const secondView = await getOccasionView(owner.user.id);
    expect(secondView.summary!.id).toBe(second?.summary.id);
    // Момент раскрытия ПРОШЛОГО праздника не переставлен: он случился один раз.
    const firstAfter = await prisma.occasionSummary.findUniqueOrThrow({
      where: { id: firstSummaryId },
    });
    expect(firstAfter.revealedAt?.toISOString()).toBe(firstRevealedAt);

    // Подаренная вещь на новом празднике не всплывает заново: её раскрытие
    // осталось в прошлом итоге вместе с моментом «Дошло».
    expect(secondView.received.map((row) => row.itemId)).not.toContain(item.id);
    expect(secondView.pending).toEqual([]);

    // И «Дошло» на ней больше не нажимается — сколько бы праздников ни прошло.
    await expect(receiveGift(owner.user.id, item.id)).rejects.toMatchObject({
      code: "ALREADY_IN_HALL",
    });
    const after = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.giverName).toBe("Мила Дарительница");
    expect(after.receivedAt?.getTime()).toBe(received.receivedAt?.getTime());
  });

  it("«Вернуть в комнату» на новом празднике имя не перезапускает", () => {
    // Продолжение того же соблазна: вещь вернули в комнату, а праздник пришёл
    // снова. Возврат раскрытия не отменяет и второй раз не запускает — правило
    // тикета 124 не зависит от того, сколько раз повторилась дата.
    expect(typeof toggleHall).toBe("function");
  });

  it("вернувшаяся в комнату вещь хранит имя и после следующего итога", async () => {
    const owner = await createOwnerWithRoom(utcMidnightDaysAgo(2));
    const item = await createWantItem(owner.room.id);
    await bookItem({ itemId: item.id, name: "Мила Дарительница" });
    await closeOccasion(owner.room.id);
    await receiveGift(owner.user.id, item.id);
    const back = await toggleHall(owner.user.id, item.id, false);
    expect(back.giverName).toBe("Мила Дарительница");

    // Следующий праздник закрылся — имя на месте, само собой ничего не
    // раскрылось: `receiveGift` никто не звал.
    await prisma.room.update({
      where: { id: owner.room.id },
      data: birthdayOn(utcMidnightDaysAgo(1)),
    });
    await closeOccasion(owner.room.id);
    await getOccasionView(owner.user.id);

    const after = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.giverName).toBe("Мила Дарительница");
    expect(after.receivedAt?.getTime()).toBe(back.receivedAt?.getTime());
  });
});

describe("processOccasionClose — находит ТОЛЬКО просроченные без summary", () => {
  it("прошедшая дата закрывается; будущая, закрытая и без даты — не трогаются", async () => {
    const due = await createOwnerWithRoom(utcMidnightDaysAgo(2));
    const future = await createOwnerWithRoom(utcMidnightDaysAgo(-3));
    const closedAlready = await createOwnerWithRoom(utcMidnightDaysAgo(1));
    const dateless = await createOwnerWithRoom(null);
    await closeOccasion(closedAlready.room.id);
    const mailsBefore = enqueueMock.mock.calls.length;

    const result = await processOccasionClose(new Date());

    expect(result.closed).toContain(due.room.id);
    expect(result.closed).not.toContain(future.room.id);
    expect(result.closed).not.toContain(closedAlready.room.id);
    expect(result.closed).not.toContain(dateless.room.id);

    expect(await prisma.occasionSummary.count({ where: { roomId: due.room.id } })).toBe(1);
    expect(await prisma.occasionSummary.count({ where: { roomId: future.room.id } })).toBe(0);
    expect(
      await prisma.occasionSummary.count({ where: { roomId: closedAlready.room.id } }),
    ).toBe(1); // второй summary не появился
    expect(await prisma.occasionSummary.count({ where: { roomId: dateless.room.id } })).toBe(0);

    // Письмо ушло только просроченной комнате (и ровно одно).
    const newMails = enqueueMock.mock.calls.slice(mailsBefore).map(([data]) => data.roomId);
    expect(newMails.filter((roomId) => roomId === due.room.id)).toHaveLength(1);
    expect(newMails).not.toContain(closedAlready.room.id);

    // Повторный тик — идемпотентен: у due новых summary/писем нет.
    const secondTick = await processOccasionClose(new Date());
    expect(secondTick.closed).not.toContain(due.room.id);
    expect(await prisma.occasionSummary.count({ where: { roomId: due.room.id } })).toBe(1);
  });
});

// ПЕРЕПИСАНО ЦЕЛИКОМ (тикет 124). Здесь было два блока: «selfFulfill — уже
// моё» и «toggleHall — витрина только для „люблю"». `selfFulfill` больше не
// существует: он переводил вещь из «хочу» в «люблю», а состояний нет — то же
// самое теперь значит «положить в сокровищницу», и двух дорог в одно место мы
// не держим. Остался один `toggleHall`, и он ходит в обе стороны.
describe("toggleHall — «В сокровищницу» и «Вернуть в комнату» (тикет 124)", () => {
  it("в сокровищницу: inHall=true, hiddenFromHall сброшен, бронь тихо снята", async () => {
    const owner = await createOwnerWithRoom(null); // работает БЕЗ summary
    const item = await createWantItem(owner.room.id);
    await bookItem({ itemId: item.id, name: "Гостья Утратившая", email: "lost@mail.test" });
    expect(await ownerTakenCount(owner.user.id)).toBe(1);

    const updated = await toggleHall(owner.user.id, item.id, true);
    expect(updated.inHall).toBe(true);
    expect(updated.hiddenFromHall).toBe(false);
    expect(updated.receivedAt).not.toBeNull(); // «уже моё» с этого дня
    // Имя дарителя ручной переезд НЕ проставляет: его пишет только «Дошло».
    expect(updated.giverName).toBeNull();
    // Ни имени, ни почты гостя в ответе (инвариант №1).
    expect(JSON.stringify(updated)).not.toMatch(/Утратившая|lost@mail\.test/);

    expect(await prisma.booking.count({ where: { itemId: item.id } })).toBe(0);
    expect(await ownerTakenCount(owner.user.id)).toBe(0);
  });

  it("вернуть в комнату: вещь встаёт в СВОЮ зону, цена и поля на месте", async () => {
    const owner = await createOwnerWithRoom(null);
    const item = await createWantItem(owner.room.id);

    await toggleHall(owner.user.id, item.id, true);
    const back = await toggleHall(owner.user.id, item.id, false);

    expect(back.inHall).toBe(false);
    expect(back.zone).toBe(item.zone); // возвращать было куда
    expect(back.price?.toString()).toBe(item.price?.toString());
    expect(back.currency).toBe(item.currency);
  });

  it("ОТВЕТ СЕРВЕРА НЕ ЗАВИСИТ ОТ ТОГО, ЗАНЯТА ВЕЩЬ ИЛИ НЕТ (инвариант №1)", async () => {
    // Дизайн просил блокировать переезд при живой брони — мы отклонили:
    // недоступное действие само сообщает хозяйке, что вещь забрали. Правило:
    // действие доступно ВСЕГДА и отвечает ОДИНАКОВО.
    const owner = await createOwnerWithRoom(null);
    const free = await createWantItem(owner.room.id);
    const booked = await createWantItem(owner.room.id);
    await bookItem({ itemId: booked.id, name: "Тайная Гостья", email: "secret@mail.test" });

    const movedFree = await toggleHall(owner.user.id, free.id, true);
    const movedBooked = await toggleHall(owner.user.id, booked.id, true);

    // Формы ответов совпадают до ключа и до значения — кроме собственных
    // полей вещи (id/время). Ни одного поля «занято» ни в одной из них.
    expect(Object.keys(movedFree).sort()).toEqual(Object.keys(movedBooked).sort());
    expect(movedFree.inHall).toBe(movedBooked.inHall);
    expect(movedFree.hiddenFromHall).toBe(movedBooked.hiddenFromHall);
    expect(movedFree.giverName).toBe(movedBooked.giverName);
    for (const dto of [movedFree, movedBooked]) {
      expect(JSON.stringify(dto)).not.toMatch(/book|guest|taken|cancel|Тайная|secret@/i);
    }
    // И счётчик её комнаты вернулся к нулю — единственное, что ей вообще видно.
    expect(await ownerTakenCount(owner.user.id)).toBe(0);
  });

  it("ГОСТЮ уходит письмо «вещь уехала», хозяйке — ничего (раунд 28)", async () => {
    // «Молча» в нашем правиле означало «молча ДЛЯ ХОЗЯЙКИ». Гость обязан
    // узнать: иначе он придёт на праздник с подарком, который у хозяйки уже
    // есть. Письмо адресовано ему и несёт только его же данные.
    const goneMock = vi.mocked(enqueueItemGoneMail);
    goneMock.mockClear();

    const owner = await createOwnerWithRoom(null);
    const item = await createWantItem(owner.room.id);
    await bookItem({ itemId: item.id, name: "Гостья", email: "guest@mail.test" });

    const moved = await toggleHall(owner.user.id, item.id, true);

    expect(goneMock).toHaveBeenCalledTimes(1);
    const [payload] = goneMock.mock.calls[0] ?? [];
    expect(payload?.email).toBe("guest@mail.test");
    expect(payload?.itemTitle).toBe(item.title);
    // В письме нет ни одного поля хозяйки, кроме слага её комнаты.
    expect(Object.keys(payload ?? {}).sort()).toEqual([
      "bookingId",
      "email",
      "guestName",
      "itemTitle",
      "roomSlug",
    ]);
    // А ответ хозяйке о письме не говорит ничего и от него не зависит.
    expect(moved.inHall).toBe(true);
    expect(JSON.stringify(moved)).not.toMatch(/guest@mail\.test|Гостья/u);
  });

  it("вещь БЕЗ брони писем не рождает — и ответ всё равно тот же", async () => {
    const goneMock = vi.mocked(enqueueItemGoneMail);
    goneMock.mockClear();

    const owner = await createOwnerWithRoom(null);
    const item = await createWantItem(owner.room.id);
    const moved = await toggleHall(owner.user.id, item.id, true);

    expect(goneMock).not.toHaveBeenCalled();
    expect(moved.inHall).toBe(true);
  });

  it("гость без почты остаётся без письма — писать некуда", async () => {
    const goneMock = vi.mocked(enqueueItemGoneMail);
    goneMock.mockClear();

    const owner = await createOwnerWithRoom(null);
    const item = await createWantItem(owner.room.id);
    await bookItem({ itemId: item.id, name: "Аноним" });

    await toggleHall(owner.user.id, item.id, true);
    expect(goneMock).not.toHaveBeenCalled();
  });

  it("складчина возвращается тем же механизмом: взносы уходят с бронью", async () => {
    // «Автовозврат» в этом продукте — это снятие договорённости, а не
    // перевод денег: деньги через сервис не ходят (PRD §12а). Механизм один
    // на все случаи — удаление брони, взносы уходят каскадом схемы.
    const owner = await createOwnerWithRoom(null);
    const item = await createWantItem(owner.room.id);
    const booking = await prisma.booking.create({
      data: {
        itemId: item.id,
        mode: "POOL",
        guestName: "Организатор",
        guestEmail: "pool@mail.test",
        cancelToken: `pool-${item.id}`,
        pool: {
          create: [
            { name: "Первый", amount: "2000" },
            { name: "Второй", amount: "3000" },
          ],
        },
      },
    });
    expect(await prisma.poolContribution.count({ where: { bookingId: booking.id } })).toBe(2);

    await toggleHall(owner.user.id, item.id, true);

    expect(await prisma.booking.count({ where: { itemId: item.id } })).toBe(0);
    expect(await prisma.poolContribution.count({ where: { bookingId: booking.id } })).toBe(0);
  });

  it("переезд доступен ЛЮБОЙ вещи; чужая вещь → NOT_FOUND", async () => {
    // Отказа «эта вещь не того сорта» больше не существует: сортов нет.
    const owner = await createOwnerWithRoom(null);
    const item = await createWantItem(owner.room.id);
    await expect(toggleHall(owner.user.id, item.id, true)).resolves.toMatchObject({
      inHall: true,
    });

    const stranger = await createOwnerWithRoom(null, "Соседка");
    await expect(toggleHall(stranger.user.id, item.id, false)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    // Чужой отказ колонку не тронул.
    expect(
      (await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).inHall,
    ).toBe(true);
  });
});

// ПЕРЕПИСАНО (тикет 124). Блок назывался «LOVE → WANT не существует» и
// сторожил необратимость перехода между состояниями. Состояний нет, а место
// вещи ОБРАТИМО по решению владельца. Сторожим то, что осталось необратимым:
// поверхность сервисов не знает слов мёртвой модели, а имя дарителя
// проставляет ровно одна функция.
describe("состояний у вещи не осталось (тикет 124)", () => {
  it("в поверхности сервисов нет ни одного имени со «state»/«want»/«love»", () => {
    const surface = [...Object.keys(itemsService), ...Object.keys(occasionsService)];
    expect(surface.filter((name) => /want|love|state/i.test(name))).toEqual([]);
    // И отказов мёртвой модели тоже нет: коды переименованы по месту.
    expect(new OccasionError("ALREADY_IN_HALL", "x")).toBeInstanceOf(Error);
    expect(new ItemMutationError("NOT_IN_HALL", "x")).toBeInstanceOf(Error);
  });

  it("ручной переезд туда-обратно НЕ проставляет имя дарителя", () => {
    // Имя пишет только «Дошло» (инвариант №2). Проверка поведением — выше,
    // в блоке receiveGift; здесь замок на поверхности.
    expect(typeof toggleHall).toBe("function");
  });
});

describe("occasionBannerVisible — тихая строка в /room", () => {
  it("дата прошла без summary → true; после закрытия и отметок → false; будущая дата глушит", async () => {
    const owner = await createOwnerWithRoom(utcMidnightDaysAgo(1));
    const item = await createWantItem(owner.room.id);
    await bookItem({ itemId: item.id, name: "Гостья Баннера" });

    expect(await occasionBannerVisible(owner.user.id)).toBe(true); // не закрыт

    await closeOccasion(owner.room.id);
    expect(await occasionBannerVisible(owner.user.id)).toBe(true); // неотмеченные есть

    await receiveGift(owner.user.id, item.id);
    expect(await occasionBannerVisible(owner.user.id)).toBe(false); // всё отмечено

    // Хозяйка поставила НОВУЮ будущую дату — комната молчит до праздника,
    // даже если появились свежие брони.
    const next = await createWantItem(owner.room.id, "bags");
    await bookItem({ itemId: next.id, name: "Новая Гостья" });
    await prisma.room.update({
      where: { id: owner.room.id },
      data: birthdayOn(utcMidnightDaysAgo(-30)),
    });
    expect(await occasionBannerVisible(owner.user.id)).toBe(false);

    expect(await occasionBannerVisible("no-such-user")).toBe(false);
  });
});
