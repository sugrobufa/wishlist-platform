// «Что чаще всего хочется» — третий шаг онбординга (тикет 113, доска 34b).
//
// Главное, что здесь защищается, — чего ответ НЕ делает. Доска особо
// оговаривает: полки не переставляются и не выключаются. Набор зон решает
// шаг 2, а прямоугольники зон — инвариант контракта; если ответ про желания
// однажды начнёт трогать комнату, сломается и то и другое разом.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/server/db";
import { createRoomForUser } from "../src/server/services/rooms";
import { rooms as roomPresets } from "../src/config/design";

const TEST_EMAIL_DOMAIN = "@onboarding-wants.test";

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

async function freshUser() {
  return prisma.user.create({ data: { email: `user-${randomUUID()}${TEST_EMAIL_DOMAIN}` } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("ответ «что хочется» (тикет 113)", () => {
  it("сохраняется как ключи зон и не трогает набор зон комнаты", async () => {
    const user = await freshUser();
    const room = await createRoomForUser(user.id, {
      preset: "cream",
      zoneSet: "F",
      wants: "jewelry,perfume,books",
    });
    expect(room.wants).toEqual(["jewelry", "perfume", "books"]);
    // Комната от ответа не изменилась: зоны не выключены, пресет тот же.
    expect(room.zonesOff).toEqual([]);
    expect(room.preset).toBe("cream");
  });

  it("чужие ключи и мусор молча отбрасываются, больше четырёх не берём", async () => {
    const user = await freshUser();
    const room = await createRoomForUser(user.id, {
      preset: "cream",
      zoneSet: "F",
      // gaming в женском интерьере не существует; «"><script» — просто мусор.
      wants: 'jewelry, gaming ,perfume,"><script,books,flowers,home,music',
    });
    expect(room.wants).toHaveLength(4);
    expect(room.wants).not.toContain("gaming");
    const cream = roomPresets.find((preset) => preset.id === "cream");
    const keys = new Set((cream?.zones ?? []).map((zone) => zone.key));
    for (const key of room.wants) expect(keys.has(key), key).toBe(true);
  });

  it("пропуск шага — законный ответ: пустой список, комната создаётся", async () => {
    const user = await freshUser();
    const room = await createRoomForUser(user.id, { preset: "loft", zoneSet: "M", wants: "" });
    expect(room.wants).toEqual([]);
    expect(room.id).toBeTruthy();
  });

  it("ответа нет вовсе (старый вызов) — комната всё равно создаётся", async () => {
    const user = await freshUser();
    const room = await createRoomForUser(user.id, { preset: "cream", zoneSet: "F" });
    expect(room.wants).toEqual([]);
  });
});
