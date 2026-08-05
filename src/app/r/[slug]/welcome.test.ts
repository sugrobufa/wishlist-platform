import { describe, expect, it } from "vitest";
import { daysUntilOccasion } from "./welcome";

// Счёт дней до праздника в приветствии гостя (тикет 38). Проверяется без
// браузера и без БД: правило целиком живёт в чистой функции.

describe("daysUntilOccasion", () => {
  const now = new Date("2026-03-01T09:30:00.000Z");

  it("сегодня — 0, завтра — 1, через 12 дней — 12", () => {
    expect(daysUntilOccasion("2026-03-01", now)).toBe(0);
    expect(daysUntilOccasion("2026-03-02", now)).toBe(1);
    expect(daysUntilOccasion("2026-03-13", now)).toBe(12);
  });

  it("прошедший праздник — строки нет (null), даже вчерашний", () => {
    expect(daysUntilOccasion("2026-02-28", now)).toBeNull();
    expect(daysUntilOccasion("2025-12-31", now)).toBeNull();
  });

  it("даты нет — null; мусор снаружи не роняет комнату", () => {
    expect(daysUntilOccasion(null, now)).toBeNull();
    expect(daysUntilOccasion(undefined, now)).toBeNull();
    expect(daysUntilOccasion("", now)).toBeNull();
    expect(daysUntilOccasion("завтра", now)).toBeNull();
    expect(daysUntilOccasion("2026-3-1", now)).toBeNull();
    expect(daysUntilOccasion(42 as unknown as string, now)).toBeNull();
  });

  it("момент времени вместо дня не проходит — сервис отдаёт день", () => {
    expect(daysUntilOccasion("2026-03-13T00:00:00.000Z", now)).toBeNull();
  });

  it("несуществующее число не считается праздником", () => {
    // 2026 не високосный, а 31 февраля разбором «переезжает» на 3 марта.
    expect(daysUntilOccasion("2026-02-29", now)).toBeNull();
    expect(daysUntilOccasion("2026-02-31", now)).toBeNull();
    expect(daysUntilOccasion("2026-13-01", now)).toBeNull();
  });

  it("время суток не влияет: и в 00:01, и в 23:59 до завтра остаётся один день", () => {
    expect(daysUntilOccasion("2026-03-02", new Date("2026-03-01T00:01:00.000Z"))).toBe(1);
    expect(daysUntilOccasion("2026-03-02", new Date("2026-03-01T23:59:59.000Z"))).toBe(1);
  });

  it("новогодний край не съезжает на сутки", () => {
    expect(daysUntilOccasion("2027-01-01", new Date("2026-12-31T21:00:00.000Z"))).toBe(1);
    expect(daysUntilOccasion("2027-01-01", new Date("2027-01-01T00:00:00.000Z"))).toBe(0);
  });

  it("переход через февраль високосного года считается по календарю", () => {
    // 2028 високосный: с 28 февраля до 1 марта — двое суток, а не одни.
    expect(daysUntilOccasion("2028-03-01", new Date("2028-02-28T10:00:00.000Z"))).toBe(2);
  });
});
