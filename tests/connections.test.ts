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
import { BookingError, bookItem } from "../src/server/services/bookings";
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
  options: { consent?: boolean } = {},
) {
  const item = await createWantItem(owner.room.id);
  await bookItem({ itemId: item.id, name: "Дарительница" }, { sessionUserId: giverId });
  await closeOccasion(owner.room.id, { manual: true });
  await receiveGift(owner.user.id, item.id);
  if (options.consent !== false) {
    await respondToAllPending(owner.user.id, true);
    await respondToAllPending(giverId, true);
  }
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

describe("тикет 98 — согласие обеих сторон на связь (доска Б12)", () => {
  it("связь из подарка рождается ждущей: её нет в списках, пока не ответили ОБА", async () => {
    const owner = await createOwnerWithRoom();
    const giver = await createOwnerWithRoom("Катя");
    await giftFlow(owner, giver.user.id, { consent: false });

    // Строка существует, но состоявшейся связью не считается.
    const [row] = await pairRows(owner.user.id, giver.user.id);
    expect(row?.consentAskedAt).not.toBeNull();
    expect(connectionStatus(row!)).toBe("pending");
    expect(isConsentedConnection(row!)).toBe(false);

    // Ни у кого в друзьях — зато у обоих висит вопрос.
    expect(await listConnections(owner.user.id)).toHaveLength(0);
    expect(await listConnections(giver.user.id)).toHaveLength(0);
    expect(await listPendingConsent(owner.user.id)).toMatchObject([
      { displayName: "Катя", answered: false },
    ]);
    expect(await listPendingConsent(giver.user.id)).toMatchObject([
      { displayName: "Хозяйка", answered: false },
    ]);

    // Ответила одна сторона — связи всё ещё нет, вопрос ждёт вторую.
    await respondToConnection(owner.user.id, row!.id, true);
    expect(await listConnections(owner.user.id)).toHaveLength(0);
    expect(await listPendingConsent(owner.user.id)).toMatchObject([{ answered: true }]);

    // Ответила вторая — связь состоялась у обоих, вопрос исчез.
    await respondToConnection(giver.user.id, row!.id, true);
    expect(await listConnections(owner.user.id)).toHaveLength(1);
    expect(await listConnections(giver.user.id)).toHaveLength(1);
    expect(await listPendingConsent(owner.user.id)).toEqual([]);
    expect(await listPendingConsent(giver.user.id)).toEqual([]);
  });

  it("отказ уводит связь у ОБОИХ и молча: второй стороне об отказе не говорят", async () => {
    const owner = await createOwnerWithRoom();
    const giver = await createOwnerWithRoom("Катя");
    await giftFlow(owner, giver.user.id, { consent: false });
    const [row] = await pairRows(owner.user.id, giver.user.id);

    // Даритель сказал «не в этот раз» — хозяйка своё «да» ещё не сказала.
    await respondToConnection(giver.user.id, row!.id, false);

    expect(connectionStatus((await pairRows(owner.user.id, giver.user.id))[0]!)).toBe("declined");
    expect(await listConnections(owner.user.id)).toHaveLength(0);
    expect(await listConnections(giver.user.id)).toHaveLength(0);
    // Вопрос снят у обоих: никакой строки «он отказался» не существует.
    expect(await listPendingConsent(owner.user.id)).toEqual([]);
    expect(await listPendingConsent(giver.user.id)).toEqual([]);

    // «Со всеми» уже ничего не воскрешает: согласие нужно обоюдное.
    expect(await respondToAllPending(owner.user.id, true)).toBe(0);
    expect(await listConnections(owner.user.id)).toHaveLength(0);

    // История подарка при этом цела — строка живёт, просто не дружба.
    const kept = (await pairRows(owner.user.id, giver.user.id))[0];
    expect(kept?.history).toMatchObject({ giftsToA: 1 });
  });

  it("«Со всеми N» отвечает разом и только за себя", async () => {
    const owner = await createOwnerWithRoom();
    const first = await createOwnerWithRoom("Катя");
    const second = await createUser("Мила");
    await giftFlow(owner, first.user.id, { consent: false });
    await giftFlow(owner, second.id, { consent: false });

    expect(await respondToAllPending(owner.user.id, true)).toBe(2);
    // Хозяйка ответила за себя — дарители ещё нет, связей нет.
    expect(await listConnections(owner.user.id)).toHaveLength(0);
    expect(await listPendingConsent(owner.user.id)).toMatchObject([
      { answered: true },
      { answered: true },
    ]);

    await respondToAllPending(first.user.id, true);
    await respondToAllPending(second.id, true);
    expect(await listConnections(owner.user.id)).toHaveLength(2);
    // Повторный «со всеми» отвечать больше нечему.
    expect(await respondToAllPending(owner.user.id, true)).toBe(0);
  });

  it("вопрос не задаётся заново состоявшейся дружбе, а после отказа — задаётся", async () => {
    const owner = await createOwnerWithRoom();
    const giver = await createOwnerWithRoom("Катя");

    // Первый подарок: спросили, оба согласились.
    await giftFlow(owner, giver.user.id);
    const askedFirst = (await pairRows(owner.user.id, giver.user.id))[0]?.consentAskedAt;

    // Второй подарок той же паре — второго вопроса нет.
    await giftFlow(owner, giver.user.id, { consent: false });
    const afterSecond = (await pairRows(owner.user.id, giver.user.id))[0];
    expect(afterSecond?.consentAskedAt).toEqual(askedFirst);
    expect(connectionStatus(afterSecond!)).toBe("active");
    expect(await listPendingConsent(owner.user.id)).toEqual([]);

    // А вот отказ прошлое «нет» не увековечивает: новый подарок спрашивает снова.
    await respondToConnection(owner.user.id, afterSecond!.id, false);
    await giftFlow(owner, giver.user.id, { consent: false });
    const afterDecline = (await pairRows(owner.user.id, giver.user.id))[0];
    expect(connectionStatus(afterDecline!)).toBe("pending");
    expect(afterDecline?.consentA).toBeNull();
    expect(afterDecline?.consentB).toBeNull();
  });

  it("связь из визита вопроса не получает, а связи до тикета 98 — состоявшиеся", async () => {
    const owner = await createOwnerWithRoom();
    const watcher = await createUser("Сергей");
    await recordVisit(watcher.id, owner.user.id);

    const [visitRow] = await pairRows(owner.user.id, watcher.id);
    expect(visitRow?.consentAskedAt).toBeNull();
    expect(connectionStatus(visitRow!)).toBe("active");
    expect(await listPendingConsent(owner.user.id)).toEqual([]);
    expect(await listConnections(owner.user.id)).toHaveLength(1);

    // …но заглянувший в комнату другом не становится: «кто такой друг» —
    // это isConsentedConnection, и VIEWED в него не входит (ADR-0004).
    expect(isConsentedConnection(visitRow!)).toBe(false);

    // Строка, заведённая до тикета 98 (consentAskedAt пуст) — состоявшаяся:
    // задним числом мы никого не переспрашиваем.
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
    expect(await listConnections(owner.user.id)).toHaveLength(2);

    // И подарок такой паре вопроса не поднимает — дружба уже есть.
    await giftFlow(owner, legacyGiver.id, { consent: false });
    expect(await listPendingConsent(owner.user.id)).toEqual([]);
  });

  it("ответить можно только за свою связь: чужая и несуществующая — один ответ", async () => {
    const owner = await createOwnerWithRoom();
    const giver = await createOwnerWithRoom("Катя");
    await giftFlow(owner, giver.user.id, { consent: false });
    const [row] = await pairRows(owner.user.id, giver.user.id);

    const stranger = await createUser("Чужой");
    expect(await respondToConnection(stranger.id, row!.id, true)).toBe(false);
    expect(await respondToConnection(owner.user.id, "no-such-connection", true)).toBe(false);

    // Чужой ответ ничего не записал: обе стороны по-прежнему молчат.
    const untouched = (await pairRows(owner.user.id, giver.user.id))[0];
    expect(untouched?.consentA).toBeNull();
    expect(untouched?.consentB).toBeNull();

    // И связей у постороннего не завелось — ответ ничего не создаёт.
    expect(await listConnections(stranger.id)).toHaveLength(0);
    expect(await prisma.connection.count({ where: { OR: [{ aUserId: stranger.id }, { bUserId: stranger.id }] } })).toBe(0);
  });
});

describe("ИНВАРИАНТ №4 — друзья не добавляются (негативный)", () => {
  it("поверхность сервиса связей — ровно рождение из подарка/ссылки, чтение и ответ", () => {
    // Строгий allowlist: НИКАКИХ add/create/search/import по произвольному
    // вводу. Тикет 98 добавил три имени, и все три — про УЖЕ существующую
    // строку: прочитать вопрос и ответить на него за себя.
    expect(Object.keys(connectionsService).sort()).toEqual([
      "connectionStatus",
      "isConsentedConnection",
      "listConnections",
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
