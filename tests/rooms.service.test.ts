// Интеграционные тесты сервиса «Комната» через его публичные функции с
// реальной тест-БД (Postgres из docker compose) — самый высокий шов (spec).
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/server/db";
import {
  createRoomForUser,
  generateShareSlug,
  getRoomByShareSlug,
  getRoomForUser,
} from "../src/server/services/rooms";

const TEST_EMAIL_DOMAIN = "@rooms-service.test";

function testEmail(): string {
  return `user-${randomUUID()}${TEST_EMAIL_DOMAIN}`;
}

async function createTestUser(displayName?: string) {
  return prisma.user.create({ data: { email: testEmail(), displayName } });
}

// Чистим только своих пользователей; комнаты уходят каскадом (onDelete: Cascade).
async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("generateShareSlug", () => {
  it("даёт 6 символов [a-z0-9] — формат короткого кода /r/x7k2m9", () => {
    for (let i = 0; i < 500; i += 1) {
      expect(generateShareSlug()).toMatch(/^[a-z0-9]{6}$/);
    }
  });

  it("уважает длину и практически не повторяется", () => {
    expect(generateShareSlug(10)).toMatch(/^[a-z0-9]{10}$/);
    const slugs = new Set(Array.from({ length: 1000 }, () => generateShareSlug()));
    expect(slugs.size).toBeGreaterThan(990);
  });
});

describe("createRoomForUser", () => {
  it("создаёт комнату с пресетом, набором зон и слагом", async () => {
    const user = await createTestUser();
    const room = await createRoomForUser(user.id, { preset: "cream", zoneSet: "F" });

    expect(room.userId).toBe(user.id);
    expect(room.preset).toBe("cream");
    expect(room.zoneSet).toBe("F");
    expect(room.shareSlug).toMatch(/^[a-z0-9]{6}$/);
  });

  it("идемпотентен: повторный вызов возвращает ту же комнату и не переписывает выбор", async () => {
    const user = await createTestUser();
    const first = await createRoomForUser(user.id, { preset: "loft", zoneSet: "M" });
    const second = await createRoomForUser(user.id, { preset: "cream", zoneSet: "F" });

    expect(second.id).toBe(first.id);
    expect(second.preset).toBe("loft");
    expect(second.zoneSet).toBe("M");
    expect(second.shareSlug).toBe(first.shareSlug);

    const roomsInDb = await prisma.room.findMany({ where: { userId: user.id } });
    expect(roomsInDb).toHaveLength(1);
  });

  it("выдерживает гонку параллельных созданий (P2002 по userId)", async () => {
    const user = await createTestUser();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        createRoomForUser(user.id, { preset: "emerald", zoneSet: "F" }),
      ),
    );

    const ids = new Set(results.map((room) => room.id));
    expect(ids.size).toBe(1);

    const roomsInDb = await prisma.room.findMany({ where: { userId: user.id } });
    expect(roomsInDb).toHaveLength(1);
  });

  it("отклоняет пресет не из rooms.json и кривой zoneSet, ничего не создавая", async () => {
    const user = await createTestUser();

    await expect(createRoomForUser(user.id, { preset: "kitchen", zoneSet: "F" })).rejects.toThrow();
    await expect(createRoomForUser(user.id, { preset: "cream", zoneSet: "X" })).rejects.toThrow();

    expect(await getRoomForUser(user.id)).toBeNull();
  });
});

describe("getRoomByShareSlug", () => {
  it("отдаёт комнату с именем хозяйки и без email (гостю лишнее не течёт)", async () => {
    const user = await createTestUser("Мила");
    const room = await createRoomForUser(user.id, { preset: "warm", zoneSet: "F" });

    const found = await getRoomByShareSlug(room.shareSlug);
    expect(found?.id).toBe(room.id);
    expect(found?.user.displayName).toBe("Мила");
    expect(found ? "email" in found.user : true).toBe(false);
  });

  it("возвращает null для неизвестного слага", async () => {
    expect(await getRoomByShareSlug("nosuch")).toBeNull();
  });
});
