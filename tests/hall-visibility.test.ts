// «Кто видит сокровищницу» — тикет 116, ADR-0011.
//
// Что здесь защищается:
// - ТРИ положения двери и все на чтении, в сервисе, а не на странице:
//   ALL — открыто любому по ссылке, MUTUAL — только вошедшему со взаимной
//   связью, NONE — закрыто всем, кроме хозяйки;
// - дефолт новой комнаты — ALL: миграция не имеет права молча закрыть
//   существующие комнаты (это половина довода ADR за открытый дефолт);
// - `hallOpen` в некэшируемом канале «занято» — по нему гостевая страница
//   решает, рисовать ли вход «Сокровищница». Ответ двери и ответ ссылке
//   обязаны совпадать: ссылки, ведущей в 404, быть не должно;
// - инвариант №5 не сломан: новая настройка — ЧЕТВЁРТОЕ условие фильтра
//   поверх трёх существующих, а не вместо них. Открытая витрина по-прежнему
//   не отдаёт спрятанную вещь и вещь выключенной зоны.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";

// Тот же поддельный кэш, что в tests/guest-hall.test.ts: с прогоном через
// JSON, как ведёт себя Next Data Cache на самом деле.
vi.mock("next/cache", () => ({
  unstable_cache:
    <T extends (...args: never[]) => unknown>(fn: T) =>
    async (...args: Parameters<T>) =>
      JSON.parse(JSON.stringify(await fn(...args))) as unknown,
  revalidateTag: () => undefined,
}));

import { prisma } from "../src/server/db";
import { getGuestHall } from "../src/server/services/guest-hall";
import { getGuestRoom } from "../src/server/services/guest-room";
import { takenForRoomSlug } from "../src/server/services/bookings";
import { setHallSettings } from "../src/server/services/rooms";
import { isMutualPair } from "../src/server/services/hall-access";

const TEST_EMAIL_DOMAIN = "@hall-visibility.test";

async function createUser(displayName: string) {
  return prisma.user.create({
    data: { email: `u-${randomUUID()}${TEST_EMAIL_DOMAIN}`, displayName },
  });
}

/** Комната с одной вещью на витрине: смотреть есть на что при любом положении. */
async function createRoom(displayName = "Ирина") {
  const user = await createUser(displayName);
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `hv-${randomUUID().slice(0, 12)}`,
    },
  });
  await createLove(room.id, "Браслет");
  return { user, room };
}

async function createLove(
  roomId: string,
  title: string,
  overrides: Partial<Prisma.ItemUncheckedCreateInput> = {},
) {
  return prisma.item.create({
    data: { roomId, zone: "jewelry", state: "LOVE", title, inHall: true, ...overrides },
  });
}

/**
 * Связь пары. `mutual: false` — связь ЕСТЬ, но взаимной не стала (согласие
 * ещё не с обеих сторон): для двери это то же самое, что связи нет.
 * `flip` кладёт пару в обратной ориентации — строка Connection одна на пару,
 * и кто оказался стороной `a`, зависит от того, кто кому подарил.
 */
