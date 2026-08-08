// Сокровищница глазами гостя (тикет 93, доска А5 · турны 11b и 11c).
//
// Что здесь защищается:
// - три фильтра на чтении и все на сервере: спрятанная вещь (инвариант №5),
//   вещь выключенной зоны (там же) и вещь, спрятанная глазком (тикет 89);
// - цена появляется КЛЮЧОМ только по настройке зала, и скрытие цены у
//   отдельной вещи перекрывает открытый зал (инвариант №8, ADR-0004);
// - сумма витрины считается по тем ценам, которые гость и так видит: сумма
//   по закрытым ценам выдала бы их;
// - «Кто подарил» и «Округлять цены» слушаются своих тумблеров;
// - формы гостя не существует ключей inHall/hiddenFromHall/booking.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

// Кэш подделан НЕ сквозным, а с прогоном через JSON — так ведёт себя Next Data
// Cache на самом деле. Сквозной мок (как в соседних тестах) пропустил бы
// настоящую ошибку: положи в кэш строку БД, и `receivedAt` вернётся СТРОКОЙ,
// а `getUTCFullYear` упадёт на первом же попадании. Поймал живой стенд —
// теперь ловит тест: в кэше обязаны лежать только готовые формы (чистый JSON).
vi.mock("next/cache", () => ({
  unstable_cache:
    <T extends (...args: never[]) => unknown>(fn: T) =>
    async (...args: Parameters<T>) =>
      JSON.parse(JSON.stringify(await fn(...args))) as unknown,
  revalidateTag: () => undefined,
}));

import { prisma } from "../src/server/db";
import { getGuestHall } from "../src/server/services/guest-hall";
import { setHallSettings } from "../src/server/services/rooms";

const TEST_EMAIL_DOMAIN = "@guest-hall.test";

async function createRoom(displayName: string | null = "Ирина") {
  const user = await prisma.user.create({
    data: { email: `owner-${randomUUID()}${TEST_EMAIL_DOMAIN}`, displayName },
  });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `gh-${randomUUID().slice(0, 12)}`,
      // Витрина гостю интересна ценами — открываем зал сразу, где не сказано
      // иначе. Дефолт FRIENDS проверяется отдельным тестом.
      hallPriceVisibility: "ALL",
    },
  });
  return { user, room };
}

async function createLove(
  roomId: string,
  title: string,
  overrides: Partial<Prisma.ItemUncheckedCreateInput> = {},
) {
  return prisma.item.create({
    data: { roomId, zone: "jewelry", state: "LOVE", title, inHall: true, ...overrides },
  });
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("getGuestHall — что вообще доезжает до гостя", () => {
  it("три фильтра: спрятанная, из выключенной зоны и спрятанная глазком — не видны", async () => {
    const { room } = await createRoom();

    const shown = await createLove(room.id, "Браслет", {
      receivedAt: new Date("2025-03-14T12:00:00Z"),
      giverName: "мама",
    });
    await createLove(room.id, "Спрятана глазком", { hiddenFromHall: true });
    await createLove(room.id, "Спрятана от гостей", { hidden: true });
    await createLove(room.id, "Из выключенной зоны", { zone: "perfume" });
    await createLove(room.id, "Не на витрине", { inHall: false });
    await prisma.item.create({
      data: {
        roomId: room.id,
        zone: "jewelry",
        state: "WANT",
        title: "Хочу с мусорным флагом",
        price: "5000",
        currency: "RUB",
        inHall: true,
      },
    });

    // Зона «Парфюм» выключена — вещь уезжает вместе с мебелью.
    await prisma.room.update({ where: { id: room.id }, data: { zonesOff: ["perfume"] } });

    const hall = await getGuestHall(room.shareSlug);
    expect(hall?.items.map((item) => item.title)).toEqual([shown.title]);
    expect(hall?.ownerName).toBe("Ирина");
  });

  it("формы гостя нет ключей витрины и брони — allowlist, а не отбор полей", async () => {
    const { room } = await createRoom();
    await createLove(room.id, "Браслет", { price: "62000", currency: "RUB" });

    const hall = await getGuestHall(room.shareSlug);
    const item = hall?.items[0];
    expect(item).toBeDefined();
    for (const forbidden of ["inHall", "hiddenFromHall", "hidden", "booking", "zone", "roomId"]) {
      expect(item).not.toHaveProperty(forbidden);
    }
    expect(JSON.stringify(item)).not.toMatch(/hidden|booking/iu);
  });

  it("неизвестный адрес — null; ник и короткий код ведут в одну витрину", async () => {
    const { room } = await createRoom();
    await createLove(room.id, "Браслет");
    await prisma.room.update({
      where: { id: room.id },
      data: { nick: `nick-${randomUUID().slice(0, 8)}` },
    });
    const withNick = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });

    expect(await getGuestHall("нет-такой-комнаты")).toBeNull();
    expect((await getGuestHall(withNick.nick!))?.items).toHaveLength(1);
    expect((await getGuestHall(room.shareSlug))?.items).toHaveLength(1);
  });

  it("пустая витрина — это не 404: комната есть, показывать нечего", async () => {
    const { room } = await createRoom();
    const hall = await getGuestHall(room.shareSlug);
    expect(hall).not.toBeNull();
    expect(hall?.items).toEqual([]);
    expect(hall?.totals).toEqual([]);
  });
});

