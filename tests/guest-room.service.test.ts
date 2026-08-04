// Интеграционные тесты сервиса «Комната гостя» через его публичную функцию
// с реальной тест-БД (Postgres из docker compose) — самый высокий шов (spec).
// Главные инварианты (CLAUDE.md №5): спрятанные вещи и выключенные зоны НЕ
// текут гостю — фильтр на чтении, под тестом.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { prisma } from "../src/server/db";
import { getGuestRoom } from "../src/server/services/guest-room";

// Вне Next-рантайма у unstable_cache нет incremental cache — в тестах чтение
// идёт напрямую (тегами и ревалидацией управляет Next, здесь их не проверить).
vi.mock("next/cache", () => ({
  unstable_cache:
    <T extends (...args: never[]) => unknown>(fn: T) =>
    (...args: Parameters<T>) =>
      fn(...args),
}));

const TEST_EMAIL_DOMAIN = "@guest-room.test";

async function createTestRoom(options: { zonesOff?: string[]; displayName?: string } = {}) {
  const user = await prisma.user.create({
    data: {
      email: `user-${randomUUID()}${TEST_EMAIL_DOMAIN}`,
      displayName: options.displayName,
    },
  });
  return prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `g-${randomUUID().slice(0, 12)}`,
      zonesOff: options.zonesOff ?? [],
    },
  });
}

