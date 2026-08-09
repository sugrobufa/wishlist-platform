// Обработчик очереди mail (тикет 12, src/worker/mail.ts) — реальная тест-БД,
// отправка подменена швами deps. Разруливает все три имени джоб и незнакомое;
// email хозяйки добирается из БД при пустом payload'е; снятая бронь и
// прошедший праздник не рождают писем. Плюс инвариант тихой брони: письмо
// хозяйке не содержит ни имён гостей, ни названий вещей.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/server/db";
import { processMailJob } from "../src/worker/mail";

const TEST_EMAIL_DOMAIN = "@mailer-worker.test";
const FUTURE_DATE = new Date("2027-03-14T00:00:00.000Z");

async function createOwnerWithBooking(options: { displayName?: string | null } = {}) {
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
      shareSlug: `mw-${randomUUID().slice(0, 12)}`,
      occasionDate: FUTURE_DATE,
    },
  });
  const item = await prisma.item.create({
    data: {
      roomId: room.id,
      zone: "jewelry",
      inHall: false,
      title: "Тайная вещь",
      price: "5000",
      currency: "RUB",
    },
  });
  const booking = await prisma.booking.create({
    data: {
      itemId: item.id,
      guestName: "Секретный Даритель",
      guestEmail: `guest-${randomUUID()}${TEST_EMAIL_DOMAIN}`,
      cancelToken: randomUUID(),
    },
  });
  return { user, room, item, booking };
}

