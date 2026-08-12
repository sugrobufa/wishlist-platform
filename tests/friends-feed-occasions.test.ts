// ЛЕНТА ДРУЗЕЙ СЧИТАЕТ ПРАЗДНИКИ ЛЮБОГО ВИДА (тикет 204).
//
// Тикет 198 завёл три вида праздника — день рождения, общие даты и свой повод,
// — а лента продолжала считать только день рождения. Отсюда два следствия, и
// второе тяжелее первого:
//
// 1. комната и лента давали РАЗНЫЕ ответы на один вопрос: у себя человек видел
//    «Новый год · 31 декабря», а друг в ленте — его день рождения в марте;
// 2. у комнаты БЕЗ дня рождения («Пока не знаю» есть в онбординге и работает),
//    но с принятым общим праздником, в ленте не было НИЧЕГО — она молчала ровно
//    там, ради чего существует.
//
// Здесь проверяется четвёртое, чего кодом не видно: **лента не ходит в БД за
// каждой строкой.** Запрос на строку заводится незаметно и живёт годами, а
// заметен становится на двадцатом друге.
//
// ИНВАРИАНТ №1 НЕ ЗАДЕТ И ЗДЕСЬ: праздник — не бронь. Лента как не говорила о
// том, что и кем занято, так и не говорит; рядом с праздником стоит только
// гостевое «сколько ЕЩЁ можно подарить».
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/server/db";
import { isoDay, nextOccasion } from "../src/server/birthday";
import { listConnections, recordVisit } from "../src/server/services/connections";
import {
  acceptHoliday,
  addOwnOccasion,
  nearestRoomOccasion,
} from "../src/server/services/room-occasions";

const TEST_EMAIL_DOMAIN = "@feed-occasions.test";
const DAY_MS = 24 * 60 * 60 * 1000;

/** Человек с комнатой; день рождения задаётся или пропускается («Пока не знаю»). */
async function createPerson(displayName: string, birthday: { day: number; month: number } | null) {
  const user = await prisma.user.create({
    data: { email: `u-${randomUUID()}${TEST_EMAIL_DOMAIN}`, displayName },
  });
  const room = await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `fo-${randomUUID().slice(0, 12)}`,
      birthdayDay: birthday?.day ?? null,
      birthdayMonth: birthday?.month ?? null,
    },
  });
  return { userId: user.id, roomId: room.id, displayName };
}

/** День и месяц отметки — так их хранит комната (года у праздника нет). */
function dayMonthOf(date: Date): { day: number; month: number } {
  return { day: date.getUTCDate(), month: date.getUTCMonth() + 1 };
}

/** Строка ленты про этого человека. */
async function feedRoom(viewerUserId: string, displayName: string) {
  const rows = await listConnections(viewerUserId);
  return rows.find((row) => row.displayName === displayName)?.room ?? null;
}

// ---------------------------------------------------------------------------
// Счётчик запросов: «одним проходом» — не обещание в комментарии, а число
// ---------------------------------------------------------------------------
//
// Считаются ВСЕ операции клиента по ВСЕМ моделям — список моделей берётся у
// самой Prisma (`Prisma.ModelName`), а не выписывается руками: запрос на
// строку, заведённый завтра в другой модели, обязан ронять этот тест, а не
// проезжать мимо перечисления, которое забыли дополнить.
const MODEL_KEYS = Object.keys(Prisma.ModelName).map(
  (name) => name.charAt(0).toLowerCase() + name.slice(1),
);
const OPERATIONS = [
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "count",
  "groupBy",
  "aggregate",
  "create",
  "createMany",
  "update",
  "updateMany",
  "upsert",
  "delete",
  "deleteMany",
] as const;

type Delegate = Record<string, unknown>;

async function countQueries<T>(
  run: () => Promise<T>,
): Promise<{ result: T; total: number; byCall: Map<string, number> }> {
  const byCall = new Map<string, number>();
  const restore: Array<() => void> = [];
  let total = 0;

  for (const key of MODEL_KEYS) {
    const delegate = (prisma as unknown as Record<string, Delegate | undefined>)[key];
    if (!delegate) continue;
    for (const operation of OPERATIONS) {
      const original = delegate[operation];
      if (typeof original !== "function") continue;
      const name = `${key}.${operation}`;
      delegate[operation] = (...args: unknown[]) => {
        total += 1;
        byCall.set(name, (byCall.get(name) ?? 0) + 1);
        return (original as (...a: unknown[]) => unknown).apply(delegate, args);
      };
      restore.push(() => {
        delegate[operation] = original;
      });
    }
  }

  try {
    const result = await run();
    return { result, total, byCall };
  } finally {
    for (const undo of restore) undo();
  }
}

async function cleanup() {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
}

