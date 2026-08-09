// Тикет 11: связи, рождающиеся сами. Под замком ИНВАРИАНТ №4 (CLAUDE.md):
// друзья НЕ добавляются — ни поиска людей, ни импорта контактов, ни
// add/create-API; связь появляется только из подарка (receiveGift) или
// открытой ссылки (recordVisit). Плюс контракты:
// - одна строка Connection на пару (дедуп прямой и зеркальной ориентации);
// - визит не понижает kind, спам-заслон 1/час; своя комната — no-op;
// - подарок поверх VIEWED поднимает kind (правило тикета 10), понижения нет;
// - bookItem пишет booking.guestUserId залогиненного гостя, свою вещь
//   хозяйка не «бронирует» (OWN_ITEM);
// - listConnections — DTO без email, строка происхождения по каждому виду.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Очереди мокаются целиком (как в tests/occasions.test.ts): closeOccasion
// ставит письмо, Redis тестам не нужен.
vi.mock("@/server/queues", () => ({
  enqueueOccasionOwnerMail: vi.fn(async () => true),
  enqueueImageIngest: vi.fn(async () => true),
}));
// Сессия роутов: мок auth — роуты книги/визита живут с auth БЕЗ требования.
vi.mock("@/server/auth", () => ({ auth: vi.fn(async () => null) }));

import { auth } from "@/server/auth";
import { prisma } from "../src/server/db";
import * as connectionsService from "../src/server/services/connections";
import {
  connectionStatus,
  isConsentedConnection,
  listConnections,
  listPendingConsent,
  recordVisit,
  recordVisitBySlug,
  respondToAllPending,
  respondToConnection,
} from "../src/server/services/connections";
import {
  BookingError,
  bookItem,
  listBookingsByTokens,
  offerConnection,
} from "../src/server/services/bookings";
import { setHiddenFromHall } from "../src/server/services/items";
import { closeOccasion, receiveGift } from "../src/server/services/occasions";
import { POST as bookRoute } from "../src/app/api/v1/items/[id]/book/route";
import { POST as visitRoute } from "../src/app/api/v1/rooms/[slug]/visit/route";

const TEST_EMAIL_DOMAIN = "@connections.test";
const authMock = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;

const HOUR_MS = 60 * 60 * 1000;

async function createUser(displayName?: string) {
  return prisma.user.create({
    data: { email: `user-${randomUUID()}${TEST_EMAIL_DOMAIN}`, displayName },
  });
}

async function createOwnerWithRoom(displayName = "Хозяйка") {
  const user = await createUser(displayName);
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `cn-${randomUUID().slice(0, 12)}`,
    },
  });
  return { user, room };
}

async function createWantItem(roomId: string, title = `Вещь-${randomUUID().slice(0, 8)}`) {
  return prisma.item.create({
    data: { roomId, zone: "jewelry", state: "WANT", title, price: "5000", currency: "RUB" },
  });
}

/** Все строки Connection пары в ЛЮБОЙ ориентации. */
async function pairRows(userA: string, userB: string) {
  return prisma.connection.findMany({
    where: {
      OR: [
        { aUserId: userA, bUserId: userB },
        { aUserId: userB, bUserId: userA },
      ],
    },
  });
}

/**
 * Полный путь «гость подарил»: бронь с сессией → закрытие → «Дошло» → ОБА
 * согласились остаться на связи (тикет 98). Согласие входит в путь по
 * умолчанию: с тикета 98 связь без него не состоится, а тесты происхождения,
 * видов и карточек проверяют именно состоявшуюся связь.
 * `{ consent: false }` — оставить вопрос висеть (тесты самого согласия).
 */
async function giftFlow(
  owner: { user: { id: string }; room: { id: string } },
  giverId: string,
  options: { consent?: boolean; offer?: boolean } = {},
) {
  const item = await createWantItem(owner.room.id);
  await bookItem(
    // Гость отвечает на связь ЗДЕСЬ, на броне (тикет 98b, доска 32a):
    // после праздника он к нам может и не вернуться.
    { itemId: item.id, name: "Дарительница", offersConnection: options.offer !== false },
    { sessionUserId: giverId },
  );
  await closeOccasion(owner.room.id, { manual: true });
  await receiveGift(owner.user.id, item.id);
  // Хозяйка отвечает на «что подарили» — по умолчанию соглашается, чтобы
  // тесты происхождения и видов смотрели на состоявшуюся связь.
  if (options.consent !== false) await respondToAllPending(owner.user.id, true);
  return item;
}

const uniqueIp = () => `test-${randomUUID()}`;

