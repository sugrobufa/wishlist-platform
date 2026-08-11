// День рождения — повторяющаяся дата (тикет 187). Юнит без БД и без React:
// вся арифметика праздника живёт в одном модуле, и правила проверяются здесь,
// а не прокликиванием комнаты.
//
// Тест держит четыре обещания тикета:
// 1. дата прошлого года даёт ближайший праздник в следующем;
// 2. напоминание за три дня считается ОТ БЛИЖАЙШЕЙ даты, а не от сохранённой;
// 3. «праздник наступил» — это хвост, а не «когда-то в прошлом»: комната между
//    праздниками молчит;
// 4. 29 февраля существует и в невисокосный год.
import { describe, expect, it } from "vitest";
import {
  OCCASION_TAIL_DAYS,
  birthdayColumns,
  birthdayOf,
  daysInMonth,
  dueOccasion,
  dueOccasionKeys,
  isBirthday,
  nextOccasionDay,
  occasionKeysBetween,
  parseBirthday,
} from "../src/server/birthday";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("parseBirthday — две формы одного дня", () => {
  it("календарный день строкой: год берётся, если он в ней есть", () => {
    expect(parseBirthday("1990-03-08")).toEqual({ day: 8, month: 3, year: 1990 });
    expect(parseBirthday("2028-02-29")).toEqual({ day: 29, month: 2, year: 2028 });
  });

  it("день и месяц числами: год необязателен", () => {
    expect(parseBirthday({ day: 8, month: 3 })).toEqual({ day: 8, month: 3, year: null });
    expect(parseBirthday({ day: "8", month: "3", year: null })).toEqual({
      day: 8,
      month: 3,
      year: null,
    });
  });

  it("несуществующего дня не бывает ни с годом, ни без", () => {
    expect(parseBirthday("2026-02-29")).toBeNull(); // 2026-й не високосный
    expect(parseBirthday("2026-02-31")).toBeNull();
    expect(parseBirthday({ day: 31, month: 4 })).toBeNull();
    expect(parseBirthday({ day: 0, month: 3 })).toBeNull();
    expect(parseBirthday({ day: 8, month: 13 })).toBeNull();
    expect(parseBirthday("завтра")).toBeNull();
    expect(parseBirthday("2026-12-31T00:00:00.000Z")).toBeNull(); // момент, не день
    expect(parseBirthday(null)).toBeNull();
  });

  it("29 февраля БЕЗ года законно: високосность спрашивать не у чего", () => {
    expect(parseBirthday({ day: 29, month: 2 })).toEqual({ day: 29, month: 2, year: null });
    expect(daysInMonth(2, null)).toBe(29);
    expect(daysInMonth(2, 2026)).toBe(28);
    expect(daysInMonth(2, 2028)).toBe(29);
    expect(isBirthday({ day: 29, month: 2 })).toBe(true);
  });
});

describe("birthdayOf / birthdayColumns — комната и обратно", () => {
  it("день без месяца — не дата: комната ведёт себя как без праздника", () => {
    expect(birthdayOf({ birthdayDay: 8, birthdayMonth: null, birthdayYear: null })).toBeNull();
    expect(birthdayOf({ birthdayDay: null, birthdayMonth: 3, birthdayYear: null })).toBeNull();
  });

  it("мусор в колонках не роняет комнату — она просто без даты", () => {
    // Ручная правка БД: 31 февраля в строке. Падать на чтении из-за неё
    // нельзя — комната обязана открыться.
    expect(birthdayOf({ birthdayDay: 31, birthdayMonth: 2, birthdayYear: null })).toBeNull();
  });

  it("круг: колонки → дата → колонки", () => {
    const columns = { birthdayDay: 8, birthdayMonth: 3, birthdayYear: 1990 };
    expect(birthdayColumns(birthdayOf(columns))).toEqual(columns);
    expect(birthdayColumns(null)).toEqual({
      birthdayDay: null,
      birthdayMonth: null,
      birthdayYear: null,
    });
  });
});

describe("nextOccasion — ближайший праздник от сегодня", () => {
  const march8 = { day: 8, month: 3, year: null };

  it("ДАТА ПРОШЛОГО ГОДА ДАЁТ ПРАЗДНИК В СЛЕДУЮЩЕМ (проверка тикета)", () => {
    // Ровно то, чего не умела разовая отметка: она протухала молча.
    const birthday = { day: 8, month: 3, year: 1990 };
    expect(nextOccasionDay(birthday, new Date("2026-08-11T09:00:00.000Z"))).toBe("2027-03-08");
  });

  it("праздник впереди в этом же году — берётся он", () => {
    expect(nextOccasionDay(march8, new Date("2026-01-01T00:00:00.000Z"))).toBe("2026-03-08");
  });

  it("сегодняшний день рождения — ближайший: праздник идёт, а не прошёл", () => {
    expect(nextOccasionDay(march8, new Date("2026-03-08T23:59:59.000Z"))).toBe("2026-03-08");
  });

  it("вчерашний уже отдан следующему году", () => {
    expect(nextOccasionDay(march8, new Date("2026-03-09T00:00:00.000Z"))).toBe("2027-03-08");
  });

  it("31 декабря и 1 января: край года не съезжает на сутки", () => {
    expect(nextOccasionDay({ day: 31, month: 12, year: null }, new Date("2026-12-31T21:00:00.000Z"))).toBe(
      "2026-12-31",
    );
    expect(nextOccasionDay({ day: 1, month: 1, year: null }, new Date("2026-12-31T21:00:00.000Z"))).toBe(
      "2027-01-01",
    );
  });

  it("29 февраля в невисокосный год празднуется 28-го — последним днём февраля", () => {
    const leapling = { day: 29, month: 2, year: 2000 };
    expect(nextOccasionDay(leapling, new Date("2026-01-10T00:00:00.000Z"))).toBe("2026-02-28");
    // А в високосный — своим днём.
    expect(nextOccasionDay(leapling, new Date("2028-01-10T00:00:00.000Z"))).toBe("2028-02-29");
  });

  it("даты нет — ближайшего праздника тоже нет", () => {
    expect(nextOccasionDay(null, new Date())).toBeNull();
  });
});

