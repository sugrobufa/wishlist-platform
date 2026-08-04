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
  enqueueImageIngest: vi.fn(async () => true),
}));

import { enqueueOccasionOwnerMail } from "@/server/queues";
import { prisma } from "../src/server/db";
import * as occasionsService from "../src/server/services/occasions";
import * as itemsService from "../src/server/services/items";
import {
  OccasionError,
  closeOccasion,
  getOccasionView,
  occasionBannerVisible,
  receiveGift,
} from "../src/server/services/occasions";
import { ItemMutationError, selfFulfill, toggleHall } from "../src/server/services/items";
import { bookItem, ownerTakenCount } from "../src/server/services/bookings";
import { processOccasionClose } from "../src/worker/occasion-close";

const TEST_EMAIL_DOMAIN = "@occasions.test";
const enqueueMock = vi.mocked(enqueueOccasionOwnerMail);

const DAY_MS = 24 * 60 * 60 * 1000;
/** Полночь UTC n дней назад — как occasionDate из настроек (тикет 13). */
function utcMidnightDaysAgo(days: number): Date {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(midnight - days * DAY_MS);
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
      occasionDate,
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
      state: "WANT",
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

  it("happy path: LOVE + receivedAt + giverName + inHall + бронь закрыта + связь MUTUAL", async () => {
    const guest = await createOwnerWithRoom(null, "Гостья со своей комнатой");
    const { owner, item } = await setupGift({ guestUserId: guest.user.id });

    const updated = await receiveGift(owner.user.id, item.id);
    expect(updated.state).toBe("LOVE");
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

  it("БЕЗ summary — отказ NO_SUMMARY: имя не раскрыто, бронь жива, вещь осталась «хочу»", async () => {
    const owner = await createOwnerWithRoom(null);
    const item = await createWantItem(owner.room.id);
    await bookItem({ itemId: item.id, name: "Ранняя Гостья" });

    await expect(receiveGift(owner.user.id, item.id)).rejects.toMatchObject({
      code: "NO_SUMMARY",
    });
    const after = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.state).toBe("WANT");
    expect(after.giverName).toBeNull();
    expect(await prisma.booking.count({ where: { itemId: item.id } })).toBe(1);
  });

  it("повторный вызов на уже LOVE — отказ NOT_WANT, ничего не изменилось", async () => {
    const { owner, item } = await setupGift();
    const first = await receiveGift(owner.user.id, item.id);

    await expect(receiveGift(owner.user.id, item.id)).rejects.toMatchObject({
      code: "NOT_WANT",
    });
    const after = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.receivedAt?.getTime()).toBe(first.receivedAt?.getTime());
    expect(after.giverName).toBe(first.giverName);
    expect(after.state).toBe("LOVE");
  });

  it("сбой в середине транзакции откатывает ВСЁ (битый guestUserId → FK-ошибка)", async () => {
    // guestUserId указывает на несуществующего пользователя: item.update и
    // booking.deleteMany уже прошли бы, но connection.create падает по FK —
    // транзакция обязана откатить и переход, и закрытие брони.
    const { owner, item } = await setupGift({ guestUserId: "ghost-user-never-existed" });

    await expect(receiveGift(owner.user.id, item.id)).rejects.toThrow();

    const after = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(after.state).toBe("WANT");
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
      (await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).state,
    ).toBe("WANT");
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

describe("selfFulfill — «уже моё»: без дарителя, без раскрытий, бронь снимается", () => {
  it("WANT → LOVE: giverName=null, inHall=false, receivedAt=now; бронь тихо снята", async () => {
    const owner = await createOwnerWithRoom(null); // работает БЕЗ summary
    const item = await createWantItem(owner.room.id);
    await bookItem({ itemId: item.id, name: "Гостья Утратившая", email: "lost@mail.test" });
    expect(await ownerTakenCount(owner.user.id)).toBe(1);

    const updated = await selfFulfill(owner.user.id, item.id);
    expect(updated.state).toBe("LOVE");
    expect(updated.giverName).toBeNull();
    expect(updated.inHall).toBe(false);
    expect(updated.receivedAt).not.toBeNull();
    // Имя гостя не всплывает и здесь (раскрытий у «уже моё» нет вовсе).
    expect(JSON.stringify(updated)).not.toMatch(/Утратившая|lost@mail\.test/);

    expect(await prisma.booking.count({ where: { itemId: item.id } })).toBe(0);
    expect(await ownerTakenCount(owner.user.id)).toBe(0);
  });

  it("на LOVE — отказ NOT_WANT (ничего не меняется); чужая вещь → NOT_FOUND", async () => {
    const owner = await createOwnerWithRoom(null);
    const love = await prisma.item.create({
      data: { roomId: owner.room.id, zone: "jewelry", state: "LOVE", title: "Цепочка" },
    });
    await expect(selfFulfill(owner.user.id, love.id)).rejects.toMatchObject({
      code: "NOT_WANT",
    });
    expect(
      (await prisma.item.findUniqueOrThrow({ where: { id: love.id } })).receivedAt,
    ).toBeNull();

    const stranger = await createOwnerWithRoom(null, "Соседка");
    const item = await createWantItem(owner.room.id);
    await expect(selfFulfill(stranger.user.id, item.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("toggleHall — витрина только для «люблю»", () => {
  it("on: inHall=true и сброс hiddenFromHall; off: только inHall=false", async () => {
    const owner = await createOwnerWithRoom(null);
    const love = await prisma.item.create({
      data: {
        roomId: owner.room.id,
        zone: "jewelry",
        state: "LOVE",
        title: "Браслет",
        hiddenFromHall: true,
      },
    });

    const on = await toggleHall(owner.user.id, love.id, true);
    expect(on.inHall).toBe(true);
    expect(on.hiddenFromHall).toBe(false); // возврат в витрину снимает прятанье

    const off = await toggleHall(owner.user.id, love.id, false);
    expect(off.inHall).toBe(false);
    expect(off.hiddenFromHall).toBe(false);
  });

  it("«хочу» в зал не попадает: NOT_LOVE; чужая вещь → NOT_FOUND", async () => {
    const owner = await createOwnerWithRoom(null);
    const want = await createWantItem(owner.room.id);
    await expect(toggleHall(owner.user.id, want.id, true)).rejects.toMatchObject({
      code: "NOT_LOVE",
    });
    expect(
      (await prisma.item.findUniqueOrThrow({ where: { id: want.id } })).inHall,
    ).toBe(false);

    const stranger = await createOwnerWithRoom(null, "Соседка");
    await expect(toggleHall(stranger.user.id, want.id, true)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("LOVE → WANT не существует", () => {
  it("ни в items, ни в occasions нет API обратного перехода — а прямые повторы отказывают", async () => {
    // Поверхность сервисов: ни одного экспорта, в имени которого есть «want»
    // (единственный переход в WANT — создание вещи, createItem).
    const surface = [...Object.keys(itemsService), ...Object.keys(occasionsService)];
    expect(surface.filter((name) => /want/i.test(name))).toEqual([]);
    // Не даём и залезть мимо API: у ошибок переходов правильные классы.
    expect(new OccasionError("NOT_WANT", "x")).toBeInstanceOf(Error);
    expect(new ItemMutationError("NOT_WANT", "x")).toBeInstanceOf(Error);

    // Поведение: вещь, ставшая LOVE, не возвращается в WANT ни одним сервисом
    // (receiveGift/selfFulfill на LOVE — отказ, покрыто выше); эталонная
    // проверка стейта после всех отказов:
    const owner = await createOwnerWithRoom(null);
    const love = await prisma.item.create({
      data: { roomId: owner.room.id, zone: "jewelry", state: "LOVE", title: "Как было" },
    });
    await expect(selfFulfill(owner.user.id, love.id)).rejects.toMatchObject({ code: "NOT_WANT" });
    await toggleHall(owner.user.id, love.id, true);
    await toggleHall(owner.user.id, love.id, false);
    expect((await prisma.item.findUniqueOrThrow({ where: { id: love.id } })).state).toBe("LOVE");
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
      data: { occasionDate: utcMidnightDaysAgo(-30) },
    });
    expect(await occasionBannerVisible(owner.user.id)).toBe(false);

    expect(await occasionBannerVisible("no-such-user")).toBe(false);
  });
});