async function connect(
  userA: string,
  userB: string,
  options: { mutual?: boolean; flip?: boolean } = {},
) {
  const [a, b] = options.flip === true ? [userB, userA] : [userA, userB];
  return prisma.connection.create({
    data: {
      aUserId: a,
      bUserId: b,
      kind: options.mutual === false ? "VIEWED" : "MUTUAL",
      origin: "visit",
      consentAskedAt: new Date(),
      consentA: true,
      consentB: options.mutual === false ? null : true,
      mutualAt: options.mutual === false ? null : new Date(),
    },
  });
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("дефолт новой комнаты", () => {
  it("ALL — миграция не закрывает существующие комнаты молча", async () => {
    const { room } = await createRoom();
    // Половина довода ADR-0011 за открытый дефолт: у комнат, заведённых до
    // тикета, поведение обязано остаться прежним — витрина открыта по ссылке.
    expect(room.hallVisibility).toBe("ALL");
    expect(await getGuestHall(room.shareSlug, null)).not.toBeNull();
  });

  it("настройка витрины и настройка цены — разные и не путаются", async () => {
    const { user } = await createRoom();
    // ADR-0011: настроек две и они про разное. Закрытая витрина не сбрасывает
    // цену, открытая цена не открывает витрину.
    const saved = await setHallSettings(user.id, { visibility: "NONE" });
    expect(saved.hallVisibility).toBe("NONE");
    expect(saved.hallPriceVisibility).toBe("FRIENDS"); // дефолт ADR-0004 цел

    const back = await setHallSettings(user.id, { priceVisibility: "ALL" });
    expect(back.hallVisibility).toBe("NONE"); // цена витрину не отпирает
  });
});

describe("ALL — всем по ссылке", () => {
  it("аноним и любой вошедший видят витрину", async () => {
    const { user, room } = await createRoom();
    await setHallSettings(user.id, { visibility: "ALL" });
    const stranger = await createUser("Прохожий");

    expect((await getGuestHall(room.shareSlug, null))?.items).toHaveLength(1);
    expect((await getGuestHall(room.shareSlug, stranger.id))?.items).toHaveLength(1);
  });
});

describe("MUTUAL — только взаимным друзьям", () => {
  it("взаимного пускает — в любой ориентации строки связи", async () => {
    for (const flip of [false, true]) {
      const { user, room } = await createRoom();
      await setHallSettings(user.id, { visibility: "MUTUAL" });
      const friend = await createUser("Соня");
      await connect(user.id, friend.id, { flip });

      expect(await isMutualPair(friend.id, user.id)).toBe(true);
      expect((await getGuestHall(room.shareSlug, friend.id))?.items).toHaveLength(1);
    }
  });

  it("невзаимного, чужого и анонима не пускает", async () => {
    const { user, room } = await createRoom();
    await setHallSettings(user.id, { visibility: "MUTUAL" });

    // Связь есть, но взаимной не стала: согласие пришло с одной стороны.
    const pending = await createUser("Ещё не решил");
    await connect(user.id, pending.id, { mutual: false });
    const stranger = await createUser("Прохожий");

    expect(await getGuestHall(room.shareSlug, pending.id)).toBeNull();
    expect(await getGuestHall(room.shareSlug, stranger.id)).toBeNull();
    // Гость без входа взаимным быть не может по определению (ADR-0011,
    // «что осталось открытым») — отдельного экрана «войди» не рисуем.
    expect(await getGuestHall(room.shareSlug, null)).toBeNull();
  });

  it("взаимность с ЭТОЙ хозяйкой, а не с кем-нибудь вообще", async () => {
    const { user, room } = await createRoom();
    await setHallSettings(user.id, { visibility: "MUTUAL" });
    const friend = await createUser("Соня");
    const someoneElse = await createUser("Третий");
    await connect(friend.id, someoneElse.id); // взаимная, но с посторонним

    expect(await getGuestHall(room.shareSlug, friend.id)).toBeNull();
  });
});

describe("NONE — никому", () => {
  it("закрыто даже вошедшему взаимному другу", async () => {
    const { user, room } = await createRoom();
    const friend = await createUser("Соня");
    await connect(user.id, friend.id);
    await setHallSettings(user.id, { visibility: "NONE" });

    expect(await getGuestHall(room.shareSlug, friend.id)).toBeNull();
    expect(await getGuestHall(room.shareSlug, null)).toBeNull();
  });
});

describe("хозяйка на своей гостевой ссылке", () => {
  it("видит свою витрину при любом положении", async () => {
    const { user, room } = await createRoom();
    for (const visibility of ["ALL", "MUTUAL", "NONE"] as const) {
      await setHallSettings(user.id, { visibility });
      // Она и так смотрит /room/hall, но открыв СВОЮ гостевую ссылку, запертой
      // двери увидеть не должна — это её вещи.
      expect((await getGuestHall(room.shareSlug, user.id))?.items).toHaveLength(1);
    }
  });
});

describe("«закрыто» неотличимо от «нет такой комнаты»", () => {
  it("закрытая витрина отвечает тем же null, что неизвестный слаг", async () => {
    const { user, room } = await createRoom();
    await setHallSettings(user.id, { visibility: "NONE" });

    expect(await getGuestHall(room.shareSlug, null)).toBeNull();
    expect(await getGuestHall("нет-такой-комнаты", null)).toBeNull();
  });

  it("пустая витрина — это НЕ закрытая: комната есть, показывать нечего", async () => {
    // Разница, ради которой всё и затевалось: «пусто» остаётся пустым
    // состоянием, а не 404, — и наоборот, закрытое не притворяется пустым.
    const user = await createUser("Пустая");
    const room = await prisma.room.create({
      data: {
        userId: user.id,
        preset: "cream",
        zoneSet: "F",
        shareSlug: `hv-${randomUUID().slice(0, 12)}`,
      },
    });

    const hall = await getGuestHall(room.shareSlug, null);
    expect(hall).not.toBeNull();
    expect(hall?.items).toEqual([]);
  });
});

describe("инвариант №5 не сломан: дверь — четвёртое условие, а не вместо трёх", () => {
  it("открытая витрина по-прежнему не отдаёт спрятанное", async () => {
    const { user, room } = await createRoom();
    await setHallSettings(user.id, { visibility: "MUTUAL" });
    const friend = await createUser("Соня");
    await connect(user.id, friend.id);

    await createLove(room.id, "Спрятана от гостей", { hidden: true });
    await createLove(room.id, "Спрятана глазком", { hiddenFromHall: true });
    await createLove(room.id, "Из выключенной зоны", { zone: "perfume" });
    await prisma.room.update({ where: { id: room.id }, data: { zonesOff: ["perfume"] } });

    const hall = await getGuestHall(room.shareSlug, friend.id);
    expect(hall?.items.map((item) => item.title)).toEqual(["Браслет"]);
  });
});

describe("канал «занято» несёт hallOpen (вход «Сокровищница»)", () => {
  it("ответ канала совпадает с ответом двери — во всех трёх положениях", async () => {
    const { user, room } = await createRoom();
    const friend = await createUser("Соня");
    await connect(user.id, friend.id);
    const stranger = await createUser("Прохожий");

    const hallOpen = async (viewerUserId: string | null) =>
      (await takenForRoomSlug(room.shareSlug, [], { viewerUserId }))?.hallOpen;
    const doorOpen = async (viewerUserId: string | null) =>
      (await getGuestHall(room.shareSlug, viewerUserId)) !== null;

    for (const visibility of ["ALL", "MUTUAL", "NONE"] as const) {
      await setHallSettings(user.id, { visibility });
      for (const viewer of [null, friend.id, stranger.id, user.id]) {
        expect(await hallOpen(viewer), `${visibility} · зритель ${viewer ?? "аноним"}`).toBe(
          await doorOpen(viewer),
        );
      }
    }
  });

  it("хозяйке своей же ссылки вход открыт, а занятого для неё нет (тикет 41)", async () => {
    const { user, room } = await createRoom();
    await setHallSettings(user.id, { visibility: "NONE" });

    const taken = await takenForRoomSlug(room.shareSlug, [], { viewerUserId: user.id });
    expect(taken?.hallOpen).toBe(true);
    expect(taken?.itemIds).toEqual([]);
    expect(taken?.myBookingsCount).toBe(0);
  });

  it("неизвестный слаг — по-прежнему null, а не «закрытая витрина»", async () => {
    expect(await takenForRoomSlug("нет-такой-комнаты", [])).toBeNull();
  });
});

describe("вход на гостевой странице не ломает ISR", () => {
  it("положение витрины едет в гостевую вьюху комнаты свойством комнаты", async () => {
    const { user, room } = await createRoom();
    await setHallSettings(user.id, { visibility: "MUTUAL" });

    // Это свойство КОМНАТЫ, одинаковое для всех зрителей: страница /r/{slug}
    // остаётся полностраничным ISR и сессии не читает — личный ответ приходит
    // каналом «занято» (проверка выше).
    expect((await getGuestRoom(room.shareSlug))?.hallVisibility).toBe("MUTUAL");
  });
});
