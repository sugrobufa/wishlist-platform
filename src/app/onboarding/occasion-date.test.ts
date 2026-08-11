// Чтение дня рождения в онбординге (тикеты 43 и 187). Юнит: ни React, ни БД —
// поля шага 3 и предзаполнение снаружи (тикет 38) подчиняются одному правилу.
import { describe, expect, it } from "vitest";
import { initialBirthdayValue, readBirthdayForm, readOccasionDate } from "./occasion-date";

describe("readOccasionDate — календарный день или ничего", () => {
  it('день из <input type="date"> проходит как есть', () => {
    expect(readOccasionDate("2026-12-31")).toBe("2026-12-31");
    expect(readOccasionDate("2027-01-01")).toBe("2027-01-01");
    expect(readOccasionDate("2028-02-29")).toBe("2028-02-29"); // високосный
  });

  it("пустое поле — это «даты нет», а не отказ", () => {
    // Так выглядит форма, когда человек нажал «Пока не знаю»: экшен не
    // должен ни падать, ни писать что-то в комнату.
    expect(readOccasionDate("")).toBeNull();
    expect(readOccasionDate("   ")).toBeNull();
  });

  it("не строка — тоже ничего (FormData отдаёт File, снаружи придёт что угодно)", () => {
    expect(readOccasionDate(null)).toBeNull();
    expect(readOccasionDate(undefined)).toBeNull();
    expect(readOccasionDate(20261231)).toBeNull();
    expect(readOccasionDate({ date: "2026-12-31" })).toBeNull();
  });

  it("момент времени — не день: строка со временем и зоной не проходит", () => {
    // Инвариант тикета: человек вводит календарную дату, а не отметку
    // времени. Пустить сюда «…T21:00:00+03:00» значило бы отдать сервису
    // чужую полночь.
    expect(readOccasionDate("2026-12-31T00:00:00.000Z")).toBeNull();
    expect(readOccasionDate("2026-12-31T21:00:00+03:00")).toBeNull();
  });

  it("несуществующий день не проходит, хотя по форме похож", () => {
    // 2026-02-31 разбором «переезжает» на 3 марта — молча сохранить чужой
    // день хуже, чем не сохранить ничего.
    expect(readOccasionDate("2026-02-31")).toBeNull();
    expect(readOccasionDate("2026-02-29")).toBeNull(); // 2026-й не високосный
    expect(readOccasionDate("2026-13-01")).toBeNull();
    expect(readOccasionDate("2026-00-10")).toBeNull();
  });

  it("нестрогая запись не проходит: сервис ждёт ровно YYYY-MM-DD", () => {
    expect(readOccasionDate("2026-1-1")).toBeNull();
    expect(readOccasionDate("31.12.2026")).toBeNull();
    expect(readOccasionDate("2026/12/31")).toBeNull();
  });
});

describe("readBirthdayForm — два списка шага 3 (тикет 187)", () => {
  it("день и месяц из формы становятся днём рождения без года", () => {
    // FormData отдаёт строки — числами их делает разбор, а не разметка.
    expect(readBirthdayForm("8", "3")).toEqual({ day: 8, month: 3, year: null });
    expect(readBirthdayForm(29, 2)).toEqual({ day: 29, month: 2, year: null });
  });

  it("ГОД НЕ СПРАШИВАЕТСЯ И НЕ БЕРЁТСЯ: у ответа его нет никогда", () => {
    // Возраст продукту не нужен ни для чего (решение владельца 11.08.2026),
    // и лишнего поля в форме нет — но даже приедь оно, ответ его не понесёт.
    expect(readBirthdayForm("31", "12")?.year).toBeNull();
  });

  it("половина ответа — не ответ: один список без другого не проходит", () => {
    expect(readBirthdayForm("8", "")).toBeNull();
    expect(readBirthdayForm("", "3")).toBeNull();
    expect(readBirthdayForm("", "")).toBeNull();
    expect(readBirthdayForm(null, null)).toBeNull();
  });

  it("несуществующий день не проходит, хотя оба списка заполнены", () => {
    expect(readBirthdayForm("31", "2")).toBeNull();
    expect(readBirthdayForm("31", "4")).toBeNull();
    expect(readBirthdayForm("0", "3")).toBeNull();
    expect(readBirthdayForm("8", "13")).toBeNull();
  });

  it("29 ФЕВРАЛЯ ПРОХОДИТ БЕЗ ГОДА: високосность спрашивать не у чего", () => {
    // Год необязателен, а 29 февраля — законный день рождения. Отвергнуть его
    // значило бы потребовать год ради одного дня в году.
    expect(readBirthdayForm("29", "2")).toEqual({ day: 29, month: 2, year: null });
  });
});

describe("initialBirthdayValue — предзаполнение снаружи (тикет 38)", () => {
  it("день снаружи открывает шаг заполненным — днём и месяцем", () => {
    // Год из строки НЕ едет: гость называл там ближайший праздник, и год в
    // ней — год праздника, а не год рождения (тикет 187).
    expect(initialBirthdayValue("2027-03-08")).toEqual({ day: 8, month: 3 });
  });

  it("нет значения или мусор — шаг открывается пустым, а не сломанным", () => {
    expect(initialBirthdayValue(null)).toEqual({ day: null, month: null });
    expect(initialBirthdayValue(undefined)).toEqual({ day: null, month: null });
    expect(initialBirthdayValue("")).toEqual({ day: null, month: null });
    expect(initialBirthdayValue("завтра")).toEqual({ day: null, month: null });
    expect(initialBirthdayValue("2026-02-31")).toEqual({ day: null, month: null });
  });
});