function wantItem(
  roomId: string,
  zone: string,
  title: string,
  overrides: Partial<Prisma.ItemUncheckedCreateInput> = {},
): Prisma.ItemUncheckedCreateInput {
  return {
    roomId,
    zone,
    state: "WANT",
    title,
    price: "4300",
    currency: "RUB",
    ...overrides,
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

describe("getGuestRoom", () => {
  it("неизвестный слаг → null (страница отвечает 404); мусорный слаг — тоже", async () => {
    expect(await getGuestRoom("nonexistent-slug")).toBeNull();
    expect(await getGuestRoom("")).toBeNull();
    expect(await getGuestRoom("x".repeat(1000))).toBeNull();
  });

  it("отдаёт комнату: пресет, zonesOff, имя хозяйки, вещи по зонам", async () => {
    const room = await createTestRoom({ displayName: "Мила" });
    await prisma.item.create({ data: wantItem(room.id, "jewelry", "Серьги-кольца") });

    const view = await getGuestRoom(room.shareSlug);
    expect(view).not.toBeNull();
    expect(view?.roomId).toBe(room.id);
    expect(view?.preset).toBe("cream");
    expect(view?.zonesOff).toEqual([]);
    expect(view?.ownerName).toBe("Мила");
    expect(view?.itemsByZone.jewelry?.map((i) => i.title)).toEqual(["Серьги-кольца"]);
    // Своя вещь в зоне вытесняет демо-призраков.
    expect(view?.itemsByZone.jewelry?.every((i) => !i.isDemo)).toBe(true);
  });

  it("спрятанная вещь (hidden) не попадает в выдачу — нигде, даже строкой", async () => {
    const room = await createTestRoom();
    const secret = `секрет-${randomUUID()}`;
    await prisma.item.create({ data: wantItem(room.id, "jewelry", "Открытая вещь") });
    await prisma.item.create({
      data: wantItem(room.id, "jewelry", secret, { hidden: true }),
    });

    const view = await getGuestRoom(room.shareSlug);
    expect(view?.itemsByZone.jewelry?.map((i) => i.title)).toEqual(["Открытая вещь"]);
    // «Не течёт»: спрятанного названия нет ни в одном уголке сериализации.
    expect(JSON.stringify(view)).not.toContain(secret);
  });

  it("зона из zonesOff исключена целиком — вместе со всеми вещами", async () => {
    const room = await createTestRoom({ zonesOff: ["perfume"] });
    const secret = `парфюм-${randomUUID()}`;
    await prisma.item.create({ data: wantItem(room.id, "perfume", secret) });

    const view = await getGuestRoom(room.shareSlug);
    expect(view?.zonesOff).toEqual(["perfume"]);
    expect(view && "perfume" in view.itemsByZone).toBe(false);
    expect(JSON.stringify(view)).not.toContain(secret);
    // Остальные зоны cream на месте (fashion, beauty, jewelry, bags, travel, anything).
    expect(Object.keys(view?.itemsByZone ?? {})).toContain("jewelry");
    expect(Object.keys(view?.itemsByZone ?? {})).not.toContain("perfume");
  });

  it("пустая зона наполнена демо-призраками пула — помеченными isDemo", async () => {
    const room = await createTestRoom();

    const view = await getGuestRoom(room.shareSlug);
    const ghosts = view?.itemsByZone.jewelry ?? [];
    expect(ghosts.length).toBeGreaterThan(0);
    expect(ghosts.every((g) => g.isDemo)).toBe(true);
    // Оба состояния — язык комнаты виден гостю новичка целиком.
    expect(ghosts.some((g) => g.state === "LOVE")).toBe(true);
    expect(ghosts.some((g) => g.state === "WANT")).toBe(true);
  });

  it("зона, где всё спрятано, для гостя пуста → призраки (нет канала «тут что-то спрятано»)", async () => {
    const room = await createTestRoom();
    const secret = `спрятанное-${randomUUID()}`;
    await prisma.item.create({ data: wantItem(room.id, "bags", secret, { hidden: true }) });

    const view = await getGuestRoom(room.shareSlug);
    const bags = view?.itemsByZone.bags ?? [];
    // Выдача — чистая функция видимого гостю: как у зоны вовсе без вещей.
    expect(bags.length).toBeGreaterThan(0);
    expect(bags.every((g) => g.isDemo)).toBe(true);
    expect(JSON.stringify(view)).not.toContain(secret);
  });

  it("цена «хочу»: ME/NONE не отдают даже ключа, ALL/FRIENDS отдают", async () => {
    const room = await createTestRoom();
    await prisma.item.create({
      data: wantItem(room.id, "jewelry", "цена всем", { priceVisibility: "ALL" }),
    });
    await prisma.item.create({
      data: wantItem(room.id, "jewelry", "цена друзьям", { priceVisibility: "FRIENDS" }),
    });
    await prisma.item.create({
      data: wantItem(room.id, "jewelry", "цена только мне", { priceVisibility: "ME" }),
    });
    await prisma.item.create({
      data: wantItem(room.id, "jewelry", "цена никому", { priceVisibility: "NONE" }),
    });

    const view = await getGuestRoom(room.shareSlug);
    const byTitle = new Map(view?.itemsByZone.jewelry?.map((i) => [i.title, i]));

    expect(byTitle.get("цена всем")).toMatchObject({ price: "4300", currency: "RUB" });
    // Phase 1: FRIENDS = ALL (градация связей придёт позже, TODO в DTO).
    expect(byTitle.get("цена друзьям")).toMatchObject({ price: "4300" });
    expect("price" in (byTitle.get("цена только мне") ?? {})).toBe(false);
    expect("price" in (byTitle.get("цена никому") ?? {})).toBe(false);
    expect("currency" in (byTitle.get("цена никому") ?? {})).toBe(false);
  });

  it("цена «люблю» не течёт: даже оставшаяся в БД цена не сериализуется", async () => {
    const room = await createTestRoom();
    await prisma.item.create({
      data: {
        roomId: room.id,
        zone: "jewelry",
        state: "LOVE",
        title: "Браслет с историей",
        price: "77777.77",
        currency: "RUB",
        priceVisibility: "ALL",
        giverName: "мама",
        receivedAt: new Date("2024-03-08T10:00:00.000Z"),
      },
    });

    const view = await getGuestRoom(room.shareSlug);
    const love = view?.itemsByZone.jewelry?.[0];
    expect(love?.state).toBe("LOVE");
    expect(love && "price" in love).toBe(false);
    expect(love && "currency" in love).toBe(false);
    expect(JSON.stringify(view)).not.toContain("77777.77");
  });

  it("ни у одной вещи выдачи нет ключей hidden/priceVisibility/брони", async () => {
    const room = await createTestRoom();
    await prisma.item.create({ data: wantItem(room.id, "jewelry", "своя вещь") });

    const view = await getGuestRoom(room.shareSlug);
    for (const items of Object.values(view?.itemsByZone ?? {})) {
      for (const item of items) {
        for (const key of Object.keys(item)) {
          expect(key).not.toMatch(/hidden|visib|book|guest|taken|reserv|purchas|cancel/i);
        }
      }
    }
  });
});
