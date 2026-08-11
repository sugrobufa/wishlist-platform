// ПОЛЕ `Room.wants` — МЁРТВОЕ, НО ЦЕЛОЕ (тикеты 189 и 191).
//
// Вопрос «что чаще всего хочется» (тикет 113, доска 34b) переезжал дважды и на
// втором переезде кончился. Сперва он был четвёртым шагом онбординга, потом
// чипами при первом открытии «начни с готового» (тикет 134, письмо 33 · турн
// 40b), а 11.08.2026 владелец снял его целиком: «ничего не происходит и
// непонятно, на что это влияет». Он был прав по механизму — ответ красил ровно
// две вещи, и обе невидимы в момент ответа: порядок наполнения стартовым
// набором (набор выпилен тикетом 191) и порядок зон в форме добавления (теперь
// считается ПО ДЕЛАМ, тикет 189).
//
// ЧТО ЗДЕСЬ ОСТАЛОСЬ И ЗАЧЕМ. Поле в базе живо: миграция удаления необратима, а
// польза от неё нулевая — данные живых комнат остаются данными их хозяек
// (решение тикета 189, пункт 3). Живы и оба пути записи, `createRoomForUser` и
// `setRoomWants`; вопроса, который бы их звал, в продукте больше нет.
// Проверяется здесь ровно то, чем поле было опасно: **ответ НЕ ТРОГАЕТ
// КОМНАТУ** — полки не переставляются и не выключаются. Набор зон решает шаг 2
// онбординга, а прямоугольники зон — инвариант контракта; если мёртвое поле
// однажды оживёт и начнёт трогать комнату, сломается и то и другое разом.
//
// Чипов вопроса (`starterPackWants`) здесь больше нет: функция удалена вместе с
// сервисом набора. Сторож её невозвращения — tests/no-bulk-fill.test.ts.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "../src/server/db";
import { createRoomForUser, setRoomWants } from "../src/server/services/rooms";
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

  it("ответа нет вовсе (онбординг его больше не приносит) — комната создаётся", async () => {
    const user = await freshUser();
    const room = await createRoomForUser(user.id, { preset: "cream", zoneSet: "F" });
    expect(room.wants).toEqual([]);
  });
});

describe("второй путь записи — `setRoomWants` (спрашивать его больше некому)", () => {
  async function ownerWithRoom(preset = "cream") {
    const user = await freshUser();
    const room = await createRoomForUser(user.id, { preset, zoneSet: "F" });
    return { user, room };
  }

  it("пишется ключами зон и НЕ трогает комнату", async () => {
    const { user } = await ownerWithRoom();
    const room = await setRoomWants(user.id, ["jewelry", "perfume", "books"]);
    expect(room.wants).toEqual(["jewelry", "perfume", "books"]);
    // Ровно то же, что и на шаге онбординга: полки не выключены, пресет тот же.
    expect(room.zonesOff).toEqual([]);
    expect(room.preset).toBe("cream");
  });

  it("чужие ключи и мусор молча отбрасываются, больше четырёх не берём", async () => {
    const { user } = await ownerWithRoom();
    const room = await setRoomWants(user.id, [
      "jewelry",
      " gaming ",
      "perfume",
      '"><script',
      "books",
      "flowers",
      "home",
    ]);
    expect(room.wants).toHaveLength(4);
    expect(room.wants).not.toContain("gaming");
    const cream = roomPresets.find((preset) => preset.id === "cream");
    const keys = new Set((cream?.zones ?? []).map((zone) => zone.key));
    for (const key of room.wants) expect(keys.has(key), key).toBe(true);
  });

  it("пустой список — законный ответ и стирает прежний", async () => {
    const { user } = await ownerWithRoom();
    await setRoomWants(user.id, ["jewelry"]);
    expect((await setRoomWants(user.id, [])).wants).toEqual([]);
  });

  it("записанный ответ лежит в комнате и никем не читается", async () => {
    // Данные не стираем (тикет 189, пункт 3): что человек однажды ответил, то в
    // его комнате и осталось. Читателя у поля больше нет — порядок зон в форме
    // добавления считается по делам (tests/zone-order-by-deeds.test.ts).
    const { user, room } = await ownerWithRoom();
    await setRoomWants(user.id, ["jewelry", "perfume"]);
    const saved = await prisma.room.findUniqueOrThrow({ where: { id: room.id } });
    expect(saved.wants).toEqual(["jewelry", "perfume"]);
    expect(saved.zonesOff).toEqual([]);
    expect(saved.preset).toBe("cream");
  });
});
