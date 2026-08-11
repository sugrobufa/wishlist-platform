// Праздники комнаты в БД (тикет 198): ответы на плашку, свои поводы и тот
// единственный праздник, что виден в комнате.
//
// Календарь проверен отдельно и без базы (tests/occasion-offer.test.ts) — здесь
// проверяется ШОВ: что ответ хозяйки правда доезжает до строки, что «Не в этом
// году» молчит ровно до следующего года, и что комната при шести праздниках
// показывает один.
//
// ИНВАРИАНТ №2 ПОД ЗАМКОМ И ЗДЕСЬ: праздников стало больше, а имя дарителя
// по-прежнему пишет одна `receiveGift` — сервис праздников её не зовёт и в неё
// не заходит.
import "dotenv/config";
import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { prisma } from "../src/server/db";
import {
  RoomOccasionError,
  acceptHoliday,
  addOwnOccasion,
  listRoomOccasions,
  nearestRoomOccasion,
  occasionOffer,
  removeOccasion,
  skipHoliday,
} from "../src/server/services/room-occasions";

const TEST_EMAIL_DOMAIN = "@room-occasions.test";
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

async function createOwner(birthday: { day: number; month: number } | null = null) {
  const user = await prisma.user.create({
    data: { email: `owner-${randomUUID()}${TEST_EMAIL_DOMAIN}`, displayName: "Хозяйка" },
  });
  await prisma.room.create({
    data: {
      userId: user.id,
      preset: "cream",
      zoneSet: "F",
      shareSlug: `ro-${randomUUID().slice(0, 12)}`,
      birthdayDay: birthday?.day ?? null,
      birthdayMonth: birthday?.month ?? null,
    },
  });
  return user.id;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: TEST_EMAIL_DOMAIN } } });
  await prisma.$disconnect();
});

describe("ответы на плашку доезжают до строки", () => {
  it("«Показать» — дата принята, и предлагать её больше нечего", async () => {
    const userId = await createOwner();
    expect((await occasionOffer(userId, day("2026-02-20")))?.holiday.key).toBe("feb23");

    await acceptHoliday(userId, "march8");
    // 8 марта теперь праздник комнаты, а плашка досталась 23 февраля — оно
    // ещё не отвечено.
    expect((await occasionOffer(userId, day("2026-02-20")))?.holiday.key).toBe("feb23");
    await acceptHoliday(userId, "feb23");
    expect(await occasionOffer(userId, day("2026-02-20"))).toBeNull();

    const nearest = await nearestRoomOccasion(userId, day("2026-02-20"));
    expect(nearest?.key).toBe("feb23");
    expect(nearest?.date).toEqual(day("2026-02-23"));
  });

  it("«Показать» дважды — одна строка, а не две", async () => {
    const userId = await createOwner();
    await acceptHoliday(userId, "newYear");
    await acceptHoliday(userId, "newYear");
    const { rows } = await listRoomOccasions(userId);
    expect(rows).toHaveLength(1);
  });

  it("«Не в этом году» — молчит до следующего года и не заводит праздника", async () => {
    const userId = await createOwner();
    await skipHoliday(userId, "march8", day("2026-02-25"));

    expect(await occasionOffer(userId, day("2026-02-25"))).toBeNull();
    expect(await occasionOffer(userId, day("2026-03-07"))).toBeNull();
    // Отказ — ответ про ПЛАШКУ, а не праздник: в комнате его нет.
    expect(await nearestRoomOccasion(userId, day("2026-02-25"))).toBeNull();
    // Через год спрашиваем снова.
    expect((await occasionOffer(userId, day("2027-02-25")))?.holiday.key).toBe("march8");
  });

  it("отказ и принятие пишутся в одну строку: ответ последний, а не первый", async () => {
    const userId = await createOwner();
    await skipHoliday(userId, "feb23", day("2026-02-10"));
    expect(await nearestRoomOccasion(userId, day("2026-02-10"))).toBeNull();
    await acceptHoliday(userId, "feb23");
    expect((await listRoomOccasions(userId)).rows).toHaveLength(1);
    expect((await nearestRoomOccasion(userId, day("2026-02-10")))?.key).toBe("feb23");
  });

  it("чужой ключ праздником не становится", async () => {
    const userId = await createOwner();
    await expect(acceptHoliday(userId, "halloween")).rejects.toBeInstanceOf(RoomOccasionError);
    expect((await listRoomOccasions(userId)).rows).toHaveLength(0);
  });
});

