// Сокровищница глазами гостя (тикет 93, доска А5 · турны 11b и 11c).
//
// Что здесь защищается:
// - три фильтра на чтении и все на сервере: спрятанная вещь (инвариант №5),
//   вещь выключенной зоны (там же) и вещь, спрятанная глазком (тикет 89);
// - ЦЕНЫ У ГОСТЯ НЕТ ВОВСЕ — ни ключом, ни суммой (инвариант №8 в редакции
//   тикета 124: «цена в сокровищнице не показывается»). Раньше здесь жили
//   четыре положения настройки зала; гостю они больше не открывают ничего;
// - «Кто подарил» гостю не показывается ни при каком тумблере;
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
import { getGuestRoom } from "../src/server/services/guest-room";
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
      // Самое ОТКРЫТОЕ положение настройки цены — нарочно: тесты ниже
      // показывают, что даже оно гостю цены не даёт (тикет 124).
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
    data: { roomId, zone: "jewelry", inHall: true, title, ...overrides },
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
    // ПЕРЕПИСАНО тикетом 124. Здесь стояла невозможная строка «вещь „хочу" с
    // inHall: true» — она проверяла, что витрина фильтрует ещё и по состоянию.
    // Состояний нет, фильтровать по ним нечего. Вместо неё обычная вещь
    // КОМНАТЫ с ценой: на витрину она не попадает, потому что не `inHall`.
    await prisma.item.create({
      data: {
        roomId: room.id,
        zone: "jewelry",
        inHall: false,
        title: "Вещь комнаты с ценой",
        price: "5000",
        currency: "RUB",
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
  });
});

// ПЕРЕПИСАНО ЦЕЛИКОМ (тикет 124). Здесь было четыре теста про настройку цены
// зала: дефолт FRIENDS закрывает, ALL открывает, скрытие у отдельной вещи
// перекрывает открытый зал, сумма складывает только видимое. Всё это описывало
// ДВЕРЬ, которой больше нет: цену вещи сокровищницы гость не видит ни при
// каком положении настройки, а суммы витрины у него нет вовсе. Проверяем
// теперь ровно это — и на самом ОТКРЫТОМ положении, какое только бывает.
describe("getGuestHall — цены в сокровищнице у гостя нет вовсе (инвариант №8)", () => {
  it("даже при hallPriceVisibility=ALL ключей price/currency нет ни у одной вещи", async () => {
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
    expect(items).toHaveLength(2);
    for (const item of items) {
      expect(item).not.toHaveProperty("price");
      expect(item).not.toHaveProperty("currency");
    }
    // И цифр в выдаче нет вовсе: сумма могла бы выдать то, что скрыли ключи.
    expect(JSON.stringify(items)).not.toContain("62000");
    expect(JSON.stringify(items)).not.toContain("48000");
  });

  it("ни одно положение настройки цены гостю витрину не открывает", async () => {
    const { user, room } = await createRoom();
    await createLove(room.id, "Браслет", { price: "62000", currency: "RUB" });

    for (const priceVisibility of ["ALL", "FRIENDS", "ME", "NONE"] as const) {
      await setHallSettings(user.id, { priceVisibility });
      const item = (await getGuestHall(room.shareSlug))?.items[0];
      expect(item).not.toHaveProperty("price");
      expect(item).not.toHaveProperty("currency");
    }
  });

  it("суммы витрины у гостя нет ключом — складывать нечего", async () => {
    const { user, room } = await createRoom();
    await createLove(room.id, "Открытая", { price: "62000", currency: "RUB" });
    await setHallSettings(user.id, { totalShown: true });

    const hall = await getGuestHall(room.shareSlug);
    expect(hall).not.toHaveProperty("totals");
  });

  it("цена ВЕЩИ КОМНАТЫ этим правилом не задета — она у гостя своя", async () => {
    // Инвариант №8 закрыл витрину, а не комнату: там цена живёт по
    // `priceVisibility` вещи и обязана доезжать до гостя, как раньше.
    const { room } = await createRoom();
    await prisma.item.create({
      data: {
        roomId: room.id,
        zone: "jewelry",
        inHall: false,
        title: "Серьги",
        price: "7900",
        currency: "RUB",
        priceVisibility: "ALL",
      },
    });

    const guestRoom = await getGuestRoom(room.shareSlug);
    const item = guestRoom?.itemsByZone.jewelry?.[0];
    expect(item).toBeDefined();
    expect(item).toHaveProperty("price", "7900");
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

  // ПЕРЕПИСАНО (тикет 124): тест проверял «около 60 000» у гостя. Округление
  // осталось, но живёт только на витрине ХОЗЯЙКИ — гостю показывать нечего.
  it("«Округлять цены» гостю ничего не даёт: цены у него нет", async () => {
    const { user, room } = await createRoom();
    await createLove(room.id, "Сумка", { price: "62000", currency: "RUB" });
    await setHallSettings(user.id, { roundPrices: true });

    const item = (await getGuestHall(room.shareSlug))?.items[0];
    expect(item).not.toHaveProperty("price");
    expect(item).not.toHaveProperty("rounded");
    expect(JSON.stringify(item)).not.toContain("60000");
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
