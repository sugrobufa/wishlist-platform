// Глагол главной кнопки по зоне (тикет 110, доска В12 · турн 8e).
//
// Доска: кнопка «Поставить» одинакова во всех девятнадцати зонах, а комната —
// метафора. Каждый глагол называет мебель зоны ИЗ КАДРА: «Уложить в чемодан»,
// «Приколоть к билетам», «Убрать в шкатулку».
//
// Что здесь защищается:
// - глагол есть у КАЖДОЙ зоны справочника: одна пропущенная — и кнопка
//   молча вернётся к общему слову ровно в той зоне, где метафора нужнее;
// - глагол кнопки НЕ ПУТАЕТСЯ с глаголом съёмки (`openVerb`). Тот описывает,
//   что показывает кадр раскрытия («чемодан раскрывается»), человеку не
//   показывается никогда (тикет 59) и на кнопке был бы бессмыслицей.
import { describe, expect, it } from "vitest";
import { rooms, zoneCta, zoneInfo } from "../src/config/design";
import zonesContract from "../design/package/handoff/zones.json";

const zoneKeys = Object.keys((zonesContract as { keys: Record<string, unknown> }).keys);

describe("глагол кнопки по зоне (тикет 110)", () => {
  it("глагол есть у каждой из девятнадцати зон справочника", () => {
    const missing = zoneKeys.filter((key) => !zoneCta(key));
    expect(missing).toEqual([]);
    expect(zoneKeys).toHaveLength(19);
  });

  it("глагол есть у каждой зоны каждой из десяти комнат", () => {
    const missing = rooms.flatMap((room) =>
      room.zones.filter((zone) => !zoneCta(zone.key)).map((zone) => `${room.id}/${zone.key}`),
    );
    expect(missing).toEqual([]);
  });

  it("кнопочный глагол — не глагол съёмки", () => {
    // openVerb описывает кадр («шкатулка поднимает крышку»), cta — действие
    // человека («Убрать в шкатулку»). Совпадение значило бы, что на кнопку
    // уехало слово контракта.
    const same = zoneKeys.filter((key) => zoneCta(key) === zoneInfo(key)?.openVerb);
    expect(same).toEqual([]);
    expect(zoneCta("travel")).toBe("Уложить в чемодан");
    expect(zoneInfo("travel")?.openVerb).not.toBe("Уложить в чемодан");
  });

  it("неизвестная зона глагола не выдумывает", () => {
    expect(zoneCta("нет-такой-зоны")).toBeNull();
    // Ключи прототипа не пролезают как «найденный глагол».
    expect(zoneCta("constructor")).toBeNull();
    expect(zoneCta("toString")).toBeNull();
  });
});
