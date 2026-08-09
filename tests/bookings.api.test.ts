// Тесты API тихой брони (тикет 08) через route-handlers с реальной БД:
// контракт для клиента комнаты и e2e (тикет 15) — статусы, cookie
// `guest_bookings`, канал «занято» без имён и без кэша.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/server/db";
import { DELETE as cancelRoute, POST as bookRoute } from "../src/app/api/v1/items/[id]/book/route";
import { POST as purchasedRoute } from "../src/app/api/v1/items/[id]/book/purchased/route";
import { GET as takenRoute } from "../src/app/api/v1/rooms/[slug]/taken/route";
import { GUEST_BOOKINGS_COOKIE } from "../src/server/services/bookings";

// Прогрев (тикет 30). Роут грузит два тяжёлых модуля ЛЕНИВО, уже внутри
// запроса: `@/server/auth` (optionalSessionUserId) и `ioredis` (rate limit).
// Оба поэтому впервые компилировались внутри первого же `it`, и он платил за
// это 3.0–3.7 с в покое и до 14 с под полным прогоном — при дефолтных 5000 мс
// vitest. Дорог именно next-auth: тикет 19 завёл его через `server.deps.inline`,
// так что Vite трансформирует весь его граф в рантайме. Этот файл —
// единственный, кто грузит настоящий next-auth: остальные роут-тесты его
// мокают (`vi.mock("@/server/auth")`), поэтому и флейк был только здесь.
// Импорт на уровне модуля переносит ту же работу в фазу загрузки файла,
// которую vitest таймаутом теста не ограничивает. Поведение не меняется:
// роут по-прежнему делает свой настоящий `await import(...)`, зовёт настоящий
// `auth()` и честно ловит его отказ вне request-scope — просто по тёплому кэшу.
import "@/server/auth";
import "ioredis";

const TEST_EMAIL_DOMAIN = "@bookings-api.test";

async function createTestRoom() {
  const user = await prisma.user.create({
    data: { email: `user-${randomUUID()}${TEST_EMAIL_DOMAIN}` },
  });
  return prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `a-${randomUUID().slice(0, 12)}`,
    },
  });
}

async function createWantItem(roomId: string) {
  const data: Prisma.ItemUncheckedCreateInput = {
    roomId,
    zone: "jewelry",
    inHall: false,
    title: "Колье с жемчугом",
    price: "48000",
    currency: "RUB",
  };
  return prisma.item.create({ data });
}

/** Уникальный IP на тест: буксует только своя корзина rate limit'а. */
const uniqueIp = () => `test-${randomUUID()}`;

type RequestOptions = {
  method?: string;
  body?: unknown;
  ip?: string;
  cookieTokens?: string[];
};

