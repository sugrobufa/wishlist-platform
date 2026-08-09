// Лента «Что происходит» — ЗАПИСЬ событий (тикет 114, доска 34c).
//
// Показ ленты ждёт трёх ответов дизайна (глубина памяти, склейка событий
// одного друга за день, показывать ли её новичку — задание 19). Запись ждать
// не может: событие — это факт «когда», и задним числом его не восстановить.
//
// Главное, что здесь под замком: в ленту НЕ ПОПАДАЕТ ПОДАРОЧНЫЙ СЛОЙ. Ни
// брони, ни складчины, ни «что подарили» — ни в каком виде и ни для кого.
// Это правило доски 34c, и оно шире инварианта №1: тот закрывает брони от
// хозяйки, а здесь их нет вообще ни у кого.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/queues", () => ({
  enqueueOccasionOwnerMail: vi.fn(async () => true),
  enqueueItemGoneMail: vi.fn(async () => true),
  enqueueImageIngest: vi.fn(async () => true),
}));

import { prisma } from "../src/server/db";
import { createItem } from "../src/server/services/items";
import { bookItem } from "../src/server/services/bookings";
import { changeRoomPreset, setHallSettings } from "../src/server/services/rooms";

const TEST_EMAIL_DOMAIN = "@room-events.test";

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

async function ownerWithRoom(preset = "cream") {
  const user = await prisma.user.create({
    data: { email: `user-${randomUUID()}${TEST_EMAIL_DOMAIN}` },
  });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset,
      zoneSet: "F",
      shareSlug: `ev-${randomUUID().slice(0, 12)}`,
    },
  });
  return { user, room };
}

const kindsOf = async (roomId: string) =>
  (
    await prisma.roomEvent.findMany({ where: { roomId }, orderBy: { createdAt: "asc" } })
  ).map((event) => event.kind);

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("запись событий комнаты (тикет 114)", () => {
  it("первая вещь зоны открывает полку, вторая — только «добавлена»", async () => {
    const { user, room } = await ownerWithRoom();
    await createItem(user.id, { zone: "jewelry", inHall: false, title: "Серьги", price: "5000", currency: "RUB" });
    expect(await kindsOf(room.id)).toEqual(["ITEMS_ADDED", "SHELF_OPENED"]);

    await createItem(user.id, { zone: "jewelry", inHall: false, title: "Кольцо", price: "3000", currency: "RUB" });
    expect(await kindsOf(room.id)).toEqual(["ITEMS_ADDED", "SHELF_OPENED", "ITEMS_ADDED"]);

    // Другая зона — своя полка открывается заново.
    await createItem(user.id, { zone: "books", inHall: true, title: "Сборник" });
    expect((await kindsOf(room.id)).filter((kind) => kind === "SHELF_OPENED")).toHaveLength(2);
  });

  it("смена интерьера — событие; сохранение того же интерьера — нет", async () => {
    const { user, room } = await ownerWithRoom("cream");
    await changeRoomPreset(user.id, "warm");
    expect(await kindsOf(room.id)).toContain("ROOM_CHANGED");

    const before = (await kindsOf(room.id)).length;
    await changeRoomPreset(user.id, "warm");
    expect(await kindsOf(room.id)).toHaveLength(before);
  });

  it("сокровищница: событие ставит ДВЕРЬ, а не цена (тикет 116)", async () => {
    const { user, room } = await ownerWithRoom();

    // ЦЕНА событием не является вовсе. Пока настройки «кто входит» не
    // существовало, повод брали отсюда — это было неверно дважды: цена
    // подарков и открытая витрина разные события, а положение FRIENDS у цены
    // читается у нас ЗАКРЫТО, то есть «теперь открыта» появлялось там, где
    // гостю не открывалось ничего.
    await setHallSettings(user.id, { priceVisibility: "ALL" });
    expect(await kindsOf(room.id)).not.toContain("TREASURY_OPENED");

    // Дефолт двери — ALL; закрытие новостью не является.
    await setHallSettings(user.id, { visibility: "NONE" });
    expect(await kindsOf(room.id)).not.toContain("TREASURY_OPENED");

    // Отперли — вот это новость.
    await setHallSettings(user.id, { visibility: "ALL" });
    expect(await kindsOf(room.id)).toContain("TREASURY_OPENED");

    // Повтор того же положения событием не считается.
    const before = (await kindsOf(room.id)).length;
    await setHallSettings(user.id, { visibility: "ALL" });
    expect(await kindsOf(room.id)).toHaveLength(before);
  });

  it("сокровищница: «только взаимным» из запертой — тоже открытие", async () => {
    const { user, room } = await ownerWithRoom();

    await setHallSettings(user.id, { visibility: "NONE" });
    await setHallSettings(user.id, { visibility: "MUTUAL" });

    // Дверь отперта не для всех, но отперта: для взаимных друзей витрины
    // раньше не было, а теперь есть — им и рассказываем. Кому она не открыта,
    // тот строки не увидит: это решает лента при чтении (friends-feed).
    expect(await kindsOf(room.id)).toContain("TREASURY_OPENED");
  });

  it("ПОДАРОЧНЫЙ СЛОЙ в ленту не попадает: бронь события не создаёт", async () => {
    const { user, room } = await ownerWithRoom();
    const item = await createItem(user.id, { zone: "jewelry", inHall: false, title: "Колье", price: "9000", currency: "RUB" });
    const before = await kindsOf(room.id);

    await bookItem({ itemId: item.id, name: "Гость" });

    // Ни одного нового события: бронь — не событие живой комнаты.
    expect(await kindsOf(room.id)).toEqual(before);
    // И ни в одном payload нет следов брони.
    const events = await prisma.roomEvent.findMany({ where: { roomId: room.id } });
    expect(JSON.stringify(events)).not.toMatch(/Гость|booking|BOOK/i);
  });

  it("в событиях нет ни имён, ни вещей — только ключ зоны и id интерьера", async () => {
    const { user, room } = await ownerWithRoom();
    await createItem(user.id, { zone: "jewelry", inHall: false, title: "Секретное колье", price: "9000", currency: "RUB" });
    await changeRoomPreset(user.id, "warm");

    const events = await prisma.roomEvent.findMany({ where: { roomId: room.id } });
    const dump = JSON.stringify(events.map((event) => event.payload));
    expect(dump).not.toContain("Секретное колье");
    expect(dump).toContain("jewelry");
    expect(dump).toContain("warm");
  });
});
