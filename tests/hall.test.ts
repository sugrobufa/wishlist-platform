// Тикет 10: витрина зала славы. Выборка listHallItems — ровно два фильтра
// поверх LOVE: inHall=true и hiddenFromHall=false; «хочу» и цены в зале не
// живут никогда. Плюс интеграция с переходами: «Дошло» приводит вещь в зал,
// toggleHall управляет витриной туда и обратно.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

vi.mock("@/server/queues", () => ({
  enqueueOccasionOwnerMail: vi.fn(async () => true),
  enqueueImageIngest: vi.fn(async () => true),
}));

import { prisma } from "../src/server/db";
import { listHallItems, toggleHall } from "../src/server/services/items";
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

describe("listHallItems — витрина: LOVE + inHall и НИКОГДА hiddenFromHall", () => {
  it("не отдаёт hiddenFromHall, не-inHall и «хочу»; спрятанную от гостей хозяйке — отдаёт", async () => {
    const owner = await createOwnerWithRoom();

    const shown = await createLove(owner.room.id, "В витрине", {
      inHall: true,
      receivedAt: new Date("2025-03-14T12:00:00Z"),
      giverName: "Катя",
    });
    const hiddenFromHall = await createLove(owner.room.id, "Спрятана из витрины", {
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
    expect(ids).not.toContain(hiddenFromHall.id);
    expect(ids).not.toContain(notInHall.id);
    expect(ids).not.toContain(wantInHall.id);
    expect(hall.every((item) => item.state === "LOVE")).toBe(true);
    expect(hall.every((item) => item.inHall && !item.hiddenFromHall)).toBe(true);

    // Свежее «Дошло» выше: receivedAt по убыванию, без даты — в конец.
    const undated = await createLove(owner.room.id, "Без даты", { inHall: true });
    const ordered = await listHallItems(owner.room.id);
    expect(ordered.map((item) => item.id)).toEqual([shown.id, hiddenFromGuests.id, undated.id]);
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