function makeRequest(pathName: string, body?: unknown) {
  const headers = new Headers({ "x-forwarded-for": uniqueIp() });
  if (body !== undefined) headers.set("content-type", "application/json");
  return new NextRequest(`http://localhost${pathName}`, {
    method: "POST",
    headers,
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const itemCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const slugCtx = (slug: string) => ({ params: Promise.resolve({ slug }) });

// OccasionSummary не связан FK — чистим явно; users каскадом уносят
// комнаты/вещи/брони/связи (Connection: onDelete Cascade с обеих сторон).
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
beforeEach(() => {
  authMock.mockReset();
  authMock.mockResolvedValue(null);
});
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("recordVisit — связь «смотрели» из открытой ссылки", () => {
  it("первый визит: у хозяйки VIEWED (a=хозяйка, b=гость), origin visit, один в паре", async () => {
    const owner = await createOwnerWithRoom();
    const viewer = await createUser("Сергей");

    await recordVisit(viewer.id, owner.user.id);

    const rows = await pairRows(owner.user.id, viewer.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      aUserId: owner.user.id,
      bUserId: viewer.id,
      kind: "VIEWED",
      origin: "visit",
    });
    expect(rows[0]?.history).toMatchObject({ visitsByB: 1 });
  });

  it("дедуп пары + спам-заслон: повтор в течение часа — no-op, спустя час — инкремент", async () => {
    const owner = await createOwnerWithRoom();
    const viewer = await createUser();

    await recordVisit(viewer.id, owner.user.id);
    await recordVisit(viewer.id, owner.user.id); // F5 через секунду
    let rows = await pairRows(owner.user.id, viewer.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.history).toMatchObject({ visitsByB: 1 });

    // «Прошло два часа»: сдвигаем отметку последнего визита в прошлое.
    const history = rows[0]?.history as Record<string, unknown>;
    await prisma.connection.update({
      where: { id: rows[0]!.id },
      data: {
        history: { ...history, lastVisitByBAt: new Date(Date.now() - 2 * HOUR_MS).toISOString() },
      },
    });
    await recordVisit(viewer.id, owner.user.id);
    rows = await pairRows(owner.user.id, viewer.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.history).toMatchObject({ visitsByB: 2 });
  });

  it("зеркальная пара (b,a): второй строки не появляется, растёт направленный счётчик", async () => {
    const owner = await createOwnerWithRoom();
    const viewer = await createUser("Гость-с-историей");
    // Связь уже есть в ОБРАТНОЙ ориентации: когда-то наша хозяйка дарила гостю.
    await prisma.connection.create({
      data: {
        aUserId: viewer.id,
        bUserId: owner.user.id,
        kind: "FOLLOW",
        origin: "gift:cl-old-item",
        history: { giftsToA: 1 },
      },
    });

    await recordVisit(viewer.id, owner.user.id);

    const rows = await pairRows(owner.user.id, viewer.id);
    expect(rows).toHaveLength(1); // зеркальный дубль не родился
    expect(rows[0]).toMatchObject({ aUserId: viewer.id, kind: "FOLLOW", origin: "gift:cl-old-item" });
    // Визит гостя (сторона a зеркальной строки) в комнату хозяйки (сторона b).
    expect(rows[0]?.history).toMatchObject({ giftsToA: 1, visitsByA: 1 });
  });

  it("существующую FOLLOW/MUTUAL визит НЕ понижает — только history", async () => {
    const owner = await createOwnerWithRoom();
    const viewer = await createUser();
    await prisma.connection.create({
      data: { aUserId: owner.user.id, bUserId: viewer.id, kind: "MUTUAL", origin: "gift:cl-x" },
    });

    await recordVisit(viewer.id, owner.user.id);

    const rows = await pairRows(owner.user.id, viewer.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("MUTUAL"); // не VIEWED
    expect(rows[0]?.origin).toBe("gift:cl-x"); // происхождение не переписано
    expect(rows[0]?.history).toMatchObject({ visitsByB: 1 });
  });

  it("своя комната — no-op: связи с самим собой не существует", async () => {
    const owner = await createOwnerWithRoom();
    await recordVisit(owner.user.id, owner.user.id);
    expect(
      await prisma.connection.count({
        where: { OR: [{ aUserId: owner.user.id }, { bUserId: owner.user.id }] },
      }),
    ).toBe(0);
  });

  it("recordVisitBySlug: резолвит и ник, и короткий код; незнакомый слаг — false", async () => {
    const owner = await createOwnerWithRoom();
    await prisma.room.update({
      where: { id: owner.room.id },
      data: { nick: `nick${randomUUID().slice(0, 8).replaceAll("-", "")}` },
    });
    const room = await prisma.room.findUniqueOrThrow({ where: { id: owner.room.id } });
    const viewer = await createUser();

    expect(await recordVisitBySlug(viewer.id, room.shareSlug)).toBe(true);
    expect(await recordVisitBySlug(viewer.id, room.nick!)).toBe(true); // та же пара
    expect(await recordVisitBySlug(viewer.id, "no-such-slug")).toBe(false);

    const rows = await pairRows(owner.user.id, viewer.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.history).toMatchObject({ visitsByB: 1 }); // заслон: второй заход в тот же час
  });
});

describe("bookItem + sessionUserId — семя связи в тихой брони", () => {
  it("залогиненный гость: booking.guestUserId пишется; аноним — null (как раньше)", async () => {
    const owner = await createOwnerWithRoom();
    const guest = await createUser();
    const signed = await createWantItem(owner.room.id);
    const anonymous = await createWantItem(owner.room.id);

    await bookItem({ itemId: signed.id, name: "Мила" }, { sessionUserId: guest.id });
    await bookItem({ itemId: anonymous.id, name: "Инкогнито" });

    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { itemId: signed.id } })).guestUserId,
    ).toBe(guest.id);
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { itemId: anonymous.id } })).guestUserId,
    ).toBeNull();
  });

  it("своя вещь — отказ OWN_ITEM: подарок себе не бывает, брони нет", async () => {
    const owner = await createOwnerWithRoom();
    const item = await createWantItem(owner.room.id);

    await expect(
      bookItem({ itemId: item.id, name: "Хозяйка себе" }, { sessionUserId: owner.user.id }),
    ).rejects.toMatchObject({ code: "OWN_ITEM" });
    expect(await prisma.booking.count({ where: { itemId: item.id } })).toBe(0);

    // Чужому залогиненному гостю та же вещь бронируется как обычно.
    const guest = await createUser();
    await expect(
      bookItem({ itemId: item.id, name: "Гостья" }, { sessionUserId: guest.id }),
    ).resolves.toMatchObject({ cancelToken: expect.stringMatching(/^[0-9a-f]{48}$/) });
    expect(new BookingError("OWN_ITEM", "x")).toBeInstanceOf(Error);
  });

  it("роут POST /items/{id}/book: сессия → guestUserId, хозяйка → 403, без сессии → аноним", async () => {
    const owner = await createOwnerWithRoom();
    const guest = await createUser();
    const item = await createWantItem(owner.room.id);

    // Хозяйка со своей сессией: 403 OWN_ITEM.
    authMock.mockResolvedValue({ user: { id: owner.user.id } });
    const own = await bookRoute(makeRequest(`/api/v1/items/${item.id}/book`, { name: "Я" }), itemCtx(item.id));
    expect(own.status).toBe(403);

    // Гость с сессией: 201, guestUserId проставлен.
    authMock.mockResolvedValue({ user: { id: guest.id } });
    const booked = await bookRoute(
      makeRequest(`/api/v1/items/${item.id}/book`, { name: "Катя" }),
      itemCtx(item.id),
    );
    expect(booked.status).toBe(201);
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { itemId: item.id } })).guestUserId,
    ).toBe(guest.id);

    // Вне request-scope auth() кидает — роут честно считает гостя анонимом.
    const second = await createWantItem(owner.room.id);
    authMock.mockRejectedValue(new Error("headers() outside a request scope"));
    const anonymous = await bookRoute(
      makeRequest(`/api/v1/items/${second.id}/book`, { name: "Инкогнито" }),
      itemCtx(second.id),
    );
    expect(anonymous.status).toBe(201);
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { itemId: second.id } })).guestUserId,
    ).toBeNull();
  });
});