function makeRequest(path: string, options: RequestOptions = {}) {
  const headers = new Headers({ "x-forwarded-for": options.ip ?? uniqueIp() });
  if (options.body !== undefined) headers.set("content-type", "application/json");
  if (options.cookieTokens) {
    headers.set(
      "cookie",
      `${GUEST_BOOKINGS_COOKIE}=${encodeURIComponent(JSON.stringify(options.cookieTokens))}`,
    );
  }
  return new NextRequest(`http://localhost${path}`, {
    method: options.method ?? "POST",
    headers,
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

const itemCtx = (id: string) => ({ params: Promise.resolve({ id }) });
const slugCtx = (slug: string) => ({ params: Promise.resolve({ slug }) });

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("POST /api/v1/items/{id}/book", () => {
  it("201: cancelToken в теле и в HTTP-only cookie на год", async () => {
    const room = await createTestRoom();
    const item = await createWantItem(room.id);

    const response = await bookRoute(
      makeRequest(`/api/v1/items/${item.id}/book`, {
        body: { name: "Гость", email: "guest@mail.test", mode: "SIGNED" },
      }),
      itemCtx(item.id),
    );

    expect(response.status).toBe(201);
    const payload = (await response.json()) as { data: { cancelToken: string } };
    expect(payload.data.cancelToken).toMatch(/^[0-9a-f]{48}$/);

    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${GUEST_BOOKINGS_COOKIE}=`);
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain(`Max-Age=${365 * 24 * 60 * 60}`);
    expect(decodeURIComponent(setCookie)).toContain(payload.data.cancelToken);
    // Имя/почта гостя в ответе не живут (инвариант №1 — и гостю они не нужны).
    expect(JSON.stringify(payload)).not.toMatch(/guestName|guestEmail|Гость|mail\.test/);
  });

  it("вторая бронь → 409 ALREADY_BOOKED; складчина → 400; демо-призрак → 400", async () => {
    const room = await createTestRoom();
    const item = await createWantItem(room.id);

    await bookRoute(
      makeRequest(`/api/v1/items/${item.id}/book`, { body: { name: "Первый" } }),
      itemCtx(item.id),
    );
    const conflict = await bookRoute(
      makeRequest(`/api/v1/items/${item.id}/book`, { body: { name: "Второй" } }),
      itemCtx(item.id),
    );
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as { error: { code: string } }).error.code).toBe(
      "ALREADY_BOOKED",
    );

    const free = await createWantItem(room.id);
    const pool = await bookRoute(
      makeRequest(`/api/v1/items/${free.id}/book`, { body: { name: "Гость", mode: "POOL" } }),
      itemCtx(free.id),
    );
    expect(pool.status).toBe(400);
    expect(((await pool.json()) as { error: { code: string } }).error.code).toBe(
      "POOL_NOT_SUPPORTED",
    );

    const demo = await bookRoute(
      makeRequest(`/api/v1/items/demo:jewelry:0/book`, { body: { name: "Гость" } }),
      itemCtx("demo:jewelry:0"),
    );
    expect(demo.status).toBe(400);
    expect(((await demo.json()) as { error: { code: string } }).error.code).toBe("DEMO_ITEM");
  });

  it("rate limit по IP: 11-й запрос подряд → 429", async () => {
    const ip = uniqueIp();
    let lastStatus = 0;
    for (let i = 0; i < 11; i += 1) {
      const response = await bookRoute(
        // Демо-id: валидная цель для лимитера, в БД не ходит.
        makeRequest(`/api/v1/items/demo:jewelry:0/book`, { body: { name: "Гость" }, ip }),
        itemCtx("demo:jewelry:0"),
      );
      lastStatus = response.status;
      if (i < 10) expect(response.status).toBe(400); // бюджет ещё есть — доменный отказ
    }
    expect(lastStatus).toBe(429);
  });
});

describe("DELETE /api/v1/items/{id}/book и POST …/book/purchased — токен из cookie", () => {
  it("отмена: сервер сам находит токен вещи в cookie и вычёркивает его", async () => {
    const room = await createTestRoom();
    const item = await createWantItem(room.id);
    const booked = await bookRoute(
      makeRequest(`/api/v1/items/${item.id}/book`, { body: { name: "Гость" } }),
      itemCtx(item.id),
    );
    const { cancelToken } = ((await booked.json()) as { data: { cancelToken: string } }).data;

    const response = await cancelRoute(
      makeRequest(`/api/v1/items/${item.id}/book`, {
        method: "DELETE",
        cookieTokens: ["a".repeat(48), cancelToken],
      }),
      itemCtx(item.id),
    );
    expect(response.status).toBe(200);
    expect(await prisma.booking.findUnique({ where: { itemId: item.id } })).toBeNull();
    // Cookie переписана без использованного токена.
    expect(decodeURIComponent(response.headers.get("set-cookie") ?? "")).not.toContain(cancelToken);
  });

  it("без своего токена (нет cookie / чужой токен) → 404 NO_BOOKING, бронь цела", async () => {
    const room = await createTestRoom();
    const item = await createWantItem(room.id);
    await bookRoute(
      makeRequest(`/api/v1/items/${item.id}/book`, { body: { name: "Гость" } }),
      itemCtx(item.id),
    );

    const noCookie = await cancelRoute(
      makeRequest(`/api/v1/items/${item.id}/book`, { method: "DELETE" }),
      itemCtx(item.id),
    );
    expect(noCookie.status).toBe(404);

    const foreign = await cancelRoute(
      makeRequest(`/api/v1/items/${item.id}/book`, {
        method: "DELETE",
        cookieTokens: ["c".repeat(48)],
      }),
      itemCtx(item.id),
    );
    expect(foreign.status).toBe(404);
    expect(await prisma.booking.count({ where: { itemId: item.id } })).toBe(1);
  });

  it("«куплено»: пустое тело — true, {purchased:false} — снимает отметку", async () => {
    const room = await createTestRoom();
    const item = await createWantItem(room.id);
    const booked = await bookRoute(
      makeRequest(`/api/v1/items/${item.id}/book`, { body: { name: "Гость" } }),
      itemCtx(item.id),
    );
    const { cancelToken } = ((await booked.json()) as { data: { cancelToken: string } }).data;

    const on = await purchasedRoute(
      makeRequest(`/api/v1/items/${item.id}/book/purchased`, { cookieTokens: [cancelToken] }),
      itemCtx(item.id),
    );
    expect(on.status).toBe(200);
    expect((await prisma.booking.findUnique({ where: { itemId: item.id } }))?.purchased).toBe(true);

    const off = await purchasedRoute(
      makeRequest(`/api/v1/items/${item.id}/book/purchased`, {
        cookieTokens: [cancelToken],
        body: { purchased: false },
      }),
      itemCtx(item.id),
    );
    expect(off.status).toBe(200);
    expect((await prisma.booking.findUnique({ where: { itemId: item.id } }))?.purchased).toBe(
      false,
    );

    const foreign = await purchasedRoute(
      makeRequest(`/api/v1/items/${item.id}/book/purchased`, { cookieTokens: ["d".repeat(48)] }),
      itemCtx(item.id),
    );
    expect(foreign.status).toBe(404);
  });
});

describe("GET /api/v1/rooms/{slug}/taken — канал «занято»", () => {
  it("no-store; только id + mine по своей cookie + счётчик; никаких имён/почт", async () => {
    const room = await createTestRoom();
    const myItem = await createWantItem(room.id);
    const strangersItem = await createWantItem(room.id);
    await createWantItem(room.id); // свободная

    const booked = await bookRoute(
      makeRequest(`/api/v1/items/${myItem.id}/book`, {
        body: { name: "Я Сам", email: "me-secret@mail.test" },
      }),
      itemCtx(myItem.id),
    );
    const { cancelToken } = ((await booked.json()) as { data: { cancelToken: string } }).data;
    await bookRoute(
      makeRequest(`/api/v1/items/${strangersItem.id}/book`, {
        body: { name: "Чужой Человек", email: "stranger-secret@mail.test" },
      }),
      itemCtx(strangersItem.id),
    );

    const response = await takenRoute(
      makeRequest(`/api/v1/rooms/${room.shareSlug}/taken`, {
        method: "GET",
        cookieTokens: [cancelToken],
      }),
      slugCtx(room.shareSlug),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");

    const payload = (await response.json()) as {
      data: { itemIds: string[]; mine: string[]; myBookingsCount: number };
    };
    expect([...payload.data.itemIds].sort()).toEqual([myItem.id, strangersItem.id].sort());
    expect(payload.data.mine).toEqual([myItem.id]);
    expect(payload.data.myBookingsCount).toBe(1);

    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/guestName|guestEmail|secret|Чужой|Я Сам|cancelToken/);
  });

  it("неизвестный слаг → 404 и тоже no-store", async () => {
    const response = await takenRoute(
      makeRequest(`/api/v1/rooms/no-such-room/taken`, { method: "GET" }),
      slugCtx("no-such-room"),
    );
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
