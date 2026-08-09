// Услуга-впечатление (тикет 97, доска Б20 · турн 8e).
//
// Что здесь защищается:
// - пустое поле НЕ рисуется: ячеек 3→2→1, прочерков нет;
// - срок выходит НАУТРО ПОСЛЕ даты — сертификат, годный до 14-го,
//   четырнадцатого числа ещё принимают;
// - срок считается в UTC, тем же поясом, которым он записан.
import { describe, expect, it } from "vitest";
import {
  EXPERIENCE_ZONE,
  experienceCells,
  isExperienceZone,
  isExpired,
} from "../src/server/dto/experience";

describe("ячейки полосы — пустое не рисуется", () => {
  it("три заполненных поля дают три ячейки в порядке доски", () => {
    const cells = experienceCells({
      eventWhen: "14 марта",
      eventWhere: "Москва",
      validUntil: "2026-09-01",
    });
    expect(cells.map((c) => c.key)).toEqual(["when", "where", "validUntil"]);
  });

  it("пустое, пробельное и null поля ячейки не создают", () => {
    expect(experienceCells({ eventWhen: "  ", eventWhere: null, validUntil: null })).toEqual([]);
    expect(
      experienceCells({ eventWhen: "выходные", eventWhere: "", validUntil: null }).map((c) => c.key),
    ).toEqual(["when"]);
  });

  it("только срок — одна ячейка, а не полоса с двумя прочерками", () => {
    const cells = experienceCells({ validUntil: "2026-09-01" });
    expect(cells).toHaveLength(1);
    expect(cells[0]?.key).toBe("validUntil");
  });
});

describe("срок выходит наутро после даты", () => {
  const day = "2026-03-14T00:00:00.000Z";

  it("в сам день срока вещь ещё живая", () => {
    expect(isExpired(day, new Date("2026-03-14T23:59:00.000Z"))).toBe(false);
  });

  it("наутро следующего дня — вышел", () => {
    expect(isExpired(day, new Date("2026-03-15T00:01:00.000Z"))).toBe(true);
  });

  it("без срока не выходит никогда; мусор сроком не считается", () => {
    expect(isExpired(null, new Date())).toBe(false);
    expect(isExpired(undefined, new Date())).toBe(false);
    expect(isExpired("не дата", new Date())).toBe(false);
  });

  it("Date и ISO-строка читаются одинаково", () => {
    const now = new Date("2026-03-15T06:00:00.000Z");
    expect(isExpired(new Date(day), now)).toBe(isExpired(day, now));
  });
});

describe("зона впечатлений", () => {
  it("одна на все комнаты и узнаётся по ключу", () => {
    expect(EXPERIENCE_ZONE).toBe("events");
    expect(isExperienceZone("events")).toBe(true);
    expect(isExperienceZone("jewelry")).toBe(false);
  });
});
