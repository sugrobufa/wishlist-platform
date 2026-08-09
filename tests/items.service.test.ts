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
    inHall: false,
    title,
    price: "4300",
    currency: "RUB",
    desire,
    createdAt: new Date(createdAt),
  };
}

/**
 * Вещь СОКРОВИЩНИЦЫ. Зону она держит (иначе «Вернуть в комнату» некуда), но
 * в сетке зоны не показывается вовсе (тикет 124) — на этом и стоят тесты ниже.
 */
function hallItem(
  roomId: string,
  zone: string,
  title: string,
  createdAt: string,
): Prisma.ItemCreateInput {
  return {
    room: { connect: { id: roomId } },
    zone,
    inHall: true,
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
    await prisma.item.create({ data: wantItem(room.id, "jewelry", "своя-1", 2, "2026-01-01") });
    await prisma.item.create({ data: wantItem(room.id, "bags", "чужая зона", 2, "2026-01-02") });
    await prisma.item.create({
      data: wantItem(otherRoom.id, "jewelry", "чужая комната", 2, "2026-01-03"),
    });

    const items = await listZoneItems(room.id, "jewelry");
    expect(titles(items)).toEqual(["своя-1"]);
  });

  // НОВЫЙ ТЕСТ (тикет 124): комната — чего хочется, витрина — что уже моё.
  // Вещь сокровищницы держит свою зону, но в сетке зоны её нет.
  it("вещь сокровищницы в сетку зоны не приезжает, хотя зону держит", async () => {
    const room = await createTestRoom();
    const wanted = await prisma.item.create({
      data: wantItem(room.id, "jewelry", "в комнате", 3, "2026-01-01"),
    });
    const treasured = await prisma.item.create({
      data: hallItem(room.id, "jewelry", "в сокровищнице", "2026-01-02"),
    });

    expect(titles(await listZoneItems(room.id, "jewelry"))).toEqual([wanted.title]);
    // Зона у витринной вещи на месте — возвращать есть куда.
    expect(treasured.zone).toBe("jewelry");
  });

  it("пустая зона — пустой список (демо-призраки живут выше сервиса и в БД не пишутся)", async () => {
    const room = await createTestRoom();
    expect(await listZoneItems(room.id, "perfume")).toEqual([]);
  });

  // ПЕРЕПИСАНО (тикет 124): групп «люблю»/«хочу» больше нет — делить сетку
  // нечем. Осталась ЕДИНСТВЕННАЯ градация вещи: desire ↓, без desire — в
  // конец, внутри равных — новые выше.
  it("сортировка: desire ↓, без desire в конец, внутри — новые выше", async () => {
    const room = await createTestRoom();
    const zone = "jewelry";
    // Вставляем вперемешку, чтобы порядок не совпал со вставкой.
    await prisma.item.create({ data: wantItem(room.id, zone, "desire2-старая", 2, "2026-01-01") });
    await prisma.item.create({ data: wantItem(room.id, zone, "без-desire", null, "2026-01-05") });
    await prisma.item.create({ data: wantItem(room.id, zone, "desire4", 4, "2026-01-02") });
    await prisma.item.create({ data: wantItem(room.id, zone, "desire3", 3, "2026-01-04") });
    await prisma.item.create({ data: wantItem(room.id, zone, "desire2-новая", 2, "2026-01-03") });
    // Витринная вещь этой же зоны в сетке не участвует вовсе.
    await prisma.item.create({ data: hallItem(room.id, zone, "в сокровищнице", "2026-01-06") });

    const items = await listZoneItems(room.id, zone);
    expect(titles(items)).toEqual([
      "desire4",
      "desire3",
      "desire2-новая",
      "desire2-старая",
      "без-desire",
    ]);
  });

  it("спрятанная вещь (hidden) остаётся в выдаче хозяйки", async () => {
    const room = await createTestRoom();
    await prisma.item.create({
      data: { ...wantItem(room.id, "bags", "спрятанная", 2, "2026-01-01"), hidden: true },
    });

    const items = await listZoneItems(room.id, "bags");
    expect(titles(items)).toEqual(["спрятанная"]);
    expect(items[0]?.hidden).toBe(true);
  });
});
