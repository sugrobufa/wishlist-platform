// Тикет 10: витрина зала славы. Выборка listHallItems — фильтр поверх LOVE:
// inHall=true; «хочу» и цены в зале не живут никогда. Плюс интеграция с
// переходами: «Дошло» приводит вещь в зал, toggleHall управляет витриной
// туда и обратно.
//
// Тикет 89 снял отсюда второй фильтр (hiddenFromHall) вместе с его причиной:
// /room/hall — страница ХОЗЯЙКИ, и вещь, спрятанную глазком, она обязана
// видеть — приглушённой, но видеть, иначе снять скрытие нечем. Фильтр
// наблюдателя переехал в dto/hall.hallItemShownToObservers и проверяется там
// же, где строится ответ наблюдателю (tests/connections.test.ts).
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

vi.mock("@/server/queues", () => ({
  enqueueOccasionOwnerMail: vi.fn(async () => true),
  enqueueItemGoneMail: vi.fn(async () => true),
  enqueueImageIngest: vi.fn(async () => true),
}));

import { prisma } from "../src/server/db";
import {
  ItemMutationError,
  createItem,
  listHallItems,
  setHiddenFromHall,
  toggleHall,
} from "../src/server/services/items";
import { hallItemShownToObservers } from "../src/server/dto/hall";
import { closeOccasion, receiveGift } from "../src/server/services/occasions";
import { bookItem } from "../src/server/services/bookings";

const TEST_EMAIL_DOMAIN = "@hall.test";