describe("POST /rooms/{slug}/visit — пинг визита, auth-опционально", () => {
  it("без сессии — 204 и no-op; с сессией — 204 и связь VIEWED; чужой слаг — 404", async () => {
    const owner = await createOwnerWithRoom();
    const viewer = await createUser();
    const slug = owner.room.shareSlug;

    const silent = await visitRoute(makeRequest(`/api/v1/rooms/${slug}/visit`), slugCtx(slug));
    expect(silent.status).toBe(204);
    expect(await pairRows(owner.user.id, viewer.id)).toHaveLength(0);

    authMock.mockResolvedValue({ user: { id: viewer.id } });
    const pinged = await visitRoute(makeRequest(`/api/v1/rooms/${slug}/visit`), slugCtx(slug));
    expect(pinged.status).toBe(204);
    const rows = await pairRows(owner.user.id, viewer.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("VIEWED");

    const missing = await visitRoute(
      makeRequest(`/api/v1/rooms/no-such-slug/visit`),
      slugCtx("no-such-slug"),
    );
    expect(missing.status).toBe(404);
  });
});

describe("подарок и kind — апгрейд без понижения", () => {
  it("VIEWED → MUTUAL подарком гостя со своей комнатой; origin строки не переписывается", async () => {
    const owner = await createOwnerWithRoom();
    const guest = await createOwnerWithRoom("Гостья со своей комнатой");
    await recordVisit(guest.user.id, owner.user.id); // родилась VIEWED

    const item = await giftFlow(owner, guest.user.id);

    const rows = await pairRows(owner.user.id, guest.user.id);
    expect(rows).toHaveLength(1); // подарок не размножил пару
    expect(rows[0]?.kind).toBe("MUTUAL");
    expect(rows[0]?.origin).toBe("visit"); // рождение связи — история, не последнее событие
    expect(rows[0]?.history).toMatchObject({
      visitsByB: 1,
      giftsToA: 1,
      lastGiftItemId: item.id,
      lastGiftTitle: item.title,
    });

    // Обратного понижения нет: свежий визит спустя час kind не трогает.
    const history = rows[0]?.history as Record<string, unknown>;
    await prisma.connection.update({
      where: { id: rows[0]!.id },
      data: {
        history: { ...history, lastVisitByBAt: new Date(Date.now() - 2 * HOUR_MS).toISOString() },
      },
    });
    await recordVisit(guest.user.id, owner.user.id);
    const after = await pairRows(owner.user.id, guest.user.id);
    expect(after[0]?.kind).toBe("MUTUAL");
    expect(after[0]?.history).toMatchObject({ visitsByB: 2, giftsToA: 1 });
  });

  it("VIEWED → FOLLOW, когда у дарителя нет комнаты", async () => {
    const owner = await createOwnerWithRoom();
    const guest = await createUser("Гость без комнаты");
    await recordVisit(guest.id, owner.user.id);

    await giftFlow(owner, guest.id);

    const rows = await pairRows(owner.user.id, guest.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("FOLLOW");
  });

  it("зеркальный дедуп подарка: существующая (b,a)-строка получает счётчик, дубль не родится", async () => {
    const owner = await createOwnerWithRoom();
    const guest = await createOwnerWithRoom("Постоянная пара");
    // Пара уже связана в ориентации (гость, хозяйка): гость получал 2 подарка.
    await prisma.connection.create({
      data: {
        aUserId: guest.user.id,
        bUserId: owner.user.id,
        kind: "MUTUAL",
        origin: "gift:cl-earlier",
        history: { giftsToA: 2 },
      },
    });

    await giftFlow(owner, guest.user.id);

    const rows = await pairRows(owner.user.id, guest.user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ aUserId: guest.user.id, kind: "MUTUAL", origin: "gift:cl-earlier" });
    // Хозяйка — сторона b зеркальной строки: её подарок лёг в giftsToB.
    expect(rows[0]?.history).toMatchObject({ giftsToA: 2, giftsToB: 1 });
  });
});

describe("listConnections — DTO без email, происхождение по каждому виду", () => {
  it("строки происхождения: подарок с названием, «дарил(а) N раз», визиты, legacy без history", async () => {
    const owner = await createOwnerWithRoom();

    // 1) Подарок c известной вещью (полный цикл — вещь в зале славы).
    const giver = await createOwnerWithRoom("Катя");
    const gifted = await giftFlow(owner, giver.user.id);

    // 2) Визиты.
    const watcher = await createUser("Сергей");
    await recordVisit(watcher.id, owner.user.id);

    // 3) Legacy-строка тикета 10: origin gift:{itemId}, history нет.
    const legacyGiver = await createUser("Мила");
    const legacyItem = await prisma.item.create({
      data: { roomId: owner.room.id, zone: "jewelry", state: "LOVE", title: "Колье", inHall: true },
    });
    await prisma.connection.create({
      data: {
        aUserId: owner.user.id,
        bUserId: legacyGiver.id,
        kind: "FOLLOW",
        origin: `gift:${legacyItem.id}`,
      },
    });

    const rows = await listConnections(owner.user.id);
    expect(rows).toHaveLength(3);

    const kate = rows.find((row) => row.displayName === "Катя");
    expect(kate).toMatchObject({
      kind: "MUTUAL",
      origin: { type: "gift", received: 1, given: 0, lastTitle: gifted.title, lastInHall: true },
    });

    const sergey = rows.find((row) => row.displayName === "Сергей");
    expect(sergey).toMatchObject({ kind: "VIEWED", origin: { type: "visit", visits: 1 } });

    const mila = rows.find((row) => row.displayName === "Мила");
    expect(mila).toMatchObject({
      kind: "FOLLOW",
      origin: { type: "gift", received: 1, given: 0, lastTitle: "Колье", lastInHall: true },
    });

    // Несколько подарков → счётчик, не название.
    const second = await giftFlow(owner, giver.user.id);
    const after = await listConnections(owner.user.id);
    const kateAfter = after.find((row) => row.displayName === "Катя");
    expect(kateAfter?.origin).toMatchObject({
      type: "gift",
      received: 2,
      lastTitle: second.title,
    });
  });

  it("комната друга отдаётся ТОЛЬКО тому, кто в ней был (тикет 95)", async () => {
    const owner = await createOwnerWithRoom();
    // Она заходила ко мне — но я у неё не был: адрес её комнаты мне не
    // положен, ссылка и есть ключ доступа (инвариант №7).
    const watcher = await createOwnerWithRoom("Смотрела");
    await recordVisit(watcher.user.id, owner.user.id);

    const oneWay = await listConnections(owner.user.id);
    expect(oneWay.find((r) => r.displayName === "Смотрела")?.room).toBeNull();

    // Теперь я захожу к ней — карточка появляется.
    await recordVisit(owner.user.id, watcher.user.id);
    await prisma.room.update({
      where: { id: watcher.room.id },
      data: { occasionDate: new Date("2026-09-01T00:00:00.000Z") },
    });

    const bothWays = await listConnections(owner.user.id);
    const hers = bothWays.find((r) => r.displayName === "Смотрела")?.room;
    expect(hers).not.toBeNull();
    expect(hers?.slug).toBe(watcher.room.shareSlug);
    expect(hers?.preset).toBe("cream");
    expect(hers?.occasionDate).toBe("2026-09-01");
    // Свободных подарков у неё нет — «всё разобрали», а не выдуманное число.
    expect(hers?.freeGifts).toBe(0);

    // И ни один ключ комнаты не уехал наружу помимо разрешённых.
    expect(Object.keys(hers ?? {}).sort()).toEqual([
      "freeGifts",
      "occasionDate",
      "preset",
      "slug",
    ]);
  });

  it("«N можно подарить» считает только то, что гость и так видит", async () => {
    const owner = await createOwnerWithRoom();
    const friend = await createOwnerWithRoom("Подруга");
    await recordVisit(owner.user.id, friend.user.id);

    await createWantItem(friend.room.id, "Свободная");
    const hidden = await createWantItem(friend.room.id, "Спрятанная");
    await prisma.item.update({ where: { id: hidden.id }, data: { hidden: true } });
    const booked = await createWantItem(friend.room.id, "Занятая");
    await bookItem({ itemId: booked.id, name: "Кто-то" });
    const offZone = await createWantItem(friend.room.id, "В выключенной зоне");
    await prisma.item.update({ where: { id: offZone.id }, data: { zone: "perfume" } });
    await prisma.room.update({ where: { id: friend.room.id }, data: { zonesOff: ["perfume"] } });

    const rows = await listConnections(owner.user.id);
    expect(rows.find((r) => r.displayName === "Подруга")?.room?.freeGifts).toBe(1);
  });

  it("глазок на витрине гасит «она в сокровищнице» у друга (тикет 89)", async () => {
    const owner = await createOwnerWithRoom();
    const giver = await createOwnerWithRoom("Катя");
    const gifted = await giftFlow(owner, giver.user.id);

    // Друг — наблюдатель: пока вещь на витрине открыто, строка про неё есть.
    const before = await listConnections(owner.user.id);
    expect(before.find((row) => row.displayName === "Катя")?.origin).toMatchObject({
      type: "gift",
      lastTitle: gifted.title,
      lastInHall: true,
    });

    await setHiddenFromHall(owner.user.id, gifted.id, true);

    // Название подарка остаётся (оно из истории связи), а «в сокровищнице» —
    // молчит: наблюдатель вещи больше не видит.
    const after = await listConnections(owner.user.id);
    expect(after.find((row) => row.displayName === "Катя")?.origin).toMatchObject({
      type: "gift",
      lastTitle: gifted.title,
      lastInHall: false,
    });
  });

  it("email собеседника не существует нигде в DTO (ключи — allowlist)", async () => {
    const owner = await createOwnerWithRoom();
    const guest = await createOwnerWithRoom("Дарительница");
    await giftFlow(owner, guest.user.id);
    const watcher = await createUser(); // displayName нет — null, не email
    await recordVisit(watcher.id, owner.user.id);

    const rows = await listConnections(owner.user.id);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        "avatarUrl",
        // Состоялась связь или осталась односторонней (хвост 98b, доска 32a).
        "consent",
        "createdAt",
        "displayName",
        "id",
        "kind",
        "lastAt",
        "origin",
        // Комната друга (тикет 95) — ключ есть всегда, значение только у тех,
        // в чьей комнате человек был; здесь ни разу, поэтому null.
        "room",
      ]);
      expect(row.room).toBeNull();
    }
    const serialized = JSON.stringify(rows);
    expect(serialized).not.toMatch(/@|email|connections\.test/i);
    // И id собеседников не отдаются (только id самой связи).
    expect(serialized).not.toContain(guest.user.id);
    expect(serialized).not.toContain(watcher.id);
  });

  it("одна строка пары видна обеим сторонам с перевёрнутой перспективой; фильтр по kind", async () => {
    const owner = await createOwnerWithRoom("Аня");
    const guest = await createOwnerWithRoom("Мила");
    await giftFlow(owner, guest.user.id); // Мила подарила Ане

    const forOwner = await listConnections(owner.user.id);
    expect(forOwner).toHaveLength(1);
    expect(forOwner[0]).toMatchObject({
      displayName: "Мила",
      origin: { type: "gift", received: 1, given: 0 },
    });

    const forGuest = await listConnections(guest.user.id);
    expect(forGuest).toHaveLength(1);
    expect(forGuest[0]).toMatchObject({
      displayName: "Аня",
      origin: { type: "gift", received: 0, given: 1 }, // «ты дарил(а)», не «тебе»
    });

    // Фильтр по kind — на самом сервисе.
    const viewer = await createUser();
    await recordVisit(viewer.id, owner.user.id);
    expect(await listConnections(owner.user.id, { kind: "VIEWED" })).toHaveLength(1);
    expect(await listConnections(owner.user.id, { kind: "MUTUAL" })).toHaveLength(1);
    expect(await listConnections(owner.user.id, { kind: "FOLLOW" })).toHaveLength(0);
  });
});

