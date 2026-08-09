// Интеграционные тесты createItem (тикет 04) через публичную функцию сервиса
// с реальной тест-БД — самый высокий шов (spec Phase 1). Каждый вызов заодно
// проверяет, что revalidateTag вне request-scope Next не роняет сервис.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { prisma } from "../src/server/db";
import {
  CreateItemError,
  createItem,
  listZoneItems,
  roomCacheTag,
} from "../src/server/services/items";

const TEST_EMAIL_DOMAIN = "@items-create.test";

async function createTestUser() {
  return prisma.user.create({
    data: { email: `user-${randomUUID()}${TEST_EMAIL_DOMAIN}` },
  });
}

// Пресет cream (rooms.json): fashion, beauty, jewelry, perfume, bags,
// travel, anything. Ключа watches в нём нет — он из мужских комнат.
async function createTestRoom(zonesOff: string[] = []) {
  const user = await createTestUser();
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      zonesOff,
      shareSlug: `t-${randomUUID().slice(0, 12)}`,
    },
  });
  return { user, room };
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const wantInput = (overrides: Record<string, unknown> = {}) => ({
  inHall: false,
  zone: "jewelry",
  title: "Серьги-кольца",
  price: "14900,50",
  currency: "rub",
  ...overrides,
});

describe("createItem — WANT", () => {
  it("хэппи-пас: деньги Decimal-строкой, source=MANUAL, вещь сразу в выдаче зоны", async () => {
    const { user, room } = await createTestRoom();
    const item = await createItem(
      user.id,
      wantInput({
        priceVisibility: "FRIENDS",
        size: "M",
        color: "золотой",
        desire: 3,
        note: "на день рождения",
        url: "https://shop.example/rings",
      }),
    );

    expect(item.roomId).toBe(room.id);
    expect(item.inHall).toBe(false);
    expect(item.source).toBe("MANUAL");
    expect(item.price?.toFixed(2)).toBe("14900.50");
    expect(item.currency).toBe("RUB");
    expect(item.priceVisibility).toBe("FRIENDS");
    expect(item.desire).toBe(3);
    expect(item.hidden).toBe(false);

    const listed = await listZoneItems(room.id, "jewelry");
    expect(listed.map((row) => row.id)).toContain(item.id);
  });

  it("без цены — падает валидацией (ZodError), в БД ничего не пишется", async () => {
    const { user, room } = await createTestRoom();
    await expect(createItem(user.id, wantInput({ price: undefined }))).rejects.toBeInstanceOf(
      ZodError,
    );
    expect(await listZoneItems(room.id, "jewelry")).toEqual([]);
  });
});

describe("createItem — LOVE", () => {
  it("цена в инпуте LOVE не записывается: в БД price/currency/desire — null", async () => {
    const { user, room } = await createTestRoom();
    const item = await createItem(user.id, {
      inHall: true,
      zone: "jewelry",
      title: "Теннисный браслет",
      // Лишние для LOVE поля — отбрасываются ДО записи (инвариант §8).
      price: "9900",
      currency: "RUB",
      priceVisibility: "NONE",
      size: "S",
      desire: 4,
    });

    const row = await prisma.item.findUniqueOrThrow({ where: { id: item.id } });
    expect(row.inHall).toBe(true);
    expect(row.price).toBeNull();
    expect(row.currency).toBeNull();
    expect(row.size).toBeNull();
    expect(row.desire).toBeNull();
    expect(row.roomId).toBe(room.id);
  });

  it("вещь витрины без дарителя и даты; даритель+год — receivedAt хранит год", async () => {
    const { user } = await createTestRoom();
    const mine = await createItem(user.id, {
      inHall: true,
      zone: "bags",
      title: "Кожаный шопер",
    });
    expect(mine.giverName).toBeNull();
    expect(mine.receivedAt).toBeNull();
    // ПЕРЕПИСАНО (тикет 124): было `inHall: false` — «в зал руками, если
    // захочет». Теперь `inHall: true` в инпуте и означает витрину.
    expect(mine.inHall).toBe(true);

    const gifted = await createItem(user.id, {
      inHall: true,
      zone: "bags",
      title: "Платок",
      giverName: "мама",
      receivedYear: 2024,
    });
    expect(gifted.giverName).toBe("мама");
    expect(gifted.receivedAt?.getUTCFullYear()).toBe(2024);
  });
});

describe("createItem — ownership и зоны", () => {
  it("зона чужого набора (watches у cream) — отказ ZONE_NOT_VISIBLE", async () => {
    const { user } = await createTestRoom();
    const attempt = createItem(user.id, wantInput({ zone: "watches" }));
    await expect(attempt).rejects.toBeInstanceOf(CreateItemError);
    await expect(attempt).rejects.toMatchObject({ code: "ZONE_NOT_VISIBLE" });
  });

  it("выключенная зона (zonesOff) исчезла с мебелью — добавить в неё нельзя", async () => {
    const { user } = await createTestRoom(["perfume"]);
    await expect(createItem(user.id, wantInput({ zone: "perfume" }))).rejects.toMatchObject({
      code: "ZONE_NOT_VISIBLE",
    });
  });

  it("у пользователя нет комнаты — отказ NO_ROOM", async () => {
    const user = await createTestUser();
    await expect(createItem(user.id, wantInput())).rejects.toMatchObject({ code: "NO_ROOM" });
  });

  it("вещь встаёт ТОЛЬКО в свою комнату: roomId из сессии, не из инпута", async () => {
    const a = await createTestRoom();
    const b = await createTestRoom();

    // Попытка подсунуть чужой roomId в инпуте молча отбрасывается схемой.
    const item = await createItem(a.user.id, wantInput({ roomId: b.room.id }));
    expect(item.roomId).toBe(a.room.id);
    expect(await listZoneItems(b.room.id, "jewelry")).toEqual([]);
  });

  it("photoKey чужой комнаты — отказ FOREIGN_PHOTO_KEY; свой — записывается", async () => {
    const a = await createTestRoom();
    const b = await createTestRoom();

    await expect(
      createItem(a.user.id, wantInput({ photoKey: `items/${b.room.id}/0123456789abcdef.jpg` })),
    ).rejects.toMatchObject({ code: "FOREIGN_PHOTO_KEY" });

    const ownKey = `items/${a.room.id}/0123456789abcdef.jpg`;
    const item = await createItem(a.user.id, wantInput({ photoKey: ownKey }));
    expect(item.photoKey).toBe(ownKey);
  });
});

describe("кэш комнаты", () => {
  it("тег комнаты стабилен — гостевая страница (тикет 07) подписывается на него же", () => {
    expect(roomCacheTag("room_1")).toBe("room-room_1");
  });
});
