// Дата праздника из онбординга (тикет 43): третий шаг пишет `Room.occasionDate`
// тем же сервисом, что и настройки, и от этой записи просыпаются напоминания.
// Тест держит два обещания тикета:
//
// 1. КАЛЕНДАРНАЯ ДАТА НЕ СЪЕЗЖАЕТ. Человек называет день, а не момент
//    времени; в БД лежит ровно полночь UTC этого дня (mailer.ts и цикл
//    праздника считают отметку именно так).
// 2. СМЕНА ДАТЫ НЕ ОСТАВЛЯЕТ ОСИРОТЕВШИХ НАПОМИНАНИЙ. `reminderGuestJobId`
//    строится из даты, поэтому важно, что джобы не планируются заранее:
//    ежечасный тик каждый раз читает ТЕКУЩУЮ дату комнаты. Сменили дату —
//    следующий тик берёт новую, старый jobId никем не ставится; убрали дату —
//    комната выпадает из выборки совсем.
//
// Тик сканирует всю БД, поэтому все проверки фильтруются своими бронями —
// параллельные тестовые файлы не шумят в ассертах.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/server/db";
import { createRoomForUser, setOccasionDate } from "../src/server/services/rooms";
import { readOccasionDate } from "../src/app/onboarding/occasion-date";
import type { ReminderGuestMailJobData } from "../src/server/queues";
import { reminderGuestJobId } from "../src/server/queues";
import { processReminderTick } from "../src/worker/reminders";

const TEST_EMAIL_DOMAIN = "@onboarding-occasion.test";

/** Полдень: обе даты ниже отстоят от него меньше чем на трое суток. */
const NOW = new Date("2026-09-01T09:00:00.000Z");
const DATE_SOON = "2026-09-03";
const DATE_LATER = "2026-09-04";
const DATE_FAR = "2026-10-01";

/**
 * Ровно то, что делает `createRoomAction` после третьего шага: комната
 * создаётся сервисом, дата уходит в `setOccasionDate` — второго пути к
 * `Room.occasionDate` в продукте нет.
 */
async function finishOnboarding(
  userId: string,
  form: { preset: string; zoneSet: string; occasionDate?: string; skipDate?: boolean },
) {
  const room = await createRoomForUser(userId, { preset: form.preset, zoneSet: form.zoneSet });
  const date = form.skipDate ? null : readOccasionDate(form.occasionDate);
  if (date !== null) await setOccasionDate(userId, date);
  return prisma.room.findUniqueOrThrow({ where: { id: room.id } });
}

async function createOwner() {
  return prisma.user.create({
    data: { email: `owner-${randomUUID()}${TEST_EMAIL_DOMAIN}`, displayName: "Мила" },
  });
}

/** Живая бронь с почтой в комнате — повод для напоминания. */
async function createBooking(roomId: string) {
  const item = await prisma.item.create({
    data: {
      roomId,
      zone: "jewelry",
      state: "WANT",
      title: `Вещь-${randomUUID().slice(0, 8)}`,
      price: "5000",
      currency: "RUB",
    },
  });
  return prisma.booking.create({
    data: {
      itemId: item.id,
      guestName: "Паша",
      guestEmail: `guest-${randomUUID()}${TEST_EMAIL_DOMAIN}`,
      cancelToken: randomUUID(),
    },
  });
}

function enqueueMock() {
  return vi.fn<(data: ReminderGuestMailJobData) => Promise<boolean>>(async () => true);
}

