// Праздники, которых не один (тикет 198, пакет 44 → `occasions.json`, турн 51e).
//
// Тест держит четыре обещания тикета, и все четыре — про КАЛЕНДАРЬ, а не про
// экран:
// 1. плашка приходит ровно за три недели и уходит по «Не в этом году» до
//    следующего года — на границах дат, включая високосный год;
// 2. **8 марта и 23 февраля предлагаются ОБА и ВСЕМ**: предложение не читает ни
//    набор зон, ни пол — и прочитать их ему неоткуда;
// 3. в комнате виден ровно один праздник при любом их числе;
// 4. предложение бывает одно, даже когда окна двух дат пересекаются.
//
// БЕЗ БД И БЕЗ РЕНДЕРА: календарь живёт отдельным модулем ровно затем, чтобы
// его правила проверялись арифметикой, а не прокликиванием комнаты.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  COMMON_HOLIDAYS,
  OFFER_LEAD_DAYS,
  daysUntil,
  holidayByKey,
  holidayOffer,
  isHolidayKey,
  nearestOccasion,
  nextHoliday,
  type HolidayAnswer,
  type HolidayKey,
  type RoomOccasion,
} from "../src/server/holidays";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

/** Полночь UTC названного дня — тем же поясом, каким праздник живёт везде. */
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
/** Полдень названного дня: время суток на «сегодня» влиять не должно. */
const noon = (iso: string) => new Date(`${iso}T12:00:00.000Z`);

const offeredKey = (now: Date, answers: readonly HolidayAnswer[] = []): HolidayKey | null =>
  holidayOffer(now, answers)?.holiday.key ?? null;

describe("три общие даты — список закрыт пакетом", () => {
  it("Новый год, 23 февраля и 8 марта, и ни одной сверх", () => {
    expect(COMMON_HOLIDAYS.map((holiday) => holiday.key)).toEqual(["newYear", "feb23", "march8"]);
    expect(COMMON_HOLIDAYS.map((holiday) => `${holiday.day}.${holiday.month}`)).toEqual([
      "1.1",
      "23.2",
      "8.3",
    ]);
  });

  it("чужой ключ общей датой не становится", () => {
    expect(isHolidayKey("march8")).toBe(true);
    expect(isHolidayKey("halloween")).toBe(false);
    expect(isHolidayKey(null)).toBe(false);
    expect(holidayByKey("halloween")).toBeNull();
  });

  it("три недели — это 21 сутки, и число одно на весь продукт", () => {
    expect(OFFER_LEAD_DAYS).toBe(21);
  });
});

/**
 * 8 марта проверяется на границе окна, а в эти же дни идёт окно 23 февраля —
 * и оно ближе. Чтобы граница ПЕРВОГО праздника не пряталась за вторым, 23
 * февраля в таких проверках уже принято: одна плашка на два кандидата — это
 * отдельная проверка ниже, здесь же речь про «ровно за три недели».
 */
const FEB23_ACCEPTED: HolidayAnswer[] = [{ key: "feb23", accepted: true, skippedYear: null }];

