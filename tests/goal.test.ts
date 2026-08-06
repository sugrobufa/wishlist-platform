// Тикет 44: копилка на мечту в зоне «Просто деньги» (ADR-0008).
//
// Копилка ведёт себя как складчина, и это самое опасное место продукта: она
// собирает ровно то, что инвариант №1 запрещает показывать хозяйке. Поэтому
// тесты здесь — не про «работает ли участие», а про ГРАНИЦУ:
//
//   1. хозяйке — цель и ничего больше: ни прогресса, ни сумм, ни участников,
//      ни имён (ни в сервисе, ни в DTO, ни в роуте — все три слоя канала);
//   2. в счётчике «N вещей уже забрали» копилка — ОДНА вещь при любом числе
//      участников;
//   3. имена участников до праздника не раскрываются нигде, а после —
//      только на экране «что подарили» (инвариант №2);
//   4. деньги — Decimal, никогда float;
//   5. хозяйка, открывшая свою же гостевую ссылку, прогресса не получает
//      (тот же приём, что у канала «занято», тикет 41).
//
// Образец — tests/owner-counter.test.ts: проверяем сервис на живой БД, DTO
// сериализацией ЦЕЛОГО объекта и роуты как их зовёт Next.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";

vi.mock("@/server/auth", () => ({ auth: vi.fn() }));

import { auth } from "@/server/auth";
import { prisma } from "../src/server/db";
import { bookItem } from "../src/server/services/bookings";
import { closeOccasion, getOccasionView } from "../src/server/services/occasions";
import {
  GUEST_PLEDGES_COOKIE,
  GoalError,
  cancelPledge,
  clearRoomGoal,
  getOwnerGoal,
  goalForRoomSlug,
  goalTakenCount,
  ownerTakenTotal,
  parseGuestPledgeTokens,
  pledgeToGoal,
  revealedPledges,
  setRoomGoal,
} from "../src/server/services/goal";
import { goalForGuest, goalForOwner } from "../src/server/dto/goal";
import { rooms as roomPresets, zoneKeysHiddenByProduct } from "../src/config/design";
import { GET as takenCountRoute } from "../src/app/api/v1/room/taken-count/route";
import {
  DELETE as guestGoalDelete,
  GET as guestGoalRoute,
  POST as guestGoalPost,
} from "../src/app/api/v1/rooms/[slug]/goal/route";
import { GET as ownerGoalRoute, PUT as ownerGoalPut } from "../src/app/api/v1/room/goal/route";

const TEST_EMAIL_DOMAIN = "@goal.test";

const authMock = vi.mocked(auth) as unknown as ReturnType<typeof vi.fn>;

async function createOwnerWithRoom(displayName = "Хозяйка") {
  const user = await prisma.user.create({
    data: { email: `goal-${randomUUID()}${TEST_EMAIL_DOMAIN}`, displayName },
  });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `goal-${randomUUID().slice(0, 12)}`,
    },
  });
  return { user, room };
}

async function createWantItem(roomId: string, zone = "jewelry") {
  return prisma.item.create({
    data: {
      roomId,
      zone,
      state: "WANT",
      title: `Вещь-${randomUUID().slice(0, 8)}`,
      price: "5000",
      currency: "RUB",
    },
  });
}