async function createOwnerWithRoom() {
  const user = await prisma.user.create({
    data: { email: `owner-${randomUUID()}${TEST_EMAIL_DOMAIN}`, displayName: "Хозяйка" },
  });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `hf-${randomUUID().slice(0, 12)}`,
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
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("listHallItems — витрина хозяйки: один фильтр inHall (тикет 124)", () => {
  it("не отдаёт вещи комнаты; спрятанные (от гостей и глазком) хозяйке — отдаёт", async () => {
    const owner = await createOwnerWithRoom();

    const shown = await createLove(owner.room.id, "В витрине", {
      inHall: true,
      receivedAt: new Date("2025-03-14T12:00:00Z"),
      giverName: "Катя",
    });
    const hiddenFromHall = await createLove(owner.room.id, "Спрятана глазком", {
      inHall: true,
      hiddenFromHall: true,
    });
    const notInHall = await createLove(owner.room.id, "Вернулась в комнату", { inHall: false });
    // ПЕРЕПИСАНО (тикет 124): здесь стояла невозможная строка «хочу с inHall»,
    // проверявшая, что витрина фильтрует ещё и по состоянию. Состояний нет —
    // фильтр остался один, и вторая вещь КОМНАТЫ проверяет ровно его.
    const roomItem = await prisma.item.create({
      data: {
        roomId: owner.room.id,
        zone: "bags",
        inHall: false,
        title: "Вещь комнаты с ценой",
        price: "5000",
        currency: "RUB",
      },
    });
    const hiddenFromGuests = await createLove(owner.room.id, "Спрятана от гостей", {
      inHall: true,
      hidden: true,
      receivedAt: new Date("2024-01-01T12:00:00Z"),
    });

    const hall = await listHallItems(owner.room.id);
    const ids = hall.map((item) => item.id);
    expect(ids).toContain(shown.id);
    expect(ids).toContain(hiddenFromGuests.id); // /room/hall — страница хозяйки
    // Тикет 89: спрятанная глазком остаётся у хозяйки — иначе вернуть нечем.
    expect(ids).toContain(hiddenFromHall.id);
    expect(ids).not.toContain(notInHall.id);
    expect(ids).not.toContain(roomItem.id);
    expect(hall.every((item) => item.inHall)).toBe(true);

    // …и ровно она — единственная, кого не покажут наблюдателю.
    expect(hall.filter((item) => !hallItemShownToObservers(item)).map((item) => item.id)).toEqual([
      hiddenFromHall.id,
    ]);

    // Свежее «Дошло» выше: receivedAt по убыванию, без даты — в конец
    // (внутри группы «без даты» — свежесозданные выше).
    const undated = await createLove(owner.room.id, "Без даты", { inHall: true });
    const ordered = await listHallItems(owner.room.id);
    expect(ordered.map((item) => item.id)).toEqual([
      shown.id,
      hiddenFromGuests.id,
      undated.id,
      hiddenFromHall.id,
    ]);
  });

  it("«Дошло» приводит вещь в витрину; toggleHall убирает и возвращает (со сбросом прятанья)", async () => {
    const owner = await createOwnerWithRoom();
    const item = await prisma.item.create({
      data: {
        roomId: owner.room.id,
        zone: "jewelry",
        inHall: false,
        title: "Колье с жемчугом",
        price: "48000",
        currency: "RUB",
      },
    });
    await bookItem({ itemId: item.id, name: "Катя" });
    await closeOccasion(owner.room.id, { manual: true });
    await receiveGift(owner.user.id, item.id);

    expect((await listHallItems(owner.room.id)).map((row) => row.id)).toEqual([item.id]);

    // «Убрать из витрины» на карточке зала — вещь исчезает из выборки.
    await toggleHall(owner.user.id, item.id, false);
    expect(await listHallItems(owner.room.id)).toEqual([]);

    // Вернуть — даже если кто-то успел проставить hiddenFromHall напрямую.
    await prisma.item.update({ where: { id: item.id }, data: { hiddenFromHall: true } });
    await toggleHall(owner.user.id, item.id, true);
    const back = await listHallItems(owner.room.id);
    expect(back.map((row) => row.id)).toEqual([item.id]);
    expect(back[0]?.hiddenFromHall).toBe(false);
  });
});

// ---------- Тикет 89: глазок и прямая дорога на витрину ----------

describe("setHiddenFromHall — глазок: прячет от наблюдателей, не от хозяйки", () => {
  it("скрывает и возвращает; вещь всё это время на витрине хозяйки", async () => {
    const owner = await createOwnerWithRoom();
    const item = await createLove(owner.room.id, "Часы деда", { inHall: true });

    const hidden = await setHiddenFromHall(owner.user.id, item.id, true);
    expect(hidden.hiddenFromHall).toBe(true);
    expect(hidden.inHall).toBe(true); // «скрыть» ≠ «убрать»: вещь не уехала в зону
    expect(hallItemShownToObservers(hidden)).toBe(false);
    expect((await listHallItems(owner.room.id)).map((row) => row.id)).toContain(item.id);

    const shownAgain = await setHiddenFromHall(owner.user.id, item.id, false);
    expect(shownAgain.hiddenFromHall).toBe(false);
    expect(hallItemShownToObservers(shownAgain)).toBe(true);
  });

  // ПЕРЕПИСАНО (тикет 124): отказ назывался NOT_LOVE и означал «глазок бывает
  // только у „люблю"». Теперь он про МЕСТО: прятать с витрины вещь, которой
  // там нет, нечем — NOT_IN_HALL.
  it("вещь комнаты глазку не поддаётся (NOT_IN_HALL); чужая вещь — NOT_FOUND", async () => {
    const owner = await createOwnerWithRoom();
    const stranger = await createOwnerWithRoom();
    const want = await prisma.item.create({
      data: {
        roomId: owner.room.id,
        zone: "bags",
        inHall: false,
        title: "Сумка",
        price: "12000",
        currency: "RUB",
      },
    });
    const mine = await createLove(owner.room.id, "Моё кольцо", { inHall: true });

    await expect(setHiddenFromHall(owner.user.id, want.id, true)).rejects.toThrow(
      ItemMutationError,
    );
    await expect(setHiddenFromHall(stranger.user.id, mine.id, true)).rejects.toThrow(
      ItemMutationError,
    );
    // Ни одна отказная попытка колонку не тронула.
    expect(
      (await prisma.item.findUniqueOrThrow({ where: { id: mine.id } })).hiddenFromHall,
    ).toBe(false);
  });
});

describe("createItem с витрины — вещь встаёт в сокровищницу сразу (тикет 89)", () => {
  it("inHall: true — вещь и в своей зоне, и на витрине; цены у неё нет", async () => {
    const owner = await createOwnerWithRoom();

    const treasure = await createItem(owner.user.id, {
      inHall: true,
      zone: "jewelry",
      title: "Бабушкина брошь",
    });
    expect(treasure.inHall).toBe(true);
    expect(treasure.zone).toBe("jewelry"); // витрина зоне не замена
    expect((await listHallItems(owner.room.id)).map((row) => row.id)).toEqual([treasure.id]);

    // ПЕРЕПИСАНО (тикет 124): вторая половина теста проверяла, что «хочу» не
    // получает флаг витрины. Дискриминатор теперь сам `inHall`, и вещь
    // комнаты его не получает по построению — ключей витрины у её формы нет.
    const roomItem = await createItem(owner.user.id, {
      zone: "jewelry",
      title: "Кольцо",
      price: "9000",
      currency: "RUB",
      giverName: "мама",
    });
    expect(roomItem.inHall).toBe(false);
    expect(roomItem.giverName).toBeNull(); // ключ чужой формы Zod отбросил
  });

  // ПЕРЕПИСАНО (тикет 124): раньше `inHall` был необязательным флагом формы
  // LOVE, и без него вещь оставалась в зоне. Теперь это ДИСКРИМИНАТОР места:
  // без него вещь идёт в комнату, а не «в зону вещью „люблю"».
  it("без флага вещь встаёт в КОМНАТУ, а не на витрину", async () => {
    const owner = await createOwnerWithRoom();
    const plain = await createItem(owner.user.id, {
      zone: "jewelry",
      title: "Просто желание",
      price: "1500",
      currency: "RUB",
    });
    expect(plain.inHall).toBe(false);
    expect(await listHallItems(owner.room.id)).toEqual([]);
  });
});