beforeAll(cleanup);
afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("лента берёт ближайший праздник ЛЮБОГО вида", () => {
  it("у комнаты БЕЗ дня рождения, но с принятым общим праздником, в ленте есть дата", async () => {
    // ГЛАВНЫЙ СЛУЧАЙ ТИКЕТА. Дату рождения можно не заводить — «Пока не знаю»
    // работает; такой человек принял 8 марта, комната его ждёт, а лента до
    // тикета 204 отдавала `null` и уводила карточку в раздел «Без даты».
    const me = await createPerson("Смотрящий-1", null);
    const her = await createPerson("Ирина-без-рождения", null);
    await acceptHoliday(her.userId, "march8");
    // Я был в её комнате — только тогда мне положена карточка с кадром
    // (тикет 95, инвариант №7).
    await recordVisit(me.userId, her.userId);

    const room = await feedRoom(me.userId, her.displayName);
    expect(room?.occasion).toEqual({
      date: isoDay(nextOccasion({ day: 8, month: 3, year: null }, new Date())),
      kind: "common",
      key: "march8",
      title: null,
    });
  });

  it("комната и лента отвечают ОДНО И ТО ЖЕ — два источника сверяются напрямую", async () => {
    // У неё есть всё сразу: день рождения через сорок дней, принятый Новый год
    // и свой повод завтра. Ближайшим он не будет НИКОГДА — до дня рождения
    // сорок суток, а до чего-то из остального не больше одних, — и до тикета
    // 204 лента отвечала бы именно им, то есть не тем, что видит сама комната.
    const now = new Date();
    const birthday = dayMonthOf(new Date(now.getTime() + 40 * DAY_MS));
    const tomorrow = dayMonthOf(new Date(now.getTime() + DAY_MS));

    const me = await createPerson("Смотрящий-2", null);
    const her = await createPerson("Аня-со-всеми-праздниками", birthday);
    await acceptHoliday(her.userId, "newYear");
    await addOwnOccasion(her.userId, { title: "Годовщина", ...tomorrow });
    await recordVisit(me.userId, her.userId);

    // Комната спрашивается своей функцией, лента — своей; ожидание не
    // переписывается руками, сравниваются два ответа.
    const inRoom = await nearestRoomOccasion(her.userId);
    const inFeed = await feedRoom(me.userId, her.displayName);
    expect(inRoom).not.toBeNull();
    expect(inFeed?.occasion).toEqual({
      date: isoDay(inRoom!.date),
      kind: inRoom!.kind,
      key: inRoom!.key,
      title: inRoom!.title,
    });
    // И это правда не день рождения: прежняя лента ответила бы им.
    expect(inFeed?.occasion?.kind).not.toBe("birthday");
    expect(inFeed?.occasion?.date).not.toBe(
      isoDay(nextOccasion({ ...birthday, year: null }, now)),
    );
  });

  it("имя своего повода доезжает до строки ленты", async () => {
    // Ни дня рождения, ни принятых общих дат — один свой повод завтра, и он же
    // ближайший при любом дне в году. Имя его писала сама хозяйка: словарём
    // такое не назвать, оно едет строкой.
    const now = new Date();
    const tomorrow = dayMonthOf(new Date(now.getTime() + DAY_MS));

    const me = await createPerson("Смотрящий-3", null);
    const her = await createPerson("Оля-с-годовщиной", null);
    await addOwnOccasion(her.userId, { title: "Годовщина", ...tomorrow });
    await recordVisit(me.userId, her.userId);

    const room = await feedRoom(me.userId, her.displayName);
    expect(room?.occasion).toEqual({
      date: isoDay(nextOccasion({ ...tomorrow, year: null }, now)),
      kind: "own",
      key: null,
      title: "Годовщина",
    });
  });

  it("день рождения остаётся, когда он и есть ближайший", async () => {
    // Обратная сторона: тикет не «заменил день рождения праздниками», он
    // спросил про ближайший. Рождение завтра — ближе него не бывает ничего.
    const now = new Date();
    const tomorrow = dayMonthOf(new Date(now.getTime() + DAY_MS));

    const me = await createPerson("Смотрящий-5", null);
    const her = await createPerson("Катя-с-рождением", tomorrow);
    await acceptHoliday(her.userId, "newYear");
    await recordVisit(me.userId, her.userId);

    const room = await feedRoom(me.userId, her.displayName);
    expect(room?.occasion).toEqual({
      date: isoDay(nextOccasion({ ...tomorrow, year: null }, now)),
      kind: "birthday",
      key: null,
      title: null,
    });
  });

  it("праздников нет вовсе — в ленте пусто, а не выдуманная дата", async () => {
    const me = await createPerson("Смотрящий-4", null);
    const her = await createPerson("Ника-без-праздников", null);
    await recordVisit(me.userId, her.userId);

    const room = await feedRoom(me.userId, her.displayName);
    expect(room).not.toBeNull();
    expect(room?.occasion).toBeNull();
  });
});

describe("лента считает праздники ОДНИМ проходом", () => {
  it("запросов столько же на одного друга и на четверых (N+1 не заведён)", async () => {
    const me = await createPerson("Считающий", null);

    const first = await createPerson("Друг-1", null);
    await acceptHoliday(first.userId, "newYear");
    await recordVisit(me.userId, first.userId);

    const one = await countQueries(() => listConnections(me.userId));
    expect(one.result).toHaveLength(1);

    for (const index of [2, 3, 4]) {
      const friend = await createPerson(`Друг-${index}`, { day: index, month: 9 });
      await acceptHoliday(friend.userId, "march8");
      await addOwnOccasion(friend.userId, { title: `Повод-${index}`, day: index, month: 5 });
      await recordVisit(me.userId, friend.userId);
    }

    const four = await countQueries(() => listConnections(me.userId));
    expect(four.result).toHaveLength(4);
    // Считали не «ничего»: праздник есть у каждой из четырёх строк.
    expect(four.result.every((row) => row.room?.occasion != null)).toBe(true);

    // ГЛАВНОЕ ЧИСЛО: рост списка вчетверо не добавил ни одного запроса.
    expect(four.total).toBe(one.total);
    // Счётчик жив (иначе равенство нулей ничего бы не значило), и запросов
    // на всю ленту три при любой её длине: связи, «сколько свободно»
    // (`item.groupBy`) и праздники.
    expect(one.total).toBe(3);
    // Праздники всех комнат приехали ровно одним запросом.
    expect(four.byCall.get("roomOccasion.findMany")).toBe(1);
    expect(one.byCall.get("roomOccasion.findMany")).toBe(1);
  });
});