/** Комната с целью — самый частый сетап. */
async function roomWithGoal(amount = "45000") {
  const owner = await createOwnerWithRoom();
  await setRoomGoal(owner.user.id, { title: "на велосипед", amount, currency: "RUB" });
  return owner;
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
describe("зона «Просто деньги» включена (ADR-0008)", () => {
  it("список скрытых по ключу пуст, и money есть во всех десяти комнатах", () => {
    expect(zoneKeysHiddenByProduct).toEqual([]);
    expect(
      roomPresets.filter((room) => room.zones.some((zone) => zone.key === "money")),
    ).toHaveLength(10);
  });
});

// ---------------------------------------------------------------------------
describe("цель хозяйки: задать, изменить, убрать", () => {
  it("сумма приходит Decimal, валюта — отдельным полем", async () => {
    const owner = await createOwnerWithRoom();
    const goal = await setRoomGoal(owner.user.id, {
      title: "на велосипед",
      amount: "45000.50",
      currency: "rub",
    });
    expect(goal.amount).toBeInstanceOf(Prisma.Decimal);
    expect(goal.amount.toString()).toBe("45000.5");
    expect(goal.currency).toBe("RUB"); // ISO 4217, приведена к верхнему регистру
  });

  it("копейки не теряются на float: 0.1 + 0.2 остаётся точным", async () => {
    const owner = await createOwnerWithRoom();
    const goal = await setRoomGoal(owner.user.id, { title: "на кофе", amount: "0.30" });
    // Ровно то, ради чего деньги — Decimal: 0.1 + 0.2 в float даёт 0.30000000000000004.
    expect(goal.amount.plus(new Prisma.Decimal("0.1")).toString()).toBe("0.4");
  });

  it("валюта берётся как у вещей комнаты, когда её не назвали", async () => {
    const owner = await createOwnerWithRoom();
    await prisma.item.createMany({
      data: [
        {
          roomId: owner.room.id,
          zone: "bags",
          state: "WANT",
          title: "Сумка",
          price: "100",
          currency: "EUR",
        },
        {
          roomId: owner.room.id,
          zone: "bags",
          state: "WANT",
          title: "Ремень",
          price: "50",
          currency: "EUR",
        },
        {
          roomId: owner.room.id,
          zone: "bags",
          state: "WANT",
          title: "Шарф",
          price: "70",
          currency: "RUB",
        },
      ],
    });
    const goal = await setRoomGoal(owner.user.id, { title: "на поездку", amount: "1000" });
    expect(goal.currency).toBe("EUR");
  });

  it("цель одна на комнату: повторный вызов меняет её, а не заводит вторую", async () => {
    const owner = await roomWithGoal();
    await setRoomGoal(owner.user.id, { title: "на хороший велосипед", amount: "60000" });
    expect(await prisma.roomGoal.count({ where: { roomId: owner.room.id } })).toBe(1);
    expect((await getOwnerGoal(owner.user.id))?.title).toBe("на хороший велосипед");
  });

  it("смена цели НЕ стирает чужие обещания", async () => {
    const owner = await roomWithGoal();
    await pledgeToGoal(owner.room.shareSlug, { name: "Гостья", amount: "1000" });
    await setRoomGoal(owner.user.id, { title: "на очень хороший велосипед", amount: "60000" });
    expect(await goalTakenCount(owner.room.id)).toBe(1);
  });

  it("ноль, минус и мусор в сумме — отказ; убрать цель идемпотентно", async () => {
    const owner = await roomWithGoal();
    for (const amount of ["0", "-5", "не число"]) {
      await expect(setRoomGoal(owner.user.id, { title: "на что-то", amount })).rejects.toThrow();
    }
    expect(await clearRoomGoal(owner.user.id)).toBe(true);
    expect(await clearRoomGoal(owner.user.id)).toBe(false); // повтор — тихий no-op
    expect(await getOwnerGoal(owner.user.id)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ГЛАВНОЕ. Инвариант №1 на копилке.
// ---------------------------------------------------------------------------
describe("ИНВАРИАНТ №1: хозяйка не видит ни прогресса, ни участников, ни сумм", () => {
  it("сервис хозяйки при пяти участниках отдаёт только цель — ни следа сбора", async () => {
    const owner = await roomWithGoal();
    // Суммы нарочно «непохожие» на цель 45000: подстрока «5000» внутри неё
    // сделала бы проверку ниже неотличимой от совпадения по случайности.
    const promised = ["1111", "2222", "3333", "4444", "5555"];
    for (const [index, name] of ["Аня", "Оля", "Ира", "Катя", "Маша"].entries()) {
      await pledgeToGoal(owner.room.shareSlug, {
        name: `${name} Секретова`,
        email: `secret-${index}@mail.test`,
        amount: promised[index],
      });
    }

    const view = await getOwnerGoal(owner.user.id);
    // toEqual пиноит форму ЦЕЛИКОМ: кроме трёх полей цели, в ней нет ничего.
    expect(view).toEqual({ title: "на велосипед", amount: "45000", currency: "RUB" });

    const serialized = JSON.stringify(view);
    expect(serialized).not.toMatch(/pledg|participant|percent|progress|collected|mine/i);
    expect(serialized).not.toMatch(/Секретова|secret-|mail\.test/);
    // И ни одной обещанной суммы, и ни их суммы (16665), и ни числа участников.
    for (const amount of [...promised, "16665"]) {
      expect(serialized, amount).not.toContain(amount);
    }
  });

  it("DTO хозяйки не пропускает прогресс, даже когда участия загружены в объект", async () => {
    const owner = await roomWithGoal();
    await pledgeToGoal(owner.room.shareSlug, { name: "Оля Секретова", amount: "7000" });

    // Настоящая строка БД с настоящим relation'ом — не синтетический объект.
    const polluted = await prisma.roomGoal.findUniqueOrThrow({
      where: { roomId: owner.room.id },
      include: { pledges: true },
    });
    expect(polluted.pledges[0]?.guestName).toBe("Оля Секретова"); // relation правда загружен

    const dto = goalForOwner(polluted);
    expect(JSON.stringify(dto)).not.toMatch(/pledge|guestName|Секретова|7000|cancelToken/i);
    expect(Object.keys(dto ?? {}).sort()).toEqual(["amount", "currency", "title"]);
  });

  it("роут хозяйки: GET и PUT отдают три поля цели и no-store", async () => {
    const owner = await roomWithGoal();
    await pledgeToGoal(owner.room.shareSlug, { name: "Гостья", amount: "9000" });
    authMock.mockResolvedValue({ user: { id: owner.user.id } });

    const response = await ownerGoalRoute();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      data: { goal: { title: "на велосипед", amount: "45000", currency: "RUB" } },
    });

    const put = await ownerGoalPut(
      new NextRequest("http://localhost/api/v1/room/goal", {
        method: "PUT",
        body: JSON.stringify({ title: "на самокат", amount: "20000", currency: "RUB" }),
      }),
    );
    expect(await put.json()).toEqual({
      data: { goal: { title: "на самокат", amount: "20000", currency: "RUB" } },
    });
  });

  it("без сессии роут хозяйки молчит: 401 и no-store", async () => {
    authMock.mockResolvedValue(null);
    const response = await ownerGoalRoute();
    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("та же гостевая ссылка САМОЙ хозяйке прогресса не даёт (ADR-0007)", async () => {
    const owner = await roomWithGoal();
    await pledgeToGoal(owner.room.shareSlug, { name: "Гостья", amount: "12345" });

    const asOwner = await goalForRoomSlug(owner.room.shareSlug, [], {
      viewerUserId: owner.user.id,
    });
    expect(asOwner).toEqual({
      viewer: "owner",
      goal: { title: "на велосипед", amount: "45000", currency: "RUB" },
    });
    expect(JSON.stringify(asOwner)).not.toContain("12345");

    // …а гостю по той же ссылке прогресс виден — ЧЕСТНАЯ граница, не защита.
    const asGuest = await goalForRoomSlug(owner.room.shareSlug);
    expect(asGuest?.viewer).toBe("guest");
    expect(asGuest?.goal).toMatchObject({ pledged: "12345", participants: 1 });
  });

  it("своя копилка не пополняется: хозяйке отказ OWN_GOAL", async () => {
    const owner = await roomWithGoal();
    await expect(
      pledgeToGoal(owner.room.shareSlug, { name: "Я сама" }, { sessionUserId: owner.user.id }),
    ).rejects.toMatchObject({ code: "OWN_GOAL" });
  });
});

// ---------------------------------------------------------------------------
describe("ИНВАРИАНТ №1: копилка — ОДНА вещь в счётчике при любом числе участников", () => {
  it("пять участников прибавляют к счётчику ровно единицу", async () => {
    const owner = await roomWithGoal();
    const a = await createWantItem(owner.room.id, "jewelry");
    const b = await createWantItem(owner.room.id, "bags");
    await bookItem({ itemId: a.id, name: "Первая Гостья" });
    await bookItem({ itemId: b.id, name: "Второй Гость" });
    expect(await ownerTakenTotal(owner.user.id)).toBe(2); // копилка пока пуста

    for (const name of ["Аня", "Оля", "Ира", "Катя", "Маша"]) {
      await pledgeToGoal(owner.room.shareSlug, { name, amount: "1000" });
    }
    expect(await prisma.goalPledge.count({ where: { goal: { roomId: owner.room.id } } })).toBe(5);
    // 2 вещи + копилка одной вещью = 3. НЕ 7.
    expect(await ownerTakenTotal(owner.user.id)).toBe(3);
    expect(await goalTakenCount(owner.room.id)).toBe(1);
  });

  it("счётчик убывает: ушёл последний участник — копилка снова не в счёте", async () => {
    const owner = await roomWithGoal();
    const first = await pledgeToGoal(owner.room.shareSlug, { name: "Аня", amount: "1000" });
    const second = await pledgeToGoal(owner.room.shareSlug, { name: "Оля" });
    expect(await ownerTakenTotal(owner.user.id)).toBe(1);

    await cancelPledge(first.cancelToken);
    expect(await ownerTakenTotal(owner.user.id)).toBe(1); // один остался — всё ещё 1
    await cancelPledge(second.cancelToken);
    expect(await ownerTakenTotal(owner.user.id)).toBe(0);
  });

  it("роут счётчика отдаёт то же число и по-прежнему ГОЛОЕ", async () => {
    const owner = await roomWithGoal();
    const item = await createWantItem(owner.room.id);
    await bookItem({ itemId: item.id, name: "Гостья" });
    for (const name of ["Аня", "Оля", "Ира"]) {
      await pledgeToGoal(owner.room.shareSlug, { name, amount: "3000" });
    }

    authMock.mockResolvedValue({ user: { id: owner.user.id } });
    const response = await takenCountRoute();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    // toEqual пиноит форму: 1 вещь + копилка = 2, и в ответе больше ничего.
    expect(await response.json()).toEqual({ data: { takenCount: 2 } });
  });

  it("чужая копилка в счёт не идёт", async () => {
    const owner = await roomWithGoal();
    const neighbour = await roomWithGoal();
    await pledgeToGoal(neighbour.room.shareSlug, { name: "Гость соседки", amount: "1000" });
    expect(await ownerTakenTotal(owner.user.id)).toBe(0);
    expect(await ownerTakenTotal(neighbour.user.id)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("гость: цель, прогресс и «N человек уже скинулись» — без единого имени", () => {
  it("прогресс считается на Decimal; участие без суммы считается человеком", async () => {
    const owner = await roomWithGoal("10000");
    await pledgeToGoal(owner.room.shareSlug, { name: "Аня", amount: "3000.10" });
    await pledgeToGoal(owner.room.shareSlug, { name: "Оля", amount: "0.20" });
    await pledgeToGoal(owner.room.shareSlug, { name: "Ира" }); // без суммы

    const channel = await goalForRoomSlug(owner.room.shareSlug);
    expect(channel).toEqual({
      viewer: "guest",
      goal: {
        title: "на велосипед",
        amount: "10000",
        currency: "RUB",
        // 3000.10 + 0.20 = 3000.3 (на float вышло бы 3000.3000000000002).
        pledged: "3000.3",
        participants: 3,
        percent: 30,
        mine: false,
      },
    });
  });

  it("имён участников в гостевом ответе нет ни одного", async () => {
    const owner = await roomWithGoal();
    await pledgeToGoal(owner.room.shareSlug, {
      name: "Секретная Гостья",
      email: "top-secret@mail.test",
      amount: "5000",
    });
    const channel = await goalForRoomSlug(owner.room.shareSlug);
    const serialized = JSON.stringify(channel);
    expect(serialized).not.toMatch(/Секретная|top-secret|mail\.test|cancelToken|guestName/i);
  });

  it("percent зажат в 0…100: перебор по цели полосой длиннее полосы не рисуется", async () => {
    const owner = await roomWithGoal("1000");
    await pledgeToGoal(owner.room.shareSlug, { name: "Щедрый Гость", amount: "5000" });
    const channel = await goalForRoomSlug(owner.room.shareSlug);
    expect(channel?.goal).toMatchObject({ pledged: "5000", percent: 100 });
  });

  it("mine — по своему же токену, и он не рассказывает о чужих", async () => {
    const owner = await roomWithGoal();
    const mine = await pledgeToGoal(owner.room.shareSlug, { name: "Я", amount: "1000" });
    await pledgeToGoal(owner.room.shareSlug, { name: "Не я", amount: "2000" });

    const withToken = await goalForRoomSlug(owner.room.shareSlug, [mine.cancelToken]);
    expect(withToken?.goal).toMatchObject({ mine: true, participants: 2 });
    const without = await goalForRoomSlug(owner.room.shareSlug, ["0".repeat(48)]);
    expect(without?.goal).toMatchObject({ mine: false, participants: 2 });
  });

  it("второе обещание того же гостя не заводится — «N человек» остаётся про людей", async () => {
    const owner = await roomWithGoal();
    const first = await pledgeToGoal(owner.room.shareSlug, { name: "Аня", amount: "1000" });
    await expect(
      pledgeToGoal(
        owner.room.shareSlug,
        { name: "Аня", amount: "1000" },
        { tokens: [first.cancelToken] },
      ),
    ).rejects.toMatchObject({ code: "ALREADY_PLEDGED" });
  });

  it("цели нет — участвовать не в чем; комнаты нет — 404 сервиса", async () => {
    const owner = await createOwnerWithRoom();
    await expect(pledgeToGoal(owner.room.shareSlug, { name: "Гость" })).rejects.toMatchObject({
      code: "NO_GOAL",
    });
    expect(await goalForRoomSlug("не-такой-слаг")).toBeNull();
    await expect(pledgeToGoal("не-такой-слаг", { name: "Гость" })).rejects.toBeInstanceOf(
      GoalError,
    );
  });

  it("чужим токеном участие не снять", async () => {
    const owner = await roomWithGoal();
    await pledgeToGoal(owner.room.shareSlug, { name: "Аня", amount: "1000" });
    await expect(cancelPledge("f".repeat(48))).rejects.toMatchObject({ code: "TOKEN_NOT_FOUND" });
    expect(await goalTakenCount(owner.room.id)).toBe(1);
  });

  it("DTO гостя ничего не выдумывает при пустой копилке", async () => {
    const owner = await roomWithGoal("1000");
    const goal = await prisma.roomGoal.findUniqueOrThrow({ where: { roomId: owner.room.id } });
    expect(goalForGuest(goal, [])).toEqual({
      title: "на велосипед",
      amount: "1000",
      currency: "RUB",
      pledged: "0",
      participants: 0,
      percent: 0,
      mine: false,
    });
  });
});

// ---------------------------------------------------------------------------
describe("гостевой роут копилки: cookie, коды, no-store", () => {
  const slugCtx = (slug: string) => ({ params: Promise.resolve({ slug }) });

  /** Запрос канала: cookie участия опциональна, как в проде. */
  function goalRequest(
    slug: string,
    init: { method?: string; body?: string } = {},
    tokens?: string[],
  ) {
    const headers = new Headers();
    if (tokens) {
      headers.set(
        "cookie",
        `${GUEST_PLEDGES_COOKIE}=${encodeURIComponent(JSON.stringify(tokens))}`,
      );
    }
    return new NextRequest(`http://localhost/api/v1/rooms/${slug}/goal`, { ...init, headers });
  }

  beforeEach(() => {
    authMock.mockReset();
    authMock.mockResolvedValue(null);
  });

  it("POST кладёт токен в HTTP-only cookie, GET по ней отвечает mine: true", async () => {
    const owner = await roomWithGoal();
    const posted = await guestGoalPost(
      goalRequest(owner.room.shareSlug, {
        method: "POST",
        body: JSON.stringify({ name: "Аня", amount: "1000" }),
      }),
      slugCtx(owner.room.shareSlug),
    );
    expect(posted.status).toBe(201);
    expect(posted.headers.get("cache-control")).toBe("no-store");

    const cookie = posted.cookies.get(GUEST_PLEDGES_COOKIE);
    expect(cookie?.httpOnly).toBe(true);
    const tokens = parseGuestPledgeTokens(cookie?.value);
    expect(tokens).toHaveLength(1);

    const got = await guestGoalRoute(
      goalRequest(owner.room.shareSlug, {}, tokens),
      slugCtx(owner.room.shareSlug),
    );
    const payload = (await got.json()) as { data: { viewer: string; goal: { mine: boolean } } };
    expect(payload.data.viewer).toBe("guest");
    expect(payload.data.goal.mine).toBe(true);

    // DELETE по той же cookie — участие снято, cookie почищена.
    const deleted = await guestGoalDelete(
      goalRequest(owner.room.shareSlug, { method: "DELETE" }, tokens),
      slugCtx(owner.room.shareSlug),
    );
    expect(deleted.status).toBe(200);
    expect(parseGuestPledgeTokens(deleted.cookies.get(GUEST_PLEDGES_COOKIE)?.value)).toEqual([]);
    expect(await goalTakenCount(owner.room.id)).toBe(0);
  });

  it("неизвестный слаг → 404, тело — не JSON → 400", async () => {
    const missing = await guestGoalRoute(goalRequest("нет-такой"), slugCtx("нет-такой"));
    expect(missing.status).toBe(404);

    const owner = await roomWithGoal();
    const broken = await guestGoalPost(
      goalRequest(owner.room.shareSlug, { method: "POST", body: "не json" }),
      slugCtx(owner.room.shareSlug),
    );
    expect(broken.status).toBe(400);
  });

  it("DELETE без своего участия → 404, чужое участие цело", async () => {
    const owner = await roomWithGoal();
    await pledgeToGoal(owner.room.shareSlug, { name: "Чужая Аня", amount: "1000" });
    const response = await guestGoalDelete(
      goalRequest(owner.room.shareSlug, { method: "DELETE" }),
      slugCtx(owner.room.shareSlug),
    );
    expect(response.status).toBe(404);
    expect(await goalTakenCount(owner.room.id)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
describe("ИНВАРИАНТ №2: имена участников раскрываются только в «что подарили»", () => {
  it("до закрытия праздника имён нет нигде — ни в одном ответе хозяйке", async () => {
    const owner = await roomWithGoal();
    await pledgeToGoal(owner.room.shareSlug, { name: "Аня Секретова", amount: "1000" });
    await pledgeToGoal(owner.room.shareSlug, { name: "Оля Тайная", amount: "2000" });

    const view = await getOccasionView(owner.user.id);
    expect(view.summary).toBeNull();
    expect(view.goal).toBeNull(); // копилки на экране до праздника нет вовсе
    const serialized = JSON.stringify([view, await getOwnerGoal(owner.user.id)]);
    expect(serialized).not.toMatch(/Секретова|Тайная|1000|2000|3000/);
  });

  it("после закрытия праздника — имена, сумма и цель, вместе с дарителями", async () => {
    const owner = await roomWithGoal();
    await pledgeToGoal(owner.room.shareSlug, { name: "Аня Секретова", amount: "1000" });
    await pledgeToGoal(owner.room.shareSlug, { name: "Оля Тайная" }); // без суммы
    await closeOccasion(owner.room.id, { manual: true });

    const view = await getOccasionView(owner.user.id);
    expect(view.summary).not.toBeNull();
    expect(view.goal).toEqual({
      title: "на велосипед",
      pledged: "1000",
      currency: "RUB",
      givers: ["Аня Секретова", "Оля Тайная"], // порядок — как скидывались
    });
  });

  it("копилка без единого участника на экран итога не выходит", async () => {
    const owner = await roomWithGoal();
    await closeOccasion(owner.room.id, { manual: true });
    expect((await getOccasionView(owner.user.id)).goal).toBeNull();
  });

  it("revealedPledges — единственный экспорт сервиса с именами", async () => {
    const owner = await roomWithGoal();
    await pledgeToGoal(owner.room.shareSlug, { name: "Аня Секретова", amount: "1000" });
    expect(await revealedPledges(owner.room.id)).toEqual([
      { name: "Аня Секретова", amount: "1000", currency: "RUB" },
    ]);
    // Ни один другой ответ сервиса имени не содержит — три главные двери.
    const doors = JSON.stringify([
      await getOwnerGoal(owner.user.id),
      await goalForRoomSlug(owner.room.shareSlug),
      await goalForRoomSlug(owner.room.shareSlug, [], { viewerUserId: owner.user.id }),
    ]);
    expect(doors).not.toContain("Секретова");
  });
});

// ---------------------------------------------------------------------------
describe("границы копилки: не вещь и не режим брони", () => {
  it("цель не появляется среди вещей комнаты — ни в зале славы, ни в агрегатах", async () => {
    const owner = await roomWithGoal();
    // Единственная проверка, которая нужна: цель живёт в своей таблице, а
    // вещей у комнаты нет вовсе. Всё остальное (зал славы, сводка зоны,
    // «Дошло») ходит через Item и физически цель увидеть не может.
    expect(await prisma.item.count({ where: { roomId: owner.room.id } })).toBe(0);
    expect(await prisma.roomGoal.count({ where: { roomId: owner.room.id } })).toBe(1);
  });

  it("складчина BookingMode.POOL по-прежнему Phase 2 — копилка её не открыла", async () => {
    const owner = await createOwnerWithRoom();
    const item = await createWantItem(owner.room.id);
    await expect(bookItem({ itemId: item.id, name: "Гость", mode: "POOL" })).rejects.toMatchObject({
      code: "POOL_NOT_SUPPORTED",
    });
  });

  it("комната уезжает — копилка и обещания уходят каскадом", async () => {
    const owner = await roomWithGoal();
    await pledgeToGoal(owner.room.shareSlug, { name: "Аня", amount: "1000" });
    await prisma.user.delete({ where: { id: owner.user.id } });
    expect(await prisma.roomGoal.count({ where: { roomId: owner.room.id } })).toBe(0);
    expect(await prisma.goalPledge.count({ where: { goal: { roomId: owner.room.id } } })).toBe(0);
  });
});
