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
    data: { roomId, zone: "jewelry", state: "LOVE", title, ...overrides },
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

describe("listHallItems — витрина хозяйки: LOVE + inHall", () => {
  it("не отдаёт не-inHall и «хочу»; спрятанные (от гостей и глазком) хозяйке — отдаёт", async () => {
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
    const notInHall = await createLove(owner.room.id, "Просто люблю", { inHall: false });
    const wantInHall = await prisma.item.create({
      // Прямой мусор в БД: «хочу» с inHall — витрина всё равно не показывает.
      data: {
        roomId: owner.room.id,
        zone: "bags",
        state: "WANT",
        title: "Хочу с мусорным флагом",
        price: "5000",
        currency: "RUB",
        inHall: true,
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
    expect(ids).not.toContain(wantInHall.id);
    expect(hall.every((item) => item.state === "LOVE")).toBe(true);
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
        state: "WANT",
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

  it("«хочу» глазку не поддаётся (NOT_LOVE); чужая вещь — NOT_FOUND", async () => {
    const owner = await createOwnerWithRoom();
    const stranger = await createOwnerWithRoom();
    const want = await prisma.item.create({
      data: {
        roomId: owner.room.id,
        zone: "bags",
        state: "WANT",
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
  it("LOVE + inHall: вещь и в своей зоне, и на витрине; «хочу» флаг не получает", async () => {
    const owner = await createOwnerWithRoom();

    const treasure = await createItem(owner.user.id, {
      state: "LOVE",
      zone: "jewelry",
      title: "Бабушкина брошь",
      inHall: true,
    });
    expect(treasure.inHall).toBe(true);
    expect(treasure.zone).toBe("jewelry"); // витрина зоне не замена
    expect((await listHallItems(owner.room.id)).map((row) => row.id)).toEqual([treasure.id]);

    // У «хочу» ключа inHall в схеме нет вовсе — Zod отбрасывает его молча.
    const want = await createItem(owner.user.id, {
      state: "WANT",
      zone: "jewelry",
      title: "Хочу с чужим флагом",
      price: "9000",
      currency: "RUB",
      inHall: true,
    });
    expect(want.inHall).toBe(false);
  });

  it("без флага вещь «люблю» на витрину не попадает (дорога из зоны не изменилась)", async () => {
    const owner = await createOwnerWithRoom();
    const plain = await createItem(owner.user.id, {
      state: "LOVE",
      zone: "jewelry",
      title: "Просто моя вещь",
    });
    expect(plain.inHall).toBe(false);
    expect(await listHallItems(owner.room.id)).toEqual([]);
  });
});
