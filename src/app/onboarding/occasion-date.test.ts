// Чтение даты праздника в онбординге (тикет 43). Юнит: ни React, ни БД —
// поле шага 3 и предзаполнение снаружи (тикет 38) подчиняются одному правилу.
import { describe, expect, it } from "vitest";
import { initialOccasionValue, readOccasionDate } from "./occasion-date";

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

describe("initialOccasionValue — предзаполнение снаружи (тикет 38)", () => {
  it("день снаружи открывает шаг заполненным", () => {
    expect(initialOccasionValue("2027-03-08")).toBe("2027-03-08");
  });

  it("нет значения или мусор — шаг открывается пустым, а не сломанным", () => {
    expect(initialOccasionValue(null)).toBe("");
    expect(initialOccasionValue(undefined)).toBe("");
    expect(initialOccasionValue("")).toBe("");
    expect(initialOccasionValue("завтра")).toBe("");
    expect(initialOccasionValue("2026-02-31")).toBe("");
  });
});
