// Полировка 16: уникальность OccasionSummary (roomId, date) — миграция
// occasion_unique_room_date. Закрывает NB тикета 10: гонка cron+клик больше
// не может дать два summary одной даты — проигравший ловит P2002 внутри
// closeOccasion и возвращает существующий summary (created:false, без письма).
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

// Очереди мокируются: Redis не нужен, а «письмо не дублируется под гонкой»
// проверяется по вызовам enqueueOccasionOwnerMail (паттерн tests/occasions).
vi.mock("@/server/queues", () => ({
  enqueueOccasionOwnerMail: vi.fn(async () => true),
  enqueueItemGoneMail: vi.fn(async () => true),
  enqueueImageIngest: vi.fn(async () => true),
}));

import { enqueueOccasionOwnerMail } from "@/server/queues";
import { prisma } from "../src/server/db";
import { closeOccasion } from "../src/server/services/occasions";

const TEST_EMAIL_DOMAIN = "@occasion-unique.test";
const enqueueMock = vi.mocked(enqueueOccasionOwnerMail);

const DAY_MS = 24 * 60 * 60 * 1000;
function utcMidnightDaysAgo(days: number): Date {
  const now = new Date();
  const midnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return new Date(midnight - days * DAY_MS);
}

async function createOwnerWithRoom(occasionDate: Date | null) {
  const user = await prisma.user.create({
    data: { email: `owner-${randomUUID()}${TEST_EMAIL_DOMAIN}`, displayName: "Хозяйка" },
  });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `ou-${randomUUID().slice(0, 12)}`,
      occasionDate,
    },
  });
  return { user, room };
}

// OccasionSummary не связан с Room FK — чистим его явно, остальное каскадом.
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

describe("OccasionSummary: (roomId, date) уникальна — гонка cron+клик не плодит дубль", () => {
  it("схема: второй insert той же (roomId, date) — P2002", async () => {
    const date = utcMidnightDaysAgo(2);
    const owner = await createOwnerWithRoom(date);

    await prisma.occasionSummary.create({ data: { roomId: owner.room.id, date } });
    await expect(
      prisma.occasionSummary.create({ data: { roomId: owner.room.id, date } }),
    ).rejects.toMatchObject({ code: "P2002" });
    // Ошибка именно присмовская, не случайное совпадение формы.
    await prisma.occasionSummary
      .create({ data: { roomId: owner.room.id, date } })
      .catch((error) => {
        expect(error).toBeInstanceOf(Prisma.PrismaClientKnownRequestError);
      });
  });

  it("closeOccasion под настоящей гонкой: проигравший берёт summary победителя, письмо одно", async () => {
    const date = utcMidnightDaysAgo(1);
    const owner = await createOwnerWithRoom(date);

    // Детерминированная гонка: «победитель» (cron) вставляет summary и держит
    // транзакцию открытой, пока «проигравший» (клик) идёт по closeOccasion.
    // READ COMMITTED: его findFirst незакоммиченную строку не видит, его
    // create виснет на уникальном индексе до коммита победителя → P2002 →
    // ветка catch возвращает существующий summary.
    let winnerId = "";
    let loserPromise: ReturnType<typeof closeOccasion> | null = null;
    await prisma.$transaction(async (tx) => {
      const winner = await tx.occasionSummary.create({
        data: { roomId: owner.room.id, date },
      });
      winnerId = winner.id;
      loserPromise = closeOccasion(owner.room.id);
      // Даём проигравшему пройти findFirst (мимо) и повиснуть на create.
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    const loser = await loserPromise!;
    expect(loser?.created).toBe(false);
    expect(loser?.summary.id).toBe(winnerId);

    // В БД ровно один summary этой комнаты, письмо проигравший не ставил
    // (победитель здесь — «голая» вставка, письмо в тесте не ставит никто).
    const rows = await prisma.occasionSummary.findMany({ where: { roomId: owner.room.id } });
    expect(rows).toHaveLength(1);
    const myCalls = enqueueMock.mock.calls.filter(([data]) => data.roomId === owner.room.id);
    expect(myCalls).toEqual([]);
  });
});
