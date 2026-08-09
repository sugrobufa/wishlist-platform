// Тикет 99 (доска Б27 · турн 25c): пустая зона — три места и «убрать полку».
//
// Доска объясняет, зачем это отдельное состояние: «пустая полка не должна
// выглядеть как невыполненное задание». Отсюда два проверяемых обещания:
// - номер полки считается по ВИДИМЫМ зонам (выключенная не оставляет дыру);
// - «убрать полку» ничего не удаляет: вещи переживают выключение и
//   возвращаются вместе с зоной. Кнопка стоит рядом со словом «убрать», и
//   цена ошибки здесь — чужие вещи.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/server/db";
import { setZoneOff } from "../src/server/services/rooms";
import { listZoneItems } from "../src/server/services/items";
import { zonePosition } from "../src/components/scene/zones";

const TEST_EMAIL_DOMAIN = "@empty-zone.test";

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

async function createOwnerWithRoom() {
  const user = await prisma.user.create({
    data: { email: `user-${randomUUID()}${TEST_EMAIL_DOMAIN}` },
  });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `ez-${randomUUID().slice(0, 12)}`,
    },
  });
  return { user, room };
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("zonePosition — «полка 02 из 13»", () => {
  const zones = [{ key: "a" }, { key: "b" }, { key: "c" }, { key: "d" }];

  it("считает по видимым: выключенная зона не оставляет дыру в нумерации", () => {
    expect(zonePosition(zones, [], "c")).toEqual({ index: 3, total: 4 });
    // Выключили вторую — третья становится второй, а всего их три.
    expect(zonePosition(zones, ["b"], "c")).toEqual({ index: 2, total: 3 });
  });

  it("выключенной и чужой зоны в нумерации нет вовсе", () => {
    expect(zonePosition(zones, ["b"], "b")).toBeNull();
    expect(zonePosition(zones, [], "gaming")).toBeNull();
  });
});

describe("«убрать полку из комнаты» — вещи остаются", () => {
  it("выключение зоны не трогает вещи, включение возвращает их на место", async () => {
    const { user, room } = await createOwnerWithRoom();
    const item = await prisma.item.create({
      data: { roomId: room.id, zone: "flowers", state: "WANT", title: "Пионы" },
    });

    const off = await setZoneOff(user.id, "flowers", true);
    expect(off.zonesOff).toContain("flowers");

    // Вещь на месте: выключение зоны — про мебель, а не про содержимое.
    const kept = await prisma.item.findUnique({ where: { id: item.id } });
    expect(kept).toMatchObject({ zone: "flowers", state: "WANT" });

    const back = await setZoneOff(user.id, "flowers", false);
    expect(back.zonesOff).not.toContain("flowers");
    expect(await listZoneItems(room.id, "flowers")).toHaveLength(1);
  });
});