describe("getGuestHall — цена по настройке зала (инвариант №8)", () => {
  it("дефолт FRIENDS: ключа цены нет вовсе", async () => {
    const { user, room } = await createRoom();
    await setHallSettings(user.id, { priceVisibility: "FRIENDS" });
    await createLove(room.id, "Браслет", { price: "62000", currency: "RUB" });

    const item = (await getGuestHall(room.shareSlug))?.items[0];
    expect(item).not.toHaveProperty("price");
    expect(item).not.toHaveProperty("currency");
  });

  it("ALL открывает цену; скрытая у ОТДЕЛЬНОЙ вещи остаётся закрытой", async () => {
    const { room } = await createRoom();
    await createLove(room.id, "Открытая", {
      price: "62000",
      currency: "RUB",
      receivedAt: new Date("2025-03-14T12:00:00Z"),
    });
    await createLove(room.id, "Закрытая у вещи", {
      price: "48000",
      currency: "RUB",
      priceVisibility: "NONE",
      receivedAt: new Date("2024-03-14T12:00:00Z"),
    });

    const items = (await getGuestHall(room.shareSlug))?.items ?? [];
    expect(items[0]?.price).toBe("62000");
    expect(items[0]?.currency).toBe("RUB");
    expect(items[1]).not.toHaveProperty("price");
  });

  it("сумма витрины складывает только видимые гостю цены", async () => {
    const { room } = await createRoom();
    await createLove(room.id, "Открытая", { price: "62000", currency: "RUB" });
    await createLove(room.id, "Закрытая у вещи", {
      price: "48000",
      currency: "RUB",
      priceVisibility: "NONE",
    });

    const hall = await getGuestHall(room.shareSlug);
    expect(hall?.totals).toEqual([{ currency: "RUB", amount: "62000" }]);
  });

  it("тумблер суммы выключен — сумма не считается вовсе", async () => {
    const { user, room } = await createRoom();
    await createLove(room.id, "Открытая", { price: "62000", currency: "RUB" });
    await setHallSettings(user.id, { totalShown: false });

    expect((await getGuestHall(room.shareSlug))?.totals).toEqual([]);
  });
});

describe("getGuestHall — «Кто подарил», «около» и заметка", () => {
  it("ИМЕНИ ДАРИТЕЛЯ ГОСТЮ НЕТ НИ ПРИ КАКОМ ТУМБЛЕРЕ (раунд 19)", async () => {
    const { user, room } = await createRoom();
    await createLove(room.id, "Браслет", {
      giverName: "мама",
      receivedAt: new Date("2025-03-14T12:00:00Z"),
    });

    // Тумблер «Кто подарил» решает, видит ли имя ХОЗЯЙКА на своей витрине.
    // Распространить его на гостей — назвать третьего человека людям, которым
    // он себя не называл. Ключа нет вовсе, ни при включённом, ни при
    // выключенном.
    for (const giverShown of [true, false]) {
      await setHallSettings(user.id, { giverShown });
      const item = (await getGuestHall(room.shareSlug))?.items[0];
      expect(item).not.toHaveProperty("giverName");
      expect(JSON.stringify(item)).not.toContain("мама");
      expect(item?.receivedYear).toBe("2025"); // год про вещь, а не про человека
    }
  });

  it("«Округлять цены» даёт «около» и помечает признаком rounded", async () => {
    const { user, room } = await createRoom();
    await createLove(room.id, "Сумка", { price: "62000", currency: "RUB" });
    await setHallSettings(user.id, { roundPrices: true });

    const hall = await getGuestHall(room.shareSlug);
    expect(hall?.items[0]?.price).toBe("60000");
    expect(hall?.items[0]?.rounded).toBe(true);
    // Сумма считается по ТОЧНЫМ ценам и округляется уже готовой.
    expect(hall?.totals).toEqual([{ currency: "RUB", amount: "60000" }]);
  });

  it("заметка едет гостю очищенной; пробельная — это её отсутствие", async () => {
    const { room } = await createRoom();
    await createLove(room.id, "С заметкой", {
      note: "  Ждала её два года  ",
      receivedAt: new Date("2025-03-14T12:00:00Z"),
    });
    await createLove(room.id, "Без заметки", {
      note: "   ",
      receivedAt: new Date("2024-03-14T12:00:00Z"),
    });

    const items = (await getGuestHall(room.shareSlug))?.items ?? [];
    expect(items[0]?.note).toBe("Ждала её два года");
    expect(items[1]?.note).toBeNull();
  });
});
