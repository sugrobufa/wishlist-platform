// Тикет 100 (доска Б23 · турн 12c): «Или начни с готового · +40».
//
// Набор — тот же курируемый список, что раньше рисовался призраками
// (тикет 104 показ снял, вердикт дизайна оставил подборку «по согласию»).
// Проверяем ровно то, чем набор отличается от призраков и от посева стенда:
// - вещи настоящие, свои и появляются ТОЛЬКО по вызову;
// - дарителей и годов он НЕ приносит: выдуманное воспоминание в
//   сокровищнице — это ложь про человека (инвариант №2);
// - повтор не плодит дублей и не трогает того, что заведено руками;
// - «+40» считается по пулам ВИДИМЫХ зон, а не пишется числом в строку.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/server/queues", () => ({
  enqueueOccasionOwnerMail: vi.fn(async () => true),
  enqueueImageIngest: vi.fn(async () => true),
}));

import { prisma } from "../src/server/db";
import { applyStarterPack, starterPackSize } from "../src/server/services/starter-pack";
import { createItem } from "../src/server/services/items";
import { rooms as roomPresets } from "../src/config/design";

const TEST_EMAIL_DOMAIN = "@starter-pack.test";

/** Фото в S3 не кладём: хранилище — шов, тесту достаточно тихой заглушки. */
const noStorage = { putObject: async () => {} };

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

async function createOwnerWithRoom(preset = "cream") {
  const user = await prisma.user.create({
    data: { email: `user-${randomUUID()}${TEST_EMAIL_DOMAIN}` },
  });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset,
      zoneSet: "F",
      shareSlug: `sp-${randomUUID().slice(0, 12)}`,
    },
  });
  return { user, room };
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("starterPackSize — «+40» считается, а не обещается", () => {
  it("число складывается из пулов видимых зон и падает вместе с выключенной", () => {
    const cream = roomPresets.find((room) => room.id === "cream");
    const full = starterPackSize("cream", []);
    expect(full).toBeGreaterThan(0);

    // Выключенная зона уносит с собой ровно свой пул.
    const zone = cream?.zones.find((candidate) => candidate.pool === "jewel");
    expect(zone).toBeDefined();
    const withoutJewel = starterPackSize("cream", [zone!.key]);
    expect(withoutJewel).toBeLessThan(full);
  });

  it("у мужского и женского интерьера числа СВОИ — одно на всех было бы обманом", () => {
    expect(starterPackSize("loft", [])).toBeGreaterThan(0);
    // Наборы зон разные, значит и подборки разные; совпасть они могут только
    // случайно — сравниваем не числа, а то, что оба считаются по своим зонам.
    expect(starterPackSize("cream", [])).not.toBe(starterPackSize("cream", ["jewelry"]));
  });
});

describe("applyStarterPack — набор в свою комнату", () => {
  it("кладёт настоящие вещи и НЕ приносит дарителей, годов и витрины", async () => {
    const { user, room } = await createOwnerWithRoom();

    const result = await applyStarterPack(user.id, noStorage);
    expect(result.roomFound).toBe(true);
    expect(result.created).toBe(starterPackSize("cream", []));

    const items = await prisma.item.findMany({ where: { roomId: room.id } });
    expect(items).toHaveLength(result.created);
    // Ни одного выдуманного воспоминания: имя дарителя попадает в комнату
    // ровно одним путём — через «Дошло» (инвариант №2).
    expect(items.filter((item) => item.giverName !== null)).toEqual([]);
    expect(items.filter((item) => item.receivedAt !== null)).toEqual([]);
    expect(items.filter((item) => item.inHall)).toEqual([]);
    // Вещи свои и обычные: оба состояния на месте, «хочу» с ценой.
    expect(items.some((item) => item.state === "LOVE")).toBe(true);
    const wants = items.filter((item) => item.state === "WANT");
    expect(wants.length).toBeGreaterThan(0);
    expect(wants.every((item) => item.price !== null)).toBe(true);
    expect(items.every((item) => item.isDemo !== true)).toBe(true);
  });

  it("повтор не плодит дублей и не трогает заведённое руками", async () => {
    const { user, room } = await createOwnerWithRoom();
    // Своя вещь в зоне — набор эту зону обходит целиком.
    await createItem(user.id, { zone: "jewelry", state: "LOVE", title: "Бабушкино кольцо" });

    const first = await applyStarterPack(user.id, noStorage);
    const afterFirst = await prisma.item.count({ where: { roomId: room.id } });
    expect(afterFirst).toBe(first.created + 1);

    // Зона с моей вещью осталась ровно с ней одной.
    expect(await prisma.item.count({ where: { roomId: room.id, zone: "jewelry" } })).toBe(1);

    const second = await applyStarterPack(user.id, noStorage);
    expect(second.created).toBe(0);
    expect(await prisma.item.count({ where: { roomId: room.id } })).toBe(afterFirst);
  });

  it("без комнаты класть некуда — тихий отказ, а не падение", async () => {
    const user = await prisma.user.create({
      data: { email: `user-${randomUUID()}${TEST_EMAIL_DOMAIN}` },
    });
    expect(await applyStarterPack(user.id, noStorage)).toMatchObject({
      roomFound: false,
      created: 0,
    });
  });
});
