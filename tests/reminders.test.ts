// Планировщик напоминаний (тикет 12, src/worker/reminders.ts) — реальная
// тест-БД, очередь подменена швом enqueue. Ключевое: окно ровно 3 суток
// (границы под тестом), письма только броням с email, jobId детерминирован
// (повторный тик не рождает второго письма — дедуп BullMQ по jobId),
// комнаты без даты не участвуют.
//
// Тик сканирует ВСЮ БД, поэтому все проверки фильтруются своими bookingId —
// параллельные тестовые файлы не шумят в ассертах.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/server/db";
import type { ReminderGuestMailJobData } from "../src/server/queues";
import { reminderGuestJobId } from "../src/server/queues";
import { processReminderTick, REMINDER_WINDOW_DAYS } from "../src/worker/reminders";

const TEST_EMAIL_DOMAIN = "@reminders.test";
const NOW = new Date("2026-08-04T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function daysFromNow(days: number): Date {
  return new Date(NOW.getTime() + days * DAY_MS);
}

async function createCase(options: {
  occasionDate: Date | null;
  guestEmail?: string | null;
  displayName?: string | null;
  itemTitle?: string;
}) {
  const user = await prisma.user.create({
    data: {
      email: `owner-${randomUUID()}${TEST_EMAIL_DOMAIN}`,
      displayName: options.displayName === undefined ? "Мила" : options.displayName,
    },
  });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `rt-${randomUUID().slice(0, 12)}`,
      occasionDate: options.occasionDate,
    },
  });
  const item = await prisma.item.create({
    data: {
      roomId: room.id,
      zone: "jewelry",
      state: "WANT",
      title: options.itemTitle ?? `Вещь-${randomUUID().slice(0, 8)}`,
      price: "5000",
      currency: "RUB",
    },
  });
  const booking = await prisma.booking.create({
    data: {
      itemId: item.id,
      guestName: "Паша",
      guestEmail:
        options.guestEmail === undefined
          ? `guest-${randomUUID()}${TEST_EMAIL_DOMAIN}`
          : options.guestEmail,
      cancelToken: randomUUID(),
    },
  });
  return { user, room, item, booking };
}

function enqueueMock(result = true) {
  return vi.fn<(data: ReminderGuestMailJobData) => Promise<boolean>>(async () => result);
}

/** Только вызовы по своим броням — параллельные тесты не шумят. */
function callsFor(
  mock: ReturnType<typeof enqueueMock>,
  bookingIds: string[],
): ReminderGuestMailJobData[] {
  return mock.mock.calls.map(([data]) => data).filter((data) => bookingIds.includes(data.bookingId));
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("processReminderTick — окно ровно 3 суток", () => {
  it("−3д ровно и внутри окна — входят; −4д, день праздника, после и без даты — нет", async () => {
    const exactly3d = await createCase({ occasionDate: daysFromNow(REMINDER_WINDOW_DAYS) });
    const inside = await createCase({ occasionDate: daysFromNow(1) });
    const tooEarly = await createCase({ occasionDate: daysFromNow(4) });
    const today = await createCase({ occasionDate: NOW });
    const passed = await createCase({ occasionDate: daysFromNow(-1) });
    const noDate = await createCase({ occasionDate: null });

    const enqueue = enqueueMock();
    const result = await processReminderTick(NOW, { enqueue });

    const mine = callsFor(enqueue, [
      exactly3d.booking.id,
      inside.booking.id,
      tooEarly.booking.id,
      today.booking.id,
      passed.booking.id,
      noDate.booking.id,
    ]);
    expect(mine.map((data) => data.bookingId).sort()).toEqual(
      [exactly3d.booking.id, inside.booking.id].sort(),
    );

    expect(result.enqueued).toContain(
      reminderGuestJobId(exactly3d.booking.id, daysFromNow(REMINDER_WINDOW_DAYS)),
    );
    expect(result.enqueued).toContain(reminderGuestJobId(inside.booking.id, daysFromNow(1)));
    for (const excluded of [tooEarly, today, passed]) {
      const date = excluded.room.occasionDate ?? NOW;
      expect(result.enqueued).not.toContain(reminderGuestJobId(excluded.booking.id, date));
    }
  });

  it("гость без email — молча пропущен (ни письма, ни failed)", async () => {
    const withEmail = await createCase({ occasionDate: daysFromNow(2) });
    const noEmail = await createCase({ occasionDate: daysFromNow(2), guestEmail: null });

    const enqueue = enqueueMock();
    const result = await processReminderTick(NOW, { enqueue });

    const mine = callsFor(enqueue, [withEmail.booking.id, noEmail.booking.id]);
    expect(mine.map((data) => data.bookingId)).toEqual([withEmail.booking.id]);
    const noEmailJobId = reminderGuestJobId(noEmail.booking.id, daysFromNow(2));
    expect(result.enqueued).not.toContain(noEmailJobId);
    expect(result.failed).not.toContain(noEmailJobId);
  });
});

describe("processReminderTick — идемпотентность через детерминированный jobId", () => {
  it("два тика (в т.ч. часом позже) дают ОДИН И ТОТ ЖЕ jobId — дубль давит BullMQ", async () => {
    const occasionDate = daysFromNow(2);
    const { booking } = await createCase({ occasionDate });
    const expectedJobId = `reminder-${booking.id}-20260806`; // yyyymmdd UTC-суток даты

    const first = enqueueMock();
    const second = enqueueMock();
    const resultA = await processReminderTick(NOW, { enqueue: first });
    const resultB = await processReminderTick(new Date(NOW.getTime() + 60 * 60 * 1000), {
      enqueue: second,
    });

    expect(reminderGuestJobId(booking.id, occasionDate)).toBe(expectedJobId);
    expect(resultA.enqueued).toContain(expectedJobId);
    expect(resultB.enqueued).toContain(expectedJobId);
    // и payload обоих тиков идентичен — add с тем же jobId будет no-op
    expect(callsFor(first, [booking.id])).toEqual(callsFor(second, [booking.id]));
  });

  it("payload самодостаточен: имя, вещь, дата ISO, слаг комнаты, имя хозяйки", async () => {
    const occasionDate = daysFromNow(3);
    const { room, item, booking } = await createCase({
      occasionDate,
      itemTitle: "Серьги-каффы",
      displayName: "Мила",
    });

    const enqueue = enqueueMock();
    await processReminderTick(NOW, { enqueue });

    const [data] = callsFor(enqueue, [booking.id]);
    expect(data).toEqual({
      bookingId: booking.id,
      email: booking.guestEmail,
      guestName: "Паша",
      ownerName: "Мила",
      occasionDate: occasionDate.toISOString(),
      itemTitle: item.title,
      roomSlug: room.shareSlug,
    });
  });

  it("очередь недоступна (enqueue → false) — jobId уходит в failed, тик не падает", async () => {
    const occasionDate = daysFromNow(1);
    const { booking } = await createCase({ occasionDate });

    const enqueue = enqueueMock(false);
    const result = await processReminderTick(NOW, { enqueue });

    const jobId = reminderGuestJobId(booking.id, occasionDate);
    expect(result.failed).toContain(jobId);
    expect(result.enqueued).not.toContain(jobId);
  });
});