describe("плашка приходит ровно за три недели", () => {
  // 8 марта 2026-го: три недели назад — 15 февраля (в феврале 28 дней).
  it("за 21 сутки — есть, за 22 — ещё нет", () => {
    expect(daysUntil(day("2026-03-08"), day("2026-02-15"))).toBe(21);
    expect(offeredKey(day("2026-02-15"), FEB23_ACCEPTED)).toBe("march8");
    expect(offeredKey(day("2026-02-14"), FEB23_ACCEPTED)).toBeNull();
  });

  it("время суток «сегодня» не двигает: полночь и полдень одинаковы", () => {
    expect(offeredKey(noon("2026-02-15"), FEB23_ACCEPTED)).toBe("march8");
    expect(offeredKey(noon("2026-02-14"), FEB23_ACCEPTED)).toBeNull();
  });

  it("накануне — есть, в сам день праздника — уже нет", () => {
    expect(offeredKey(day("2026-03-07"))).toBe("march8");
    expect(holidayOffer(day("2026-03-07"), [])?.daysLeft).toBe(1);
    // Предложение «показать гостям, что комната ждёт подарков», сделанное утром
    // праздника, опоздало: гостям по нему уже не успеть.
    expect(offeredKey(day("2026-03-08"))).toBeNull();
  });

  it("ВЫСОКОСНЫЙ ГОД сдвигает границу на сутки, и это не опечатка", () => {
    // 29 дней в феврале 2028-го: те же три недели до 8 марта начинаются
    // 16 февраля, а не 15-го. Ровно то место, где «отнять 21 день» руками и
    // «спросить календарь» дают разные ответы.
    expect(daysUntil(day("2028-03-08"), day("2028-02-16"))).toBe(21);
    expect(daysUntil(day("2028-03-08"), day("2028-02-15"))).toBe(22);
    expect(offeredKey(day("2028-02-16"), FEB23_ACCEPTED)).toBe("march8");
    expect(offeredKey(day("2028-02-15"), FEB23_ACCEPTED)).toBeNull();
    // И тот же день в невисокосном году плашку уже показывает — разница на
    // сутки видна прямым сравнением, а не выводится из формулы.
    expect(offeredKey(day("2026-02-15"), FEB23_ACCEPTED)).toBe("march8");
  });

  it("23 февраля и Новый год — свои границы, и они от календаря, а не от нас", () => {
    // До 23 февраля три недели — всегда 2 февраля: в январе 31 день в любой год.
    expect(offeredKey(day("2026-02-02"))).toBe("feb23");
    expect(offeredKey(day("2026-02-01"))).toBeNull();
    expect(offeredKey(day("2028-02-02"))).toBe("feb23");
    // Новый год предлагается в ДЕКАБРЕ прошлого года — 11 декабря.
    expect(offeredKey(day("2026-12-11"))).toBe("newYear");
    expect(offeredKey(day("2026-12-10"))).toBeNull();
    expect(nextHoliday({ key: "newYear", month: 1, day: 1 }, day("2026-12-11"))).toEqual(
      day("2027-01-01"),
    );
  });

  it("между праздниками плашки нет вовсе", () => {
    for (const iso of ["2026-05-20", "2026-08-11", "2026-10-01"]) {
      expect(offeredKey(day(iso)), iso).toBeNull();
    }
  });
});

describe("«Не в этом году» — до следующего года, и молча", () => {
  const skipped = (year: number): HolidayAnswer[] => [
    ...FEB23_ACCEPTED,
    { key: "march8", accepted: false, skippedYear: year },
  ];

  it("отказ снимает плашку на весь остаток окна", () => {
    expect(offeredKey(day("2026-02-15"), skipped(2026))).toBeNull();
    expect(offeredKey(day("2026-03-07"), skipped(2026))).toBeNull();
  });

  it("через год плашка приходит снова — отказ был про ЭТОТ праздник", () => {
    expect(offeredKey(day("2027-02-15"), skipped(2026))).toBe("march8");
  });

  it("год ПРАЗДНИКА, а не нажатия: Новый год отказывают в декабре", () => {
    // Нажатие 15 декабря 2026-го относится к празднику 1 января 2027-го.
    // Запиши мы год нажатия — плашка вернулась бы через две недели.
    const answers: HolidayAnswer[] = [{ key: "newYear", accepted: false, skippedYear: 2027 }];
    expect(offeredKey(day("2026-12-15"), answers)).toBeNull();
    expect(offeredKey(day("2026-12-31"), answers)).toBeNull();
    // А через год — снова: праздник другой.
    expect(offeredKey(day("2027-12-15"), answers)).toBe("newYear");
  });

  it("отказ от одной даты не трогает соседнюю", () => {
    // 15 февраля окна 23 февраля и 8 марта пересекаются. Отказ от ближней
    // отдаёт плашку дальней, а не гасит обе.
    expect(offeredKey(day("2026-02-15"))).toBe("feb23");
    expect(
      offeredKey(day("2026-02-15"), [{ key: "feb23", accepted: false, skippedYear: 2026 }]),
    ).toBe("march8");
  });
});

