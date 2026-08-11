// День рождения из онбординга (тикеты 43 и 187): третий шаг пишет день и месяц
// комнаты тем же сервисом, что и настройки, и от этой записи просыпаются
// напоминания. Тест держит два обещания тикета:
//
// 1. КАЛЕНДАРНАЯ ДАТА НЕ СЪЕЗЖАЕТ. Человек называет день, а не момент
//    времени; в БД лежат день и месяц, а ближайший праздник считается ровно
//    полночью UTC этого дня (mailer.ts и цикл праздника считают её так же).
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
import { createRoomForUser, setBirthday } from "../src/server/services/rooms";
import { birthdayOf, nextOccasion } from "../src/server/birthday";
import { readBirthdayForm } from "../src/app/onboarding/occasion-date";
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
 * Дорога даты из `createRoomAction` после третьего шага: комната создаётся
 * сервисом, день рождения уходит в `setBirthday` — второго пути к нему в
 * продукте нет. Остальное, что делает экшен (имя из брони, гашение cookie
 * предзаполнения — тикет 38), к дате отношения не имеет и здесь не повторяется.
 *
 * Форма присылает ДВА ПОЛЯ — день и месяц (тикет 187); тесты записывают их
 * календарным днём, чтобы было видно, о каком празднике речь.
 */
async function finishOnboarding(
  userId: string,
  form: { preset: string; zoneSet: string; occasionDate?: string; skipDate?: boolean },
) {
  const room = await createRoomForUser(userId, { preset: form.preset, zoneSet: form.zoneSet });
  const [, month, day] = (form.occasionDate ?? "").split("-");
  const birthday = form.skipDate ? null : readBirthdayForm(day, month);
  if (birthday !== null) await setBirthday(userId, birthday);
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
      inHall: false,
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
  it("день и месяц из формы ложатся в комнату, год не спрашивается", async () => {
    const user = await createOwner();
    const room = await finishOnboarding(user.id, {
      preset: "cream",
      zoneSet: "F",
      occasionDate: "2026-12-31",
    });

    expect(birthdayOf(room)).toEqual({ day: 31, month: 12, year: null });
    // Ближайший праздник — ровно полночь UTC этого дня. Проверка от часового
    // пояса машины не зависит: сравнивается сама отметка. Локальная полночь в
    // любом поясе восточнее Гринвича дала бы 2026-12-30T21:00:00Z.
    const birthday = birthdayOf(room);
    expect(nextOccasion(birthday!, new Date("2026-12-01T09:00:00.000Z")).toISOString()).toBe(
      "2026-12-31T00:00:00.000Z",
    );
  });

  it("новогодний край не переезжает на сутки назад — и повторяется через год", async () => {
    const user = await createOwner();
    const room = await finishOnboarding(user.id, {
      preset: "cream",
      zoneSet: "F",
      occasionDate: "2027-01-01",
    });

    expect(birthdayOf(room)).toEqual({ day: 1, month: 1, year: null });
    const birthday = birthdayOf(room);
    expect(nextOccasion(birthday!, new Date("2026-12-31T21:00:00.000Z")).toISOString()).toBe(
      "2027-01-01T00:00:00.000Z",
    );
    // ПРОШЁЛ — И СЛЕДУЮЩИЙ САМ СТАЛ ЧЕРЕЗ ГОД: спрашивать больше нечего.
    expect(nextOccasion(birthday!, new Date("2027-01-02T00:00:00.000Z")).toISOString()).toBe(
      "2028-01-01T00:00:00.000Z",
    );
  });

  it("«Пока не знаю» — комната есть, даты нет, ничего не сломано", async () => {
    const user = await createOwner();
    const room = await finishOnboarding(user.id, {
      preset: "cream",
      zoneSet: "F",
      occasionDate: "2026-12-31",
      skipDate: true, // сабмит кнопкой пропуска: списки даты не читаются вовсе
    });

    expect(birthdayOf(room)).toBeNull();
    expect(room.birthdayDay).toBeNull();
    expect(room.birthdayMonth).toBeNull();
    expect(room.shareSlug).toMatch(/^[a-z0-9]{6}$/);
  });

  it("пустые списки не создают даты (пропуск не бывает молчаливым сбоем)", async () => {
    const user = await createOwner();
    const room = await finishOnboarding(user.id, {
      preset: "cream",
      zoneSet: "F",
      occasionDate: "",
    });

    expect(birthdayOf(room)).toBeNull();
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

    // Тот же сервис, что зовут настройки: перенос дня рождения на сутки.
    await setBirthday(user.id, DATE_LATER);

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
    await setBirthday(user.id, DATE_LATER);

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
    await setBirthday(user.id, DATE_FAR);

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
    await setBirthday(user.id, null);

    const enqueue = enqueueMock();
    const result = await processReminderTick(NOW, { enqueue });

    expect(callsFor(enqueue, [booking.id])).toEqual([]);
    expect(result.enqueued).not.toContain(
      reminderGuestJobId(booking.id, new Date(`${DATE_SOON}T00:00:00.000Z`)),
    );
  });
});