describe("свой повод заводится там, где понадобился", () => {
  it("имя и дата — и он в комнате наравне с прочими", async () => {
    const userId = await createOwner();
    await addOwnOccasion(userId, { title: "Новоселье", day: 30, month: 6 });
    const nearest = await nearestRoomOccasion(userId, day("2026-06-01"));
    expect(nearest?.kind).toBe("own");
    expect(nearest?.title).toBe("Новоселье");
    expect(nearest?.date).toEqual(day("2026-06-30"));
  });

  it("своих поводов бывает сколько угодно — уникальность их не держит", async () => {
    const userId = await createOwner();
    await addOwnOccasion(userId, { title: "Годовщина", day: 2, month: 11 });
    await addOwnOccasion(userId, { title: "Выпускной", day: 25, month: 6 });
    await addOwnOccasion(userId, { title: "Новоселье", day: 30, month: 6 });
    expect((await listRoomOccasions(userId)).rows).toHaveLength(3);
  });

  it("своего повода без имени или с несуществующим днём не бывает", async () => {
    const userId = await createOwner();
    await expect(addOwnOccasion(userId, { title: "  ", day: 1, month: 5 })).rejects.toBeTruthy();
    await expect(
      addOwnOccasion(userId, { title: "Ничего", day: 31, month: 2 }),
    ).rejects.toBeInstanceOf(RoomOccasionError);
    expect((await listRoomOccasions(userId)).rows).toHaveLength(0);
  });

  it("29 февраля законно и у повода — год не спрашиваем ни у кого", async () => {
    const userId = await createOwner();
    await addOwnOccasion(userId, { title: "Годовщина", day: 29, month: 2 });
    // В невисокосный год праздник остаётся в своём месяце — 28-го.
    expect((await nearestRoomOccasion(userId, day("2026-01-05")))?.date).toEqual(day("2026-02-28"));
    expect((await nearestRoomOccasion(userId, day("2028-01-05")))?.date).toEqual(day("2028-02-29"));
  });

  it("убрать можно свой повод и принятую дату; чужую строку — нет", async () => {
    const userId = await createOwner();
    const mine = await addOwnOccasion(userId, { title: "Новоселье", day: 30, month: 6 });
    const strangerId = await createOwner();
    const stranger = await addOwnOccasion(strangerId, { title: "Чужое", day: 1, month: 7 });

    await expect(removeOccasion(userId, stranger.id)).rejects.toBeInstanceOf(RoomOccasionError);
    expect((await listRoomOccasions(strangerId)).rows).toHaveLength(1);

    await removeOccasion(userId, mine.id);
    expect((await listRoomOccasions(userId)).rows).toHaveLength(0);
  });
});

describe("в комнате виден ровно один праздник при любом их числе", () => {
  it("шесть праздников — одна строка в кадре", async () => {
    const userId = await createOwner({ day: 14, month: 9 });
    await acceptHoliday(userId, "newYear");
    await acceptHoliday(userId, "feb23");
    await acceptHoliday(userId, "march8");
    await addOwnOccasion(userId, { title: "Новоселье", day: 30, month: 6 });
    await addOwnOccasion(userId, { title: "Годовщина", day: 2, month: 11 });

    // Шесть праздников на комнату — и один ответ.
    const { birthday, rows } = await listRoomOccasions(userId);
    expect(birthday).not.toBeNull();
    expect(rows).toHaveLength(5);

    const nearest = await nearestRoomOccasion(userId, day("2026-08-11"));
    expect(nearest?.kind).toBe("birthday");
    expect(nearest?.date).toEqual(day("2026-09-14"));
    // И он меняется сам, без единого нажатия.
    expect((await nearestRoomOccasion(userId, day("2026-09-15")))?.title).toBe("Годовщина");
    expect((await nearestRoomOccasion(userId, day("2026-11-03")))?.key).toBe("newYear");
  });

  it("праздников нет вовсе — комната молчит, и это законно", async () => {
    const userId = await createOwner();
    expect(await nearestRoomOccasion(userId, day("2026-08-11"))).toBeNull();
  });
});

describe("инвариант №2: раскрытие имени сервис праздников не трогает", () => {
  it("ни receiveGift, ни giverName, ни revealedAt в нём не зовутся", () => {
    const source = readFileSync(
      fileURLToPath(new URL("../src/server/services/room-occasions.ts", import.meta.url)),
      "utf8",
    );
    // Комментарии выброшены нарочно: в шапке файла `receiveGift` НАЗВАНА — она
    // и есть та единственная функция, что пишет имя, и сказать это словами
    // полезно. Проверяется КОД: ни вызова, ни поля, ни импорта.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//gu, " ")
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/u, ""))
      .join("\n");
    for (const forbidden of ["receiveGift", "giverName", "revealedAt", "booking", "Booking"]) {
      expect(code, `сервис праздников трогает ${forbidden}`).not.toContain(forbidden);
    }
    expect(code).not.toContain("services/occasions");
  });
});