describe("dueOccasion — наступивший праздник и его хвост", () => {
  const march8 = { day: 8, month: 3, year: null };

  it("сегодня и вчера — праздник наступил", () => {
    expect(dueOccasion(march8, new Date("2026-03-08T01:00:00.000Z"))?.toISOString()).toBe(
      "2026-03-08T00:00:00.000Z",
    );
    expect(dueOccasion(march8, new Date("2026-03-09T01:00:00.000Z"))?.toISOString()).toBe(
      "2026-03-08T00:00:00.000Z",
    );
  });

  it("полночь самого дня уже считается наступившей — воркер закроет итог в первый тик", () => {
    expect(dueOccasion(march8, new Date("2026-03-08T00:00:00.000Z"))?.toISOString()).toBe(
      "2026-03-08T00:00:00.000Z",
    );
  });

  it("край хвоста: две недели — ещё праздник, пятнадцатый день — уже нет", () => {
    const tailEnd = new Date(Date.UTC(2026, 2, 8) + OCCASION_TAIL_DAYS * DAY_MS + 3600_000);
    expect(dueOccasion(march8, tailEnd)).not.toBeNull();
    const afterTail = new Date(tailEnd.getTime() + DAY_MS);
    expect(dueOccasion(march8, afterTail)).toBeNull();
  });

  it("МЕЖДУ ПРАЗДНИКАМИ — null, а не «прошлогодний»", () => {
    // Без хвоста «дата прошла» у повторяющейся даты значило бы «прошла год
    // назад», и итог закрывался бы каждой комнате в первый же тик.
    expect(dueOccasion(march8, new Date("2026-08-11T09:00:00.000Z"))).toBeNull();
    // И за день ДО праздника — тоже ничего: он ещё не наступил.
    expect(dueOccasion(march8, new Date("2026-03-07T23:00:00.000Z"))).toBeNull();
  });

  it("праздник в начале года: наступивший ищется и в прошлом году", () => {
    const jan2 = { day: 2, month: 1, year: null };
    expect(dueOccasion(jan2, new Date("2027-01-05T10:00:00.000Z"))?.toISOString()).toBe(
      "2027-01-02T00:00:00.000Z",
    );
    const dec31 = { day: 31, month: 12, year: null };
    expect(dueOccasion(dec31, new Date("2027-01-05T10:00:00.000Z"))?.toISOString()).toBe(
      "2026-12-31T00:00:00.000Z",
    );
  });
});

describe("occasionKeysBetween — окно выборки в БД", () => {
  it("окно напоминаний — ровно три дня: завтра, послезавтра и третий", () => {
    const now = new Date("2026-08-11T09:00:00.000Z");
    const keys = occasionKeysBetween(now, new Date(now.getTime() + 3 * DAY_MS));
    expect(keys).toEqual([
      { month: 8, day: 12 },
      { month: 8, day: 13 },
      { month: 8, day: 14 },
    ]);
  });

  it("сегодняшний день в окно напоминаний не входит: праздник уже идёт", () => {
    const midnight = new Date("2026-08-11T00:00:00.000Z");
    const keys = occasionKeysBetween(midnight, new Date(midnight.getTime() + 3 * DAY_MS));
    expect(keys.some((key) => key.month === 8 && key.day === 11)).toBe(false);
    expect(keys).toHaveLength(3);
  });

  it("окно переваливает через месяц и через год", () => {
    const keys = occasionKeysBetween(
      new Date("2026-12-30T09:00:00.000Z"),
      new Date("2027-01-02T09:00:00.000Z"),
    );
    expect(keys).toEqual([
      { month: 12, day: 31 },
      { month: 1, day: 1 },
      { month: 1, day: 2 },
    ]);
  });

  it("28 февраля невисокосного года тянет за собой 29-е: иначе праздник потеряется", () => {
    const keys = occasionKeysBetween(
      new Date("2026-02-26T09:00:00.000Z"),
      new Date("2026-02-28T09:00:00.000Z"),
    );
    expect(keys).toContainEqual({ month: 2, day: 28 });
    expect(keys).toContainEqual({ month: 2, day: 29 });
  });

  it("хвост закрытия итога — сегодня и две недели назад", () => {
    const keys = dueOccasionKeys(new Date("2026-08-11T09:00:00.000Z"));
    expect(keys).toHaveLength(OCCASION_TAIL_DAYS + 1);
    expect(keys[0]).toEqual({ month: 7, day: 28 });
    expect(keys.at(-1)).toEqual({ month: 8, day: 11 });
  });
});