describe("тикет 98b — согласие по 32a: гость на броне, хозяйка после праздника", () => {
  it("гость предложил — связь ждёт хозяйку; она согласилась — состоялась", async () => {
    const owner = await createOwnerWithRoom();
    const giver = await createOwnerWithRoom("Катя");
    await giftFlow(owner, giver.user.id, { consent: false });

    const [row] = await pairRows(owner.user.id, giver.user.id);
    // Сторона b — даритель: его «да» уже стоит, он отвечал на броне.
    expect(row?.consentB).toBe(true);
    expect(row?.consentA).toBeNull();
    expect(connectionStatus(row!)).toBe("pending");

    // Ни у кого в друзьях; вопрос висит у ОБОИХ, но отвечает только хозяйка —
    // у дарителя строка помечена «уже ответил» и кнопок не получает.
    expect(await listConnections(owner.user.id)).toHaveLength(0);
    expect(await listPendingConsent(owner.user.id)).toMatchObject([
      { displayName: "Катя", answered: false },
    ]);
    expect(await listPendingConsent(giver.user.id)).toMatchObject([{ answered: true }]);

    await respondToConnection(owner.user.id, row!.id, true);
    expect(await listConnections(owner.user.id)).toHaveLength(1);
    expect(await listConnections(giver.user.id)).toHaveLength(1);
    expect(await listPendingConsent(owner.user.id)).toEqual([]);
  });

  it("гость НЕ предлагал — хозяйку не спрашивают вовсе, дружбы не будет", async () => {
    // Молчаливой дружбы больше нет (32a), но и вопроса без предложения тоже:
    // подарил тихо — значит тихо.
    const owner = await createOwnerWithRoom();
    const giver = await createOwnerWithRoom("Катя");
    await giftFlow(owner, giver.user.id, { offer: false, consent: false });

    const [row] = await pairRows(owner.user.id, giver.user.id);
    expect(row?.consentB).toBe(false);
    expect(connectionStatus(row!)).toBe("declined");
    expect(isConsentedConnection(row!)).toBe(false);
    expect(await listPendingConsent(owner.user.id)).toEqual([]);
    // …но из списка строка НЕ уходит (хвост 98b, доска 32a): она остаётся
    // односторонней — «знакомы · подарок в истории».
    expect(await listConnections(owner.user.id)).toMatchObject([
      { displayName: "Катя", consent: "declined" },
    ]);

    // История подарка при этом цела — строка живёт, просто не дружба.
    expect(row?.history).toMatchObject({ giftsToA: 1 });
  });

  it("хозяйка сказала «Пока нет» — молча, и дарителю об этом не говорят", async () => {
    const owner = await createOwnerWithRoom();
    const giver = await createOwnerWithRoom("Катя");
    await giftFlow(owner, giver.user.id, { consent: false });
    const [row] = await pairRows(owner.user.id, giver.user.id);

    await respondToConnection(owner.user.id, row!.id, false);
    const after = (await pairRows(owner.user.id, giver.user.id))[0];
    expect(connectionStatus(after!)).toBe("declined");
    // Вопрос снят у обоих: строки «тебе отказали» не существует.
    expect(await listPendingConsent(giver.user.id)).toEqual([]);
    expect(await listPendingConsent(owner.user.id)).toEqual([]);
    // У дарителя остаётся односторонняя строка — и она молчит о том, что
    // отказ БЫЛ: подпись у неё та же, что у молчаливого подарка.
    expect(await listConnections(giver.user.id)).toMatchObject([{ consent: "declined" }]);
  });

  it("«Оставить взаимно» отвечает разом — и только за себя", async () => {
    const owner = await createOwnerWithRoom();
    const first = await createOwnerWithRoom("Катя");
    const second = await createUser("Мила");
    await giftFlow(owner, first.user.id, { consent: false });
    await giftFlow(owner, second.id, { consent: false });

    expect(await respondToAllPending(owner.user.id, true)).toBe(2);
    expect(await listConnections(owner.user.id)).toHaveLength(2);
    expect(await respondToAllPending(owner.user.id, true)).toBe(0);
  });

  it("второй подарок той же паре вопроса не поднимает", async () => {
    const owner = await createOwnerWithRoom();
    const giver = await createOwnerWithRoom("Катя");
    await giftFlow(owner, giver.user.id);
    const asked = (await pairRows(owner.user.id, giver.user.id))[0]?.consentAskedAt;

    await giftFlow(owner, giver.user.id, { consent: false });
    const after = (await pairRows(owner.user.id, giver.user.id))[0];
    expect(after?.consentAskedAt).toEqual(asked);
    expect(connectionStatus(after!)).toBe("active");
    expect(await listPendingConsent(owner.user.id)).toEqual([]);
  });

  it("связь из визита вопроса не получает, связи до тикета 98 — состоявшиеся", async () => {
    const owner = await createOwnerWithRoom();
    const watcher = await createUser("Сергей");
    await recordVisit(watcher.id, owner.user.id);

    const [visitRow] = await pairRows(owner.user.id, watcher.id);
    expect(visitRow?.consentAskedAt).toBeNull();
    expect(connectionStatus(visitRow!)).toBe("active");
    expect(await listPendingConsent(owner.user.id)).toEqual([]);
    // …но заглянувший другом не становится: «кто такой друг» — это
    // isConsentedConnection, и VIEWED в него не входит (ADR-0004).
    expect(isConsentedConnection(visitRow!)).toBe(false);

    const legacyGiver = await createUser("Мила");
    await prisma.connection.create({
      data: {
        aUserId: owner.user.id,
        bUserId: legacyGiver.id,
        kind: "FOLLOW",
        origin: "gift:legacy",
        history: { giftsToA: 1 },
      },
    });
    const legacy = (await pairRows(owner.user.id, legacyGiver.id))[0];
    expect(isConsentedConnection(legacy!)).toBe(true);
  });

  it("ответить можно только за свою связь: чужая и несуществующая — один ответ", async () => {
    const owner = await createOwnerWithRoom();
    const giver = await createOwnerWithRoom("Катя");
    await giftFlow(owner, giver.user.id, { consent: false });
    const [row] = await pairRows(owner.user.id, giver.user.id);

    const stranger = await createUser("Чужой");
    expect(await respondToConnection(stranger.id, row!.id, true)).toBe(false);
    expect(await respondToConnection(owner.user.id, "no-such-connection", true)).toBe(false);

    const untouched = (await pairRows(owner.user.id, giver.user.id))[0];
    expect(untouched?.consentA).toBeNull();
    expect(
      await prisma.connection.count({
        where: { OR: [{ aUserId: stranger.id }, { bUserId: stranger.id }] },
      }),
    ).toBe(0);
  });
});