describe("«Показать» — и предлагать больше нечего", () => {
  it("принятая дата не предлагается ни в этом году, ни в следующем", () => {
    const accepted: HolidayAnswer[] = [{ key: "march8", accepted: true, skippedYear: null }];
    expect(offeredKey(day("2026-02-25"), accepted)).toBeNull();
    expect(offeredKey(day("2027-02-25"), accepted)).toBeNull();
    expect(offeredKey(day("2030-03-01"), accepted)).toBeNull();
  });

  it("принятие сильнее прежнего отказа: строка одна, ответ последний", () => {
    expect(
      offeredKey(day("2026-02-25"), [{ key: "march8", accepted: true, skippedYear: 2026 }]),
    ).toBeNull();
  });
});

describe("плашка одна, даже когда окна пересекаются", () => {
  it("15–22 февраля кандидатов двое, показывается ближайший", () => {
    for (const iso of ["2026-02-15", "2026-02-18", "2026-02-22"]) {
      const offer = holidayOffer(day(iso), []);
      expect(offer?.holiday.key, iso).toBe("feb23");
    }
    // 23-е прошло — плашка достаётся 8 марта, без всякого нового ответа.
    expect(offeredKey(day("2026-02-24"))).toBe("march8");
  });

  it("за два года подряд, день за днём: показывается ровно ближайший кандидат", () => {
    // Обход по календарю, а не по трём удачно выбранным датам: 2026-й
    // невисокосный, 2028-й високосный — оба под одним и тем же ожиданием.
    // Ожидание считается независимо от проверяемой функции: кандидаты
    // перебираются здесь, а `holidayOffer` обязан назвать среди них ближайшего.
    for (const year of [2026, 2028]) {
      let overlaps = 0;
      for (
        let cursor = day(`${year}-01-01`);
        cursor < day(`${year + 1}-01-01`);
        cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
      ) {
        const iso = cursor.toISOString().slice(0, 10);
        const candidates = COMMON_HOLIDAYS.map((holiday) => ({
          key: holiday.key,
          left: daysUntil(nextHoliday(holiday, cursor), cursor),
        }))
          .filter(({ left }) => left >= 1 && left <= OFFER_LEAD_DAYS)
          .sort((a, b) => a.left - b.left);
        if (candidates.length > 1) overlaps += 1;
        expect(holidayOffer(cursor, [])?.holiday.key ?? null, iso).toBe(candidates[0]?.key ?? null);
      }
      // Пересечения правда есть — иначе «ровно один» проверяло бы пустоту.
      expect(overlaps, `${year}: окна ни разу не пересеклись`).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// ПРАВИЛО, РАДИ КОТОРОГО ТЕСТ И ЗАВЁДЕН
// ---------------------------------------------------------------------------

describe("предложение праздника не читает ни набор зон, ни пол", () => {
  // Пакет называет соблазн вслух и отвергает его, и довод совпадает с нашим
  // инвариантом: пол в продукте — предустановка набора зон, а не свойство
  // человека. Продукт не знает, кто в комнате; в положении «Все 10» набор не
  // говорит о человеке ничего.
  //
  // ЗАВОДИТСЯ ТЕСТОМ, А НЕ ТОЛЬКО КОДОМ — иначе первая же «оптимизация»
  // («мужчине 8 марта незачем») вернёт догадку о человеке.

  it("у функции ровно два входа: «сегодня» и прежние ответы", () => {
    // Третьего аргумента, в который можно было бы просунуть комнату, нет.
    expect(holidayOffer.length).toBe(2);
  });

  it("в календаре нет ни слова про набор зон, пол или пресет", () => {
    const source = read("../src/server/holidays.ts");
    // Слова из контракта («пол в продукте — предустановка набора зон») в
    // комментарии стоят как ОБЪЯСНЕНИЕ правила; ловим обращения к данным.
    for (const forbidden of [
      /\bzoneSet\b/u,
      /\broom\./u,
      /\bpreset\b/u,
      /\bprisma\b/u,
      /\bsex\b/u,
      /\bgender\b/u,
    ]) {
      expect(source, `календарь читает ${forbidden}`).not.toMatch(forbidden);
    }
  });

  it("сервис отдаёт календарю ТОЛЬКО прежние ответы, и это видно в запросе", () => {
    const service = read("../src/server/services/room-occasions.ts");
    const offer = service.slice(
      service.indexOf("export async function occasionOffer"),
      service.indexOf("// ---------- Ответы на плашку"),
    );
    expect(offer, "функция не найдена — тест проверял бы пустоту").not.toBe("");
    // Выбираются три поля ответа и ничего больше: набору зон и полу неоткуда
    // попасть в аргументы `holidayOffer`.
    expect(offer).toContain("select: { key: true, accepted: true, skippedYear: true }");
    expect(offer).not.toMatch(/\bzoneSet\b/u);
    expect(offer).not.toMatch(/\bpreset\b/u);
  });

  it("обе гендерные даты предлагаются из ОДНИХ И ТЕХ ЖЕ входов", () => {
    // Ни одного различия между ними, кроме дня календаря: одинаковая пустая
    // история ответов даёт и 23 февраля, и 8 марта — каждую в свой срок.
    expect(offeredKey(day("2026-02-05"), [])).toBe("feb23");
    expect(offeredKey(day("2026-02-28"), [])).toBe("march8");
  });
});

// ---------------------------------------------------------------------------
// В комнате виден ровно один праздник
// ---------------------------------------------------------------------------

const occasion = (
  kind: RoomOccasion["kind"],
  monthDay: [number, number],
  extra: Partial<RoomOccasion> = {},
): RoomOccasion => ({
  kind,
  key: null,
  title: null,
  month: monthDay[0],
  day: monthDay[1],
  ...extra,
});

describe("в комнате виден ровно один праздник — ближайший", () => {
  const all: RoomOccasion[] = [
    occasion("birthday", [9, 14]),
    occasion("common", [1, 1], { key: "newYear" }),
    occasion("common", [2, 23], { key: "feb23" }),
    occasion("common", [3, 8], { key: "march8" }),
    occasion("own", [6, 30], { title: "Новоселье" }),
    occasion("own", [11, 2], { title: "Годовщина" }),
  ];

  it("шесть праздников — один ответ, и он не список", () => {
    const nearest = nearestOccasion(all, day("2026-08-11"));
    expect(nearest?.kind).toBe("birthday");
    expect(nearest?.date).toEqual(day("2026-09-14"));
  });

  it("ближайший меняется сам, без единого нажатия", () => {
    const days: Array<[string, RoomOccasion["kind"], string]> = [
      ["2026-09-15", "own", "2026-11-02"], // день рождения прошёл — следом годовщина
      ["2026-11-03", "common", "2027-01-01"], // годовщина прошла — Новый год
      ["2027-01-02", "common", "2027-02-23"],
      ["2027-02-24", "common", "2027-03-08"],
      ["2027-03-09", "own", "2027-06-30"],
    ];
    for (const [today, kind, expected] of days) {
      const nearest = nearestOccasion(all, day(today));
      expect(nearest?.kind, today).toBe(kind);
      expect(nearest?.date, today).toEqual(day(expected));
    }
  });

  it("сегодняшний праздник — ближайший, а не «прошедший»", () => {
    expect(nearestOccasion(all, day("2026-09-14"))?.date).toEqual(day("2026-09-14"));
  });

  it("праздников нет вовсе — null, и это законное состояние", () => {
    expect(nearestOccasion([], day("2026-08-11"))).toBeNull();
  });

  it("29 февраля участвует наравне с прочими и в невисокосный год — 28-го", () => {
    const leapling = [occasion("own", [2, 29], { title: "Годовщина" })];
    expect(nearestOccasion(leapling, day("2026-01-10"))?.date).toEqual(day("2026-02-28"));
    expect(nearestOccasion(leapling, day("2028-01-10"))?.date).toEqual(day("2028-02-29"));
  });

  it("мусор в строке праздником не становится — комната не падает", () => {
    // Ручная правка БД (31 февраля) ведёт себя как отсутствие праздника, а не
    // как исключение: то же недоверие, что у `birthdayOf`.
    const broken = [occasion("own", [2, 31], { title: "Ничего" })];
    expect(nearestOccasion(broken, day("2026-01-10"))).toBeNull();
    expect(
      nearestOccasion([...broken, occasion("birthday", [9, 14])], day("2026-01-10"))?.kind,
    ).toBe("birthday");
  });
});
