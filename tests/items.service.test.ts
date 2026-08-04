// Интеграционные тесты сервиса «Вещь» через его публичные функции с реальной
// тест-БД (Postgres из docker compose) — самый высокий шов (spec Phase 1).
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Item, Prisma } from "@prisma/client";
import { prisma } from "../src/server/db";
import { listZoneItems } from "../src/server/services/items";

const TEST_EMAIL_DOMAIN = "@items-service.test";

async function createTestRoom() {
  const user = await prisma.user.create({
    data: { email: `user-${randomUUID()}${TEST_EMAIL_DOMAIN}` },
  });
  return prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `t-${randomUUID().slice(0, 12)}`,
    },
  });
}

function wantItem(
  roomId: string,
  zone: string,
  title: string,
  desire: number | null,
  createdAt: string,
): Prisma.ItemCreateInput {
  return {
    room: { connect: { id: roomId } },
    zone,
    state: "WANT",
    title,
    price: "4300",
    currency: "RUB",
    desire,
    createdAt: new Date(createdAt),
  };
}

function loveItem(
  roomId: string,
  zone: string,
  title: string,
  createdAt: string,
): Prisma.ItemCreateInput {
  return {
    room: { connect: { id: roomId } },
    zone,
    state: "LOVE",
    title,
    createdAt: new Date(createdAt),
  };
}

// Чистим только своих пользователей; комнаты и вещи уходят каскадом.
async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

const titles = (items: Item[]) => items.map((item) => item.title);

describe("listZoneItems", () => {
  it("отдаёт только вещи своей зоны и своей комнаты", async () => {
    const room = await createTestRoom();
    const otherRoom = await createTestRoom();
    await prisma.item.create({ data: loveItem(room.id, "jewelry", "своя-1", "2026-01-01") });
    await prisma.item.create({ data: loveItem(room.id, "bags", "чужая зона", "2026-01-02") });
    await prisma.item.create({ data: loveItem(otherRoom.id, "jewelry", "чужая комната", "2026-01-03") });

    const items = await listZoneItems(room.id, "jewelry");
    expect(titles(items)).toEqual(["своя-1"]);
  });

  it("пустая зона — пустой список (демо-призраки живут выше сервиса и в БД не пишутся)", async () => {
    const room = await createTestRoom();
    expect(await listZoneItems(room.id, "perfume")).toEqual([]);
  });

  it("сортировка: «люблю» новыми вперёд, затем «хочу» по desire ↓, без desire в конец, внутри — новые выше", async () => {
    const room = await createTestRoom();
    const zone = "jewelry";
    // Вставляем вперемешку, чтобы порядок не совпал со вставкой.
    await prisma.item.create({ data: wantItem(room.id, zone, "want-desire2-старая", 2, "2026-01-01") });
    await prisma.item.create({ data: loveItem(room.id, zone, "love-старая", "2026-01-01") });
    await prisma.item.create({ data: wantItem(room.id, zone, "want-без-desire", null, "2026-01-05") });
    await prisma.item.create({ data: wantItem(room.id, zone, "want-desire4", 4, "2026-01-02") });
    await prisma.item.create({ data: loveItem(room.id, zone, "love-новая", "2026-01-04") });
    await prisma.item.create({ data: wantItem(room.id, zone, "want-desire2-новая", 2, "2026-01-03") });

    const items = await listZoneItems(room.id, zone);
    expect(titles(items)).toEqual([
      "love-новая",
      "love-старая",
      "want-desire4",
      "want-desire2-новая",
      "want-desire2-старая",
      "want-без-desire",
    ]);
  });

  it("спрятанная вещь (hidden) остаётся в выдаче хозяйки", async () => {
    const room = await createTestRoom();
    await prisma.item.create({
      data: { ...loveItem(room.id, "bags", "спрятанная", "2026-01-01"), hidden: true },
    });

    const items = await listZoneItems(room.id, "bags");
    expect(titles(items)).toEqual(["спрятанная"]);
    expect(items[0]?.hidden).toBe(true);
  });
});