// Хвост тикета 98b — две вещи, которых у согласия не хватало по доске 32a:
// гостю негде было ПЕРЕДУМАТЬ до праздника, а отказ уносил связь из списков
// совсем, хотя должен оставлять видимую одностороннюю строку.
describe("хвост 98b — передумать до праздника и односторонняя строка после отказа", () => {
  /** Бронь ЗАЛОГИНЕННОГО гостя: только у неё есть чем передумать. */
  async function bookAsGuest(
    owner: { room: { id: string } },
    guestId: string,
    offersConnection: boolean,
  ) {
    const item = await createWantItem(owner.room.id);
    const { cancelToken } = await bookItem(
      { itemId: item.id, name: "Катя", offersConnection },
      { sessionUserId: guestId },
    );
    return { item, cancelToken };
  }

  /** Строка «Показаться после праздника» из «Моих подарков». */
  async function connectionRow(cancelToken: string) {
    return (await listBookingsByTokens([cancelToken]))[0]?.connection;
  }

  it("до праздника ответ виден строкой и меняется — в обе стороны", async () => {
    const owner = await createOwnerWithRoom();
    const guest = await createUser("Катя");
    const { cancelToken } = await bookAsGuest(owner, guest.id, false);

    expect(await connectionRow(cancelToken)).toEqual({ offers: false, editable: true });

    await offerConnection(cancelToken, true);
    expect(await connectionRow(cancelToken)).toEqual({ offers: true, editable: true });

    // И обратно: пока праздник не наступил, «показаться» — не навсегда.
    await offerConnection(cancelToken, false);
    expect(await connectionRow(cancelToken)).toEqual({ offers: false, editable: true });
  });

  it("ответ живёт на ПАРЕ: вторая бронь той же хозяйке меняется вместе с первой", async () => {
    const owner = await createOwnerWithRoom();
    const guest = await createUser("Катя");
    const first = await bookAsGuest(owner, guest.id, false);
    const second = await bookAsGuest(owner, guest.id, false);

    await offerConnection(first.cancelToken, true);

    expect(await connectionRow(first.cancelToken)).toEqual({ offers: true, editable: true });
    expect(await connectionRow(second.cancelToken)).toEqual({ offers: true, editable: true });
  });

  it("у брони без аккаунта строки нет вовсе — связывать некого", async () => {
    const owner = await createOwnerWithRoom();
    const item = await createWantItem(owner.room.id);
    const { cancelToken } = await bookItem({
      itemId: item.id,
      name: "Инкогнито",
      offersConnection: true,
    });

    expect(await connectionRow(cancelToken)).toBeNull();
    // Анониму ответ и не сохраняется — молча, без отказа.
    expect(
      (await prisma.booking.findUniqueOrThrow({ where: { itemId: item.id } })).offersConnection,
    ).toBe(false);
    await expect(offerConnection(cancelToken, true)).resolves.toBeUndefined();
  });

  it("после праздника строка остаётся, но передумать не даёт", async () => {
    const owner = await createOwnerWithRoom();
    const guest = await createUser("Катя");
    const { cancelToken } = await bookAsGuest(owner, guest.id, true);

    await closeOccasion(owner.room.id, { manual: true });

    expect(await connectionRow(cancelToken)).toEqual({ offers: true, editable: false });
    await expect(offerConnection(cancelToken, false)).rejects.toMatchObject({
      code: "OCCASION_PASSED",
    });
    // Ответ не тронут: хозяйка увидит на «что подарили» ровно то, что было.
    expect(await connectionRow(cancelToken)).toEqual({ offers: true, editable: false });
  });

  it("запирает не календарь, а закрытие итога; новая дата впереди — снова открывает", async () => {
    const owner = await createOwnerWithRoom();
    const guest = await createUser("Катя");
    const { cancelToken } = await bookAsGuest(owner, guest.id, true);

    // Дата прошла, а итог ещё не закрыт: ответа не видел никто (без summary
    // «что подарили» молчит, и «Дошло» не отмечается) — менять можно.
    await prisma.room.update({
      where: { id: owner.room.id },
      data: { occasionDate: new Date(Date.now() - 24 * HOUR_MS) },
    });
    expect((await connectionRow(cancelToken))?.editable).toBe(true);

    // Итог закрыт — с этой секунды ответ отыгран.
    await closeOccasion(owner.room.id);
    expect((await connectionRow(cancelToken))?.editable).toBe(false);

    // Между праздниками: следующая дата впереди — брони копятся к ней, и
    // ответ снова живой (то же правило, что у баннера комнаты).
    await prisma.room.update({
      where: { id: owner.room.id },
      data: { occasionDate: new Date(Date.now() + 30 * 24 * HOUR_MS) },
    });
    expect((await connectionRow(cancelToken))?.editable).toBe(true);
    await offerConnection(cancelToken, false);
    expect(await connectionRow(cancelToken)).toEqual({ offers: false, editable: true });
  });

  it("отказ оставляет одностороннюю строку: видна обоим, взаимной связь не делает", async () => {
    const owner = await createOwnerWithRoom("Аня");
    const giver = await createOwnerWithRoom("Катя");
    // Друг у друга уже бывали: у СОСТОЯВШЕЙСЯ связи это дало бы карточку с
    // кадром комнаты (тикет 95) — у односторонней её быть не должно.
    await recordVisit(owner.user.id, giver.user.id);
    await recordVisit(giver.user.id, owner.user.id);
    await giftFlow(owner, giver.user.id, { consent: false });

    const [row] = await pairRows(owner.user.id, giver.user.id);
    expect(await respondToConnection(owner.user.id, row!.id, false)).toBe(true);

    // Факт подарка цел — он и есть содержание строки «знакомы · подарок в
    // истории», и перспектива у сторон по-прежнему разная.
    expect(await listConnections(owner.user.id)).toMatchObject([
      { displayName: "Катя", consent: "declined", room: null, origin: { received: 1, given: 0 } },
    ]);
    expect(await listConnections(giver.user.id)).toMatchObject([
      { displayName: "Аня", consent: "declined", room: null, origin: { received: 0, given: 1 } },
    ]);

    // Дружбой связь при этом не стала и взаимной не становилась.
    const after = (await pairRows(owner.user.id, giver.user.id))[0]!;
    expect(isConsentedConnection(after)).toBe(false);
    expect(after.mutualAt).toBeNull();
  });

  it("неспрошенные (null) и отказавшиеся (false) — разные случаи, и оба переживают фильтр", async () => {
    const owner = await createOwnerWithRoom();
    // 1) Вопроса не было вовсе: связь из визита (consentAskedAt = null).
    const watcher = await createUser("Сергей");
    await recordVisit(watcher.id, owner.user.id);
    // 2) Отказ: подарил тихо, связь не предлагал (consentB = false).
    const quiet = await createUser("Мила");
    await giftFlow(owner, quiet.id, { offer: false, consent: false });
    // 3) Ждёт ответа: предложил, хозяйка ещё молчит (consentA = null).
    const waiting = await createUser("Катя");
    await giftFlow(owner, waiting.id, { consent: false });

    const rows = await listConnections(owner.user.id);
    // Главное здесь — что НЕСПРОШЕННАЯ строка жива: отрицание
    // (`NOT { consentA: false }`) выбросило бы её вместе с отказом, потому что
    // в SQL NULL = false даёт UNKNOWN. Фильтр написан перечислением.
    expect(rows.map((r) => r.displayName).sort()).toEqual(["Мила", "Сергей"]);
    expect(rows.find((r) => r.displayName === "Сергей")?.consent).toBe("active");
    expect(rows.find((r) => r.displayName === "Мила")?.consent).toBe("declined");
    // Ждущая ответа в список связей не попадает — у неё своё место.
    expect(await listPendingConsent(owner.user.id)).toMatchObject([{ displayName: "Катя" }]);
  });
});

