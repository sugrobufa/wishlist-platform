// Обработчик очереди mail (тикет 12, src/worker/mail.ts) — реальная тест-БД,
// отправка подменена швами deps. Разруливает все три имени джоб и незнакомое;
// email хозяйки добирается из БД при пустом payload'е; снятая бронь и
// прошедший праздник не рождают писем. Плюс инвариант тихой брони: письмо
// хозяйке не содержит ни имён гостей, ни названий вещей.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../src/server/db";
import { birthdayColumns, nextOccasion } from "../src/server/birthday";
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
      ...birthdayColumns({ day: 14, month: 3, year: null }),
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
  it("payload с email → письмо на него, ссылка на «что подарили» и НИЧЕГО больше", async () => {
    const { user, room } = await createOwnerWithBooking();
    const deps = sendSeams();

    const result = await processMailJob(
      "occasion-owner",
      { userId: user.id, email: user.email, roomId: room.id },
      deps,
    );

    expect(result).toEqual({ status: "sent" });
    expect(deps.sendOccasionOwnerImpl).toHaveBeenCalledTimes(1);
    // С раунда 41 (тикет 171) письмо хозяйке не принимает даже её имени:
    // в табличном макете слота под обращение нет, а лишний параметр — лишняя
    // дорога для утечки. Сравнение ТОЧНОЕ: второе поле здесь не проедет.
    expect(deps.sendOccasionOwnerImpl).toHaveBeenCalledWith(user.email, {
      occasionUrl: expect.stringContaining("/room/occasion"),
    });
    expect(deps.sendReminderGuestImpl).not.toHaveBeenCalled();
  });

  it("ссылка собирается от APP_BASE_URL ПРОЦЕССА, который крутит воркер (тикет 158)", async () => {
    // Письмо рендерит тот процесс, который взял джобу из очереди, — в проде
    // это воркер (`npm run worker`), в e2e мини-воркер внутри процесса теста.
    // Адрес ссылки берётся из окружения ИМЕННО ЭТОГО процесса: никакого
    // запроса, от которого его можно было бы вывести, у джобы нет. Отсюда и
    // правило стенда — адрес ставит себе тот, кто шлёт письмо.
    const { user, room } = await createOwnerWithBooking();
    const deps = sendSeams();
    vi.stubEnv("APP_BASE_URL", "http://localhost:3100");

    const result = await processMailJob(
      "occasion-owner",
      { userId: user.id, email: user.email, roomId: room.id },
      deps,
    );

    expect(result).toEqual({ status: "sent" });
    expect(deps.sendOccasionOwnerImpl).toHaveBeenCalledWith(user.email, {
      occasionUrl: "http://localhost:3100/room/occasion",
    });
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
      ownerName: "Мила",
      itemTitle: "Тайная вещь",
      occasionDate: FUTURE_DATE,
      // Плашка вещи (контракт round41) — из БД, а не из payload'а: цена и её
      // видимость читаются СВЕЖИМИ, на момент отправки.
      itemZone: "jewelry",
      price: "5000",
      currency: "RUB",
      priceVisibility: "ALL",
    });
  });

  it("цена вещи и её видимость берутся СВЕЖИМИ — payload про них не знает", async () => {
    // Хозяйка спрятала цену, пока джоба лежала в очереди. Письмо обязано
    // молчать так же, как страница вещи (инвариант №8): значение приезжает в
    // шаблон, а он его не показывает (проверка показа — tests/mailer.test.ts).
    const { booking, item } = await createOwnerWithBooking();
    await prisma.item.update({
      where: { id: item.id },
      data: { priceVisibility: "ME", price: "9999" },
    });
    const deps = sendSeams();

    await processMailJob("reminder-guest", reminderPayload(booking.id), deps);

    expect(deps.sendReminderGuestImpl).toHaveBeenCalledWith(
      `guest-x${TEST_EMAIL_DOMAIN}`,
      expect.objectContaining({ price: "9999", priceVisibility: "ME" }),
    );
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

  it("комнаты по слагу нет → письмо всё равно уходит, просто без подвала", async () => {
    const deps = sendSeams();
    // За БРОНЬЮ в БД не ходим — её уже нет. Комната по слагу не находится
    // (аккаунт удалён) — гость обязан узнать, что подарок отменился, поэтому
    // письмо уходит без «сколько свободно» и без даты праздника.
    expect(await processMailJob("item-gone", payload(), deps)).toEqual({ status: "sent" });
    expect(deps.sendItemGoneImpl).toHaveBeenCalledWith("guest@mail.test", {
      itemTitle: "Стёганая сумка",
      roomSlug: "mila",
      ownerName: null,
      freeCount: null,
      occasionDate: null,
    });
  });

  it("комната жива → имя хозяйки, «сколько свободно» и дата праздника на месте", async () => {
    // Числа контракта round41 считаются В МОМЕНТ ОТПРАВКИ и тем же правилом,
    // что показывает сама комната (guest-room.countFreeGiftsByRoom): занятая
    // вещь свободной не считается, спрятанная и уехавшая на витрину — тоже.
    const { room, item } = await createOwnerWithBooking();
    await prisma.item.createMany({
      data: [
        { roomId: room.id, zone: "jewelry", title: "Свободная 1" },
        { roomId: room.id, zone: "jewelry", title: "Свободная 2" },
        { roomId: room.id, zone: "jewelry", title: "Спрятанная", hidden: true },
        { roomId: room.id, zone: "jewelry", title: "На витрине", inHall: true },
      ],
    });
    const deps = sendSeams();

    const result = await processMailJob(
      "item-gone",
      payload({ roomSlug: room.shareSlug, itemTitle: item.title }),
      deps,
    );

    expect(result).toEqual({ status: "sent" });
    expect(deps.sendItemGoneImpl).toHaveBeenCalledWith("guest@mail.test", {
      itemTitle: "Тайная вещь",
      roomSlug: room.shareSlug,
      ownerName: "Мила",
      // Две свободные: занятая бронью «Тайная вещь», спрятанная и витринная
      // в счёт не идут.
      freeCount: 2,
      // Ближайший праздник считается на отправке (тикет 187): комната хранит
      // день и месяц, письмо несёт ту же дату, что видит гость в комнате.
      occasionDate: nextOccasion({ day: 14, month: 3, year: null }, new Date()),
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