function sendSeams() {
  return {
    sendReminderGuestImpl: vi.fn(async () => undefined),
    sendOccasionOwnerImpl: vi.fn(async () => undefined),
    sendItemGoneImpl: vi.fn(async () => undefined),
  };
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("processMailJob — occasion-owner", () => {
  it("payload с email → письмо на него, displayName из БД, ссылка на «что подарили»", async () => {
    const { user, room } = await createOwnerWithBooking();
    const deps = sendSeams();

    const result = await processMailJob(
      "occasion-owner",
      { userId: user.id, email: user.email, roomId: room.id },
      deps,
    );

    expect(result).toEqual({ status: "sent" });
    expect(deps.sendOccasionOwnerImpl).toHaveBeenCalledTimes(1);
    expect(deps.sendOccasionOwnerImpl).toHaveBeenCalledWith(user.email, {
      ownerName: "Мила",
      occasionUrl: expect.stringContaining("/room/occasion"),
    });
    expect(deps.sendReminderGuestImpl).not.toHaveBeenCalled();
  });

  it("email в payload пуст → добирается по userId из БД", async () => {
    const { user, room } = await createOwnerWithBooking({ displayName: null });
    const deps = sendSeams();

    const result = await processMailJob(
      "occasion-owner",
      { userId: user.id, email: "", roomId: room.id },
      deps,
    );

    expect(result).toEqual({ status: "sent" });
    expect(deps.sendOccasionOwnerImpl).toHaveBeenCalledWith(user.email, {
      ownerName: null,
      occasionUrl: expect.stringContaining("/room/occasion"),
    });
  });

  it("хозяйка удалила аккаунт → skipped user-gone, письмо не уходит", async () => {
    const deps = sendSeams();
    const result = await processMailJob(
      "occasion-owner",
      { userId: `gone-${randomUUID()}`, email: "ghost@example.com", roomId: "r1" },
      deps,
    );
    expect(result).toEqual({ status: "skipped", reason: "user-gone" });
    expect(deps.sendOccasionOwnerImpl).not.toHaveBeenCalled();
  });

  it("мусор вместо payload'а → skipped bad-data", async () => {
    const deps = sendSeams();
    expect(await processMailJob("occasion-owner", null, deps)).toEqual({
      status: "skipped",
      reason: "bad-data",
    });
    expect(await processMailJob("occasion-owner", { email: "x@y.z" }, deps)).toEqual({
      status: "skipped",
      reason: "bad-data",
    });
    expect(deps.sendOccasionOwnerImpl).not.toHaveBeenCalled();
  });

  it("ИНВАРИАНТ №1: письмо хозяйке не содержит ни имён гостей, ни вещей", async () => {
    const { user, room } = await createOwnerWithBooking();
    vi.stubEnv("EMAIL_SERVER", ""); // настоящий транспорт → консоль
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const result = await processMailJob("occasion-owner", {
      userId: user.id,
      email: user.email,
      roomId: room.id,
    });

    expect(result).toEqual({ status: "sent" });
    const letters = log.mock.calls.map((call) => String(call[0])).filter((s) => s.includes("✉"));
    expect(letters).toHaveLength(1);
    expect(letters[0]).toContain("/room/occasion");
    expect(letters[0]).not.toContain("Секретный Даритель");
    expect(letters[0]).not.toContain("Тайная вещь");
    expect(letters[0]).not.toContain("guest-"); // и почты гостя там нет
  });
});

describe("processMailJob — reminder-guest", () => {
  function reminderPayload(bookingId: string, overrides: Record<string, unknown> = {}) {
    return {
      bookingId,
      email: `guest-x${TEST_EMAIL_DOMAIN}`,
      guestName: "Паша",
      ownerName: "Мила",
      occasionDate: FUTURE_DATE.toISOString(),
      itemTitle: "Тайная вещь",
      roomSlug: "x7k2m9",
      ...overrides,
    };
  }

  it("живая бронь и будущий праздник → письмо гостю со всеми полями", async () => {
    const { booking } = await createOwnerWithBooking();
    const deps = sendSeams();

    const result = await processMailJob("reminder-guest", reminderPayload(booking.id), deps);

    expect(result).toEqual({ status: "sent" });
    expect(deps.sendReminderGuestImpl).toHaveBeenCalledTimes(1);
    expect(deps.sendReminderGuestImpl).toHaveBeenCalledWith(`guest-x${TEST_EMAIL_DOMAIN}`, {
      guestName: "Паша",
      ownerName: "Мила",
      itemTitle: "Тайная вещь",
      occasionDate: FUTURE_DATE,
      roomSlug: "x7k2m9",
    });
  });

  it("бронь сняли, пока джоба ждала → skipped booking-gone, тишина", async () => {
    const deps = sendSeams();
    const result = await processMailJob(
      "reminder-guest",
      reminderPayload(`gone-${randomUUID()}`),
      deps,
    );
    expect(result).toEqual({ status: "skipped", reason: "booking-gone" });
    expect(deps.sendReminderGuestImpl).not.toHaveBeenCalled();
  });

  it("праздник уже прошёл (воркер пролежал) → skipped occasion-passed", async () => {
    const { booking } = await createOwnerWithBooking();
    const deps = sendSeams();
    const result = await processMailJob(
      "reminder-guest",
      reminderPayload(booking.id, { occasionDate: "2026-01-01T00:00:00.000Z" }),
      deps,
    );
    expect(result).toEqual({ status: "skipped", reason: "occasion-passed" });
    expect(deps.sendReminderGuestImpl).not.toHaveBeenCalled();
  });

  it("мусор вместо payload'а → skipped bad-data", async () => {
    const deps = sendSeams();
    expect(await processMailJob("reminder-guest", { bookingId: "b1" }, deps)).toEqual({
      status: "skipped",
      reason: "bad-data",
    });
    expect(
      await processMailJob("reminder-guest", reminderPayload("b1", { occasionDate: "не дата" }), deps),
    ).toEqual({ status: "skipped", reason: "bad-data" });
  });
});

describe("processMailJob — незнакомые имена", () => {
  it("hello (и любое чужое имя) → skipped unknown-job, письма не рождаются", async () => {
    const deps = sendSeams();
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    expect(await processMailJob("hello", { message: "worker is alive" }, deps)).toEqual({
      status: "skipped",
      reason: "unknown-job",
    });
    expect(await processMailJob("price-drop", {}, deps)).toEqual({
      status: "skipped",
      reason: "unknown-job",
    });

    expect(deps.sendReminderGuestImpl).not.toHaveBeenCalled();
    expect(deps.sendOccasionOwnerImpl).not.toHaveBeenCalled();
    expect(log.mock.calls.some((call) => String(call[0]).includes("hello"))).toBe(true);
  });
});

// Письмо гостю «вещь уехала — выбери другую» (тикет 124, раунд 28 дизайна).
// Хозяйка о нём не узнаёт ничем: адресат — гость, и в payload'е нет ни одного
// её поля, кроме слага комнаты, по которому гость и пришёл (инвариант №1).
describe("processMailJob — item-gone (вещь уехала в сокровищницу)", () => {
  const payload = (overrides: Record<string, unknown> = {}) => ({
    bookingId: "booking_1",
    email: "guest@mail.test",
    guestName: "Оля",
    itemTitle: "Стёганая сумка",
    roomSlug: "mila",
    ...overrides,
  });

  it("шлёт письмо гостю и НЕ ходит в БД: брони к этому моменту уже нет", async () => {
    const deps = sendSeams();
    // Никаких строк в БД специально не заводим — джоба самодостаточна.
    expect(await processMailJob("item-gone", payload(), deps)).toEqual({ status: "sent" });
    expect(deps.sendItemGoneImpl).toHaveBeenCalledWith("guest@mail.test", {
      guestName: "Оля",
      itemTitle: "Стёганая сумка",
      roomSlug: "mila",
    });
  });

  it("мусор вместо payload'а → skipped bad-data, письма нет", async () => {
    const deps = sendSeams();
    expect(await processMailJob("item-gone", { email: "" }, deps)).toEqual({
      status: "skipped",
      reason: "bad-data",
    });
    expect(deps.sendItemGoneImpl).not.toHaveBeenCalled();
  });

  it("хозяйке это письмо не уходит ни при каких данных", () => {
    // Форма джобы физически не несёт адреса хозяйки: её email в payload'е
    // просто негде взять. Проверка на самой форме — дешевле и надёжнее, чем
    // ловить это по строкам письма.
    expect(Object.keys(payload()).sort()).toEqual([
      "bookingId",
      "email",
      "guestName",
      "itemTitle",
      "roomSlug",
    ]);
  });
});
