// «Что чаще всего хочется» (тикет 113, доска 34b).
//
// ВОПРОС ПЕРЕЕХАЛ (тикет 134, письмо 33 · турн 40b): он больше не шаг
// онбординга, а чипы при первом открытии «начни с готового». Сменилось место —
// не смысл: состав вопроса, предел «3–4» и главное правило те же, и потому
// проверки здесь те же. Первый describe — путь создания комнаты (посев стенда
// и тесты), второй — новый путь, `setRoomWants` из чипов набора.
//
// Главное, что здесь защищается, — чего ответ НЕ делает. Доска особо
// оговаривает: полки не переставляются и не выключаются. Набор зон решает
// шаг 2, а прямоугольники зон — инвариант контракта; если ответ про желания
// однажды начнёт трогать комнату, сломается и то и другое разом.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Сервис набора тянет за собой создание вещей, а то — очереди (фото в S3).
// Тесту очередей не нужно: он спрашивает только чипы вопроса.
vi.mock("@/server/queues", () => ({
  enqueueOccasionOwnerMail: vi.fn(async () => true),
  enqueueItemGoneMail: vi.fn(async () => true),
  enqueueImageIngest: vi.fn(async () => true),
}));

import { prisma } from "../src/server/db";
import { createRoomForUser, setRoomWants } from "../src/server/services/rooms";
import { starterPackWants } from "../src/server/services/starter-pack";
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

describe("ответ из «начни с готового» — новое место вопроса (тикет 134)", () => {
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

  it("чипы — зоны своей комнаты, без «Что угодно» и «Просто денег»", async () => {
    const { user } = await ownerWithRoom();
    const question = await starterPackWants(user.id);
    expect(question).not.toBeNull();
    const keys = (question?.chips ?? []).map((chip) => chip.key);
    expect(keys.length).toBeGreaterThan(0);
    // Обе зоны как ответ на «что хочется» не значат ничего.
    expect(keys).not.toContain("anything");
    expect(keys).not.toContain("money");
    // Подписи — те же слова, что человек увидит в комнате.
    expect((question?.chips ?? []).every((chip) => chip.label.trim() !== "")).toBe(true);
    // Уже сохранённый ответ приезжает вместе с чипами — вопрос не спросит
    // заново то, на что уже ответили.
    await setRoomWants(user.id, ["jewelry"]);
    expect((await starterPackWants(user.id))?.wants).toEqual(["jewelry"]);
  });

  it("комнаты нет — вопроса нет (и ничего не падает)", async () => {
    const user = await freshUser();
    expect(await starterPackWants(user.id)).toBeNull();
  });
});