describe("ИНВАРИАНТ №4 — друзья не добавляются (негативный)", () => {
  it("поверхность сервиса связей — ровно рождение из подарка/ссылки, чтение и ответ", () => {
    // Строгий allowlist: НИКАКИХ add/create/search/import по произвольному
    // вводу. Тикет 98 добавил три имени, и все три — про УЖЕ существующую
    // строку: прочитать вопрос и ответить на него за себя. Тикет 114 добавил
    // четвёртое, и оно тоже читающее: лента «Что происходит» спрашивает,
    // ЧЬИ события человеку можно показать, и списка людей не создаёт.
    expect(Object.keys(connectionsService).sort()).toEqual([
      "connectionStatus",
      "isConsentedConnection",
      "listConnections",
      "listConnectionsForFeed",
      "listPendingConsent",
      "recordVisit",
      "recordVisitBySlug",
      "respondToAllPending",
      "respondToConnection",
      "upsertGiftConnection",
    ]);
    expect(
      Object.keys(connectionsService).filter((name) =>
        /search|import|invite|suggest|friend|contact|people|add/i.test(name),
      ),
    ).toEqual([]);
  });

  it("в приложении нет роутов поиска людей/импорта контактов, у /connections нет мутаций", () => {
    const appDir = path.join(process.cwd(), "src", "app");
    const entries = readdirSync(appDir, { recursive: true }).map(String);

    // Ни одного маршрута/файла про поиск людей, друзей, контакты, импорт.
    expect(
      entries.filter((entry) => /friend|contact|people|search|import|invite/i.test(entry)),
    ).toEqual([]);

    // У страницы связей нет ни одного HTTP-роута: снаружи по ней ходить
    // нечем — ни поиска, ни добавления по запросу.
    const connectionsEntries = entries.filter((entry) =>
      entry.replaceAll("\\", "/").startsWith("connections/"),
    );
    expect(connectionsEntries.length).toBeGreaterThan(0);
    expect(connectionsEntries.filter((entry) => /route\.tsx?$/.test(entry))).toEqual([]);
  });

  it("экшены страницы связей — ровно два ответа, ни одного создающего глагола", async () => {
    // Тикет 98 завёл на /connections первую мутацию. Граница инварианта №4
    // сместилась, но не размылась: отвечать про существующую связь можно,
    // создавать — нечем. Сторожим и имена экшенов, и текст файла.
    const actions = await import("../src/app/connections/actions");
    expect(Object.keys(actions).sort()).toEqual([
      "respondToAllPendingAction",
      "respondToConnectionAction",
    ]);

    const source = readFileSync(
      path.join(process.cwd(), "src", "app", "connections", "actions.ts"),
      "utf8",
    );
    // Ни одного писателя, кроме двух ответов сервиса: create/upsert/connect
    // в этом файле не должно появиться никогда.
    expect(source).not.toMatch(/\.(create|createMany|upsert)\(/);
    expect(source).not.toMatch(/upsertGiftConnection|recordVisit/);
  });
});
