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

async function createTestRoom(
  options: { zonesOff?: string[]; displayName?: string; occasionDate?: Date } = {},
) {
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
      occasionDate: options.occasionDate,
    },
  });
}

/** Тихая бронь на вещи: гость занял, хозяйка об этом не узнала (тикет 08). */
async function bookItem(itemId: string, guestName = "Катя"): Promise<void> {
  await prisma.booking.create({
    data: {
      itemId,
      guestName,
      cancelToken: randomUUID().replace(/-/g, "").slice(0, 24) + randomUUID().replace(/-/g, "").slice(0, 24),
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

  it("дата праздника отдаётся календарным днём и не съезжает от часового пояса", async () => {
    // Дата пишется полночью UTC (services/rooms.setOccasionDate). Читать её
    // поясом машины значило бы получить 30 декабря в Москве — проверяем
    // именно край года, где ошибка на сутки видна.
    const room = await createTestRoom({ occasionDate: new Date("2026-12-31T00:00:00.000Z") });
    expect((await getGuestRoom(room.shareSlug))?.occasionDate).toBe("2026-12-31");

    const noDate = await createTestRoom();
    expect((await getGuestRoom(noDate.shareSlug))?.occasionDate).toBeNull();
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

// «7 подарков ещё свободны» (тикет 38, турн 12b) — самое опасное место
// тикета: рядом с этим числом легко случайно показать обратное, «сколько уже
// забрали», а его гость не видит НИКОГДА (инвариант №1).
describe("getGuestRoom — свободные подарки", () => {
  it("считает вещи «хочу» без брони; занятая вещь из счёта уходит", async () => {
    const room = await createTestRoom();
    const first = await prisma.item.create({ data: wantItem(room.id, "jewelry", "Серьги") });
    await prisma.item.create({ data: wantItem(room.id, "bags", "Сумка") });
    await prisma.item.create({ data: wantItem(room.id, "perfume", "Духи") });

    expect((await getGuestRoom(room.shareSlug))?.freeGiftCount).toBe(3);

    await bookItem(first.id);
    expect((await getGuestRoom(room.shareSlug))?.freeGiftCount).toBe(2);
  });

  it("«люблю» не подарок: в счёт не идёт даже с ценой", async () => {
    const room = await createTestRoom();
    await prisma.item.create({ data: wantItem(room.id, "jewelry", "Браслет") });
    await prisma.item.create({
      data: { roomId: room.id, zone: "jewelry", state: "LOVE", title: "Кольцо бабушки" },
    });

    expect((await getGuestRoom(room.shareSlug))?.freeGiftCount).toBe(1);
  });

  it("спрятанная вещь и вещь выключенной зоны не обещают подарка", async () => {
    // Число обязано совпадать с тем, что человек видит глазами: иначе оно
    // обещает подарки, которых на экране нет (инвариант №5).
    const room = await createTestRoom({ zonesOff: ["perfume"] });
    await prisma.item.create({ data: wantItem(room.id, "jewelry", "Видимая") });
    await prisma.item.create({
      data: wantItem(room.id, "jewelry", "Спрятанная", { hidden: true }),
    });
    await prisma.item.create({ data: wantItem(room.id, "perfume", "В выключенной зоне") });

    expect((await getGuestRoom(room.shareSlug))?.freeGiftCount).toBe(1);
  });

  it("демо-призраки в счёт не идут: у новой комнаты свободных подарков нет", async () => {
    // Призраки — пример языка комнаты, а не желания хозяйки. Посчитай мы их —
    // гость пошёл бы дарить выдуманное (бронировать их сервер и так не даёт).
    const room = await createTestRoom();
    const view = await getGuestRoom(room.shareSlug);

    expect(view?.freeGiftCount).toBe(0);
    expect(view?.itemsByZone.jewelry?.every((item) => item.isDemo)).toBe(true);
  });

  it("ИНВАРИАНТ №1: сколько ЗАБРАЛИ — из выдачи не вычислить", async () => {
    // Две комнаты с одинаковым числом свободных подарков, но разным числом
    // занятых. Всё, что гость получает от сервиса, обязано быть НЕОТЛИЧИМО:
    // иначе он (а с ним и хозяйка, открывшая свою же ссылку) прочитает из
    // выдачи «две вещи уже забрали».
    const quiet = await createTestRoom();
    const busy = await createTestRoom();
    for (const title of ["Первая", "Вторая"]) {
      await prisma.item.create({ data: wantItem(quiet.id, "jewelry", title) });
      await prisma.item.create({ data: wantItem(busy.id, "jewelry", title) });
    }
    for (const title of ["Занятая А", "Занятая Б"]) {
      const taken = await prisma.item.create({ data: wantItem(busy.id, "bags", title) });
      await bookItem(taken.id);
    }

    const quietView = await getGuestRoom(quiet.shareSlug);
    const busyView = await getGuestRoom(busy.shareSlug);

    expect(quietView?.freeGiftCount).toBe(2);
    expect(busyView?.freeGiftCount).toBe(2);

    // Ни одного числа, из которого счётчик занятых восстанавливается: у
    // комнат совпадают и свободные, и все сводки по зоне с вещами.
    expect(busyView?.summariesByZone.jewelry).toEqual(quietView?.summariesByZone.jewelry);
  });

  it("в выдаче нет ни одного ключа про занятость — тип не даёт унести больше", async () => {
    const room = await createTestRoom();
    const item = await prisma.item.create({ data: wantItem(room.id, "jewelry", "Серьги") });
    await bookItem(item.id, "Секретная Катя");

    const view = await getGuestRoom(room.shareSlug);
    for (const key of Object.keys(view ?? {})) {
      expect(key).not.toMatch(/taken|booked|busy|reserv|occupied/i);
    }
    // Имя гостя не течёт никуда — ни строкой, ни в сводке.
    expect(JSON.stringify(view)).not.toContain("Секретная Катя");
  });
});
