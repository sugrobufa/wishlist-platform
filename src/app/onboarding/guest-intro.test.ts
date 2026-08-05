import { describe, expect, it } from "vitest";
import {
  EMPTY_GUEST_INTRO,
  hasGuestIntro,
  parseGuestIntro,
  serializeGuestIntro,
} from "./guest-intro";

// Предзаполнение онбординга из брони (тикет 38). Cookie — это ввод: чужой,
// протухший или подделанный не имеет права уронить онбординг.

describe("serializeGuestIntro → parseGuestIntro", () => {
  it("имя и дата проходят круг без потерь", () => {
    const raw = serializeGuestIntro({ name: "Катя", occasionDate: "2026-03-11" });
    expect(parseGuestIntro(raw)).toEqual({ name: "Катя", occasionDate: "2026-03-11" });
  });

  it("имя без даты и дата без имени — обе половины самостоятельны", () => {
    expect(parseGuestIntro(serializeGuestIntro({ name: "Катя" }))).toEqual({
      name: "Катя",
      occasionDate: null,
    });
    expect(parseGuestIntro(serializeGuestIntro({ occasionDate: "2026-03-11" }))).toEqual({
      name: null,
      occasionDate: "2026-03-11",
    });
  });

  it("имя обрезается по пределу брони и не хранит пробелы", () => {
    const long = "я".repeat(500);
    const intro = parseGuestIntro(serializeGuestIntro({ name: `   ${long}   ` }));
    expect(intro.name).toHaveLength(120);
    expect(parseGuestIntro(serializeGuestIntro({ name: "   " })).name).toBeNull();
  });

  it("дата разбирается теми же правилами, что поле онбординга", () => {
    // Момент времени, несуществующий день и «завтра» — это не дата праздника.
    for (const bad of ["2026-03-11T21:00:00+03:00", "2026-02-31", "2026-13-01", "завтра", ""]) {
      expect(parseGuestIntro(serializeGuestIntro({ occasionDate: bad })).occasionDate).toBeNull();
    }
  });

  it("не-строки на входе — это «ничего не известно», а не падение", () => {
    expect(parseGuestIntro(serializeGuestIntro({ name: 42, occasionDate: {} }))).toEqual(
      EMPTY_GUEST_INTRO,
    );
  });
});

describe("parseGuestIntro — недоверенное значение", () => {
  it("пусто, не JSON, не объект, массив — пустое предзаполнение", () => {
    for (const raw of [null, undefined, "", "{", "«мусор»", "[1,2,3]", '"строка"', "17"]) {
      expect(parseGuestIntro(raw)).toEqual(EMPTY_GUEST_INTRO);
    }
  });

  it("объект с чужими ключами читается как пустой", () => {
    expect(parseGuestIntro('{"userId":"cm123","admin":true}')).toEqual(EMPTY_GUEST_INTRO);
  });

  it("подделанная дата отбрасывается, а имя рядом с ней выживает", () => {
    expect(parseGuestIntro('{"n":"Катя","d":"позавчера"}')).toEqual({
      name: "Катя",
      occasionDate: null,
    });
  });
});

describe("hasGuestIntro", () => {
  it("пустое предзаполнение не хранится", () => {
    expect(hasGuestIntro(EMPTY_GUEST_INTRO)).toBe(false);
    expect(hasGuestIntro({ name: "Катя", occasionDate: null })).toBe(true);
    expect(hasGuestIntro({ name: null, occasionDate: "2026-03-11" })).toBe(true);
  });
});