/** Только письма по своим броням — параллельные тесты не шумят. */
function callsFor(
  mock: ReturnType<typeof enqueueMock>,
  bookingIds: string[],
): ReminderGuestMailJobData[] {
  return mock.mock.calls
    .map(([data]) => data)
    .filter((data) => bookingIds.includes(data.bookingId));
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("третий шаг онбординга — календарная дата, не момент времени", () => {
  it("день из формы ложится ровно в полночь UTC этого же дня", async () => {
    const user = await createOwner();
    const room = await finishOnboarding(user.id, {
      preset: "cream",
      zoneSet: "F",
      occasionDate: "2026-12-31",
    });

    // Проверка от часового пояса машины не зависит: сравнивается сама
    // отметка. Локальная полночь в любом поясе восточнее Гринвича дала бы
    // 2026-12-30T21:00:00Z и уронила бы тест.
    expect(room.occasionDate?.toISOString()).toBe("2026-12-31T00:00:00.000Z");
    // И обратно: настройки покажут тот же день, что человек назвал.
    expect(room.occasionDate?.toISOString().slice(0, 10)).toBe("2026-12-31");
  });

  it("новогодний край не переезжает на сутки назад", async () => {
    const user = await createOwner();
    const room = await finishOnboarding(user.id, {
      preset: "cream",
      zoneSet: "F",
      occasionDate: "2027-01-01",
    });

    expect(room.occasionDate?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(room.occasionDate?.getUTCFullYear()).toBe(2027);
  });

  it("«Пока не знаю» — комната есть, даты нет, ничего не сломано", async () => {
    const user = await createOwner();
    const room = await finishOnboarding(user.id, {
      preset: "cream",
      zoneSet: "F",
      occasionDate: "2026-12-31",
      skipDate: true, // сабмит кнопкой пропуска: поле даты не читается вовсе
    });

    expect(room.occasionDate).toBeNull();
    expect(room.shareSlug).toMatch(/^[a-z0-9]{6}$/);
  });

  it("пустое поле не создаёт даты (пропуск не бывает молчаливым сбоем)", async () => {
    const user = await createOwner();
    const room = await finishOnboarding(user.id, {
      preset: "cream",
      zoneSet: "F",
      occasionDate: "",
    });

    expect(room.occasionDate).toBeNull();
  });
});

describe("дата из онбординга и напоминания гостям", () => {
  it("дата в окне трёх суток будит напоминание по живой брони", async () => {
    const user = await createOwner();
    const room = await finishOnboarding(user.id, {
      preset: "cream",
      zoneSet: "F",
      occasionDate: DATE_SOON,
    });
    const booking = await createBooking(room.id);

    const enqueue = enqueueMock();
    const result = await processReminderTick(NOW, { enqueue });

    expect(result.enqueued).toContain(
      reminderGuestJobId(booking.id, new Date(`${DATE_SOON}T00:00:00.000Z`)),
    );
    expect(callsFor(enqueue, [booking.id])).toHaveLength(1);
  });

  it("комната без броней — тишина, хотя дата уже близко", async () => {
    const user = await createOwner();
    const room = await finishOnboarding(user.id, {
      preset: "cream",
      zoneSet: "F",
      occasionDate: DATE_SOON,
    });

    const enqueue = enqueueMock();
    await processReminderTick(NOW, { enqueue });

    const mine = enqueue.mock.calls
      .map(([data]) => data)
      .filter((data) => data.roomSlug === room.shareSlug);
    expect(mine).toEqual([]);
  });

  it("комната без даты не участвует вообще", async () => {
    const user = await createOwner();
    const room = await finishOnboarding(user.id, { preset: "cream", zoneSet: "F", skipDate: true });
    const booking = await createBooking(room.id);

    const enqueue = enqueueMock();
    await processReminderTick(NOW, { enqueue });

    expect(callsFor(enqueue, [booking.id])).toEqual([]);
  });
});

describe("смена даты не оставляет осиротевших напоминаний", () => {
  it("после переноса тик ставит джобу НОВОЙ даты и ни разу — старой", async () => {
    const user = await createOwner();
    const room = await finishOnboarding(user.id, {
      preset: "cream",
      zoneSet: "F",
      occasionDate: DATE_SOON,
    });
    const booking = await createBooking(room.id);
    const oldJobId = reminderGuestJobId(booking.id, new Date(`${DATE_SOON}T00:00:00.000Z`));
    const newJobId = reminderGuestJobId(booking.id, new Date(`${DATE_LATER}T00:00:00.000Z`));

    const before = enqueueMock();
    expect((await processReminderTick(NOW, { enqueue: before })).enqueued).toContain(oldJobId);

    // Тот же сервис, что зовут настройки: перенос праздника на сутки.
    await setOccasionDate(user.id, DATE_LATER);

    const after = enqueueMock();
    const result = await processReminderTick(NOW, { enqueue: after });

    expect(result.enqueued).toContain(newJobId);
    expect(result.enqueued).not.toContain(oldJobId);
    // Джобы не планируются заранее — переносить нечего: тик каждый раз
    // читает текущую дату комнаты, поэтому старый jobId просто больше
    // никем не ставится.
    expect(result.failed).not.toContain(oldJobId);
  });

  it("письмо после переноса несёт новую дату, а не ту, что была при первом тике", async () => {
    const user = await createOwner();
    const room = await finishOnboarding(user.id, {
      preset: "cream",
      zoneSet: "F",
      occasionDate: DATE_SOON,
    });
    const booking = await createBooking(room.id);

    await processReminderTick(NOW, { enqueue: enqueueMock() });
    await setOccasionDate(user.id, DATE_LATER);

    const enqueue = enqueueMock();
    await processReminderTick(NOW, { enqueue });

    const [data] = callsFor(enqueue, [booking.id]);
    expect(data?.occasionDate).toBe(`${DATE_LATER}T00:00:00.000Z`);
  });

  it("дата, уехавшая за окно, гасит напоминания до своего срока", async () => {
    const user = await createOwner();
    const room = await finishOnboarding(user.id, {
      preset: "cream",
      zoneSet: "F",
      occasionDate: DATE_SOON,
    });
    const booking = await createBooking(room.id);

    await processReminderTick(NOW, { enqueue: enqueueMock() });
    await setOccasionDate(user.id, DATE_FAR);

    const enqueue = enqueueMock();
    await processReminderTick(NOW, { enqueue });

    expect(callsFor(enqueue, [booking.id])).toEqual([]);
  });

  it("убранная дата гасит напоминания совсем", async () => {
    const user = await createOwner();
    const room = await finishOnboarding(user.id, {
      preset: "cream",
      zoneSet: "F",
      occasionDate: DATE_SOON,
    });
    const booking = await createBooking(room.id);

    await processReminderTick(NOW, { enqueue: enqueueMock() });
    await setOccasionDate(user.id, null);

    const enqueue = enqueueMock();
    const result = await processReminderTick(NOW, { enqueue });

    expect(callsFor(enqueue, [booking.id])).toEqual([]);
    expect(result.enqueued).not.toContain(
      reminderGuestJobId(booking.id, new Date(`${DATE_SOON}T00:00:00.000Z`)),
    );
  });
});
