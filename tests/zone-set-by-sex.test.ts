import { describe, expect, it } from "vitest";
import { rooms } from "../src/config/design";
import { zoneKeysForSet, zoneSetOf, zoneSetSchema } from "../src/server/services/rooms";

/**
 * 241 — ПОЛ ВЫБИРАЕТ КОМНАТЫ, И ВЫБИРАЕТСЯ ОДИН РАЗ.
 *
 * Решение владельца 14.08.2026: «пусть женские комнаты едут в женские, а
 * мужские в мужские, никакого смешения комнат не должно быть». Положение «Все
 * десять» отменено, и отменено не вкусом, а числом — оно открывало 48 пар
 * комнат, между которыми переезд без потерь невозможен в принципе.
 *
 * Здесь проверяется ровно то, что можно проверить без базы: схема, набор
 * ключей и комната со старым значением в поле. Переезд вещей живой базой —
 * `tests/settings.test.ts`.
 */
describe("241 — пол выбирает комнаты", () => {
  it("значений два: F и M, «Все десять» и мусор отвергаются", () => {
    expect(zoneSetSchema.parse("F")).toBe("F");
    expect(zoneSetSchema.parse("M")).toBe("M");
    // ALL отвергается ровно так же, как мусор: положения больше нет, и
    // «незнакомое значение» — единственный честный ответ на него.
    expect(zoneSetSchema.safeParse("ALL").success).toBe(false);
    expect(zoneSetSchema.safeParse("").success).toBe(false);
    expect(zoneSetSchema.safeParse("f").success).toBe(false);
  });

  it("набор пола — 13 полок у женщин, 14 у мужчин, и «Бар и табак» только там", () => {
    const female = zoneKeysForSet("F");
    const male = zoneKeysForSet("M");
    expect(female).toHaveLength(13);
    expect(male).toHaveLength(14);
    // Решение владельца от 14.08 этим тикетом не отменяется.
    expect(male).toContain("bar");
    expect(female).not.toContain("bar");
  });

  it("ВСЕ КОМНАТЫ ОДНОГО ПОЛА НЕСУТ ОДИН СОСТАВ — иначе счёт по набору солгал бы", () => {
    // `zoneKeysForSet` берёт ПЕРВУЮ комнату пола и отвечает за все. Это законно
    // ровно до тех пор, пока составы совпадают, — а совпадать они обязаны с
    // приёмки 14.08 («принцип как у женщин»). Разойдись они, предварительный
    // счёт `itemsLeavingSet` начал бы врать в большую или меньшую сторону, и
    // человек увидел бы не то число, под которым согласился.
    for (const set of ["F", "M"] as const) {
      const expected = [...zoneKeysForSet(set)].sort();
      const ofSet = rooms.filter((room) => room.sex === set);
      expect(ofSet.length, `${set}: комнат в наборе`).toBe(set === "F" ? 6 : 4);
      for (const room of ofSet) {
        expect(
          [...room.zones.map((zone) => zone.key)].sort(),
          `${room.id}: состав разошёлся с набором пола`,
        ).toEqual(expected);
      }
    }
  });

  it("общих полок семь — это и есть причина, по которой смешения больше нет", () => {
    // Число из письма 57 и пакета 52+, проверенное обеими сторонами:
    // 13 + 14 − 7 = 20. Стоит здесь, чтобы отмена «Всех десяти» имела рядом
    // свой довод, а не только дату решения.
    const female = new Set(zoneKeysForSet("F"));
    const male = new Set(zoneKeysForSet("M"));
    const common = [...female].filter((key) => male.has(key)).sort();
    expect(common).toEqual([
      "anything",
      "books",
      "events",
      "fashion",
      "money",
      "music",
      "travel",
    ]);
    expect(new Set([...female, ...male]).size).toBe(20);
    // Шесть полок теряла женщина, переезжая в мужскую комнату, семь — обратно.
    expect([...female].filter((key) => !male.has(key))).toHaveLength(6);
    expect([...male].filter((key) => !female.has(key))).toHaveLength(7);
  });

  it("комната со старым «Все десять» берёт набор по полу СВОЕГО интерьера", () => {
    // Выбрать за человека пол молча нельзя, а комната у него уже стоит — она и
    // отвечает. Записи при этом не происходит: значение в базе останется
    // прежним до первого сознательного выбора.
    expect(zoneSetOf({ zoneSet: "ALL", preset: "cream" })).toBe("F");
    expect(zoneSetOf({ zoneSet: "ALL", preset: "loft" })).toBe("M");
    // Осмысленное значение всегда сильнее интерьера: человек мог выбрать пол и
    // ещё не переехать.
    expect(zoneSetOf({ zoneSet: "M", preset: "cream" })).toBe("M");
    expect(zoneSetOf({ zoneSet: "F", preset: "loft" })).toBe("F");
    // Незнакомый интерьер вместе с незнакомым набором не роняет страницу.
    expect(zoneSetOf({ zoneSet: "", preset: "kitchen" })).toBe("F");
  });
});
