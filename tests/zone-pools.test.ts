// Пулы зон: у каждой зоны свой набор вещей, и ни один набор не осиротел
// (тикет 108).
//
// ПОЧЕМУ ЭТО ТЕСТ, А НЕ ПРОВЕРКА ГЛАЗАМИ. Пул зоны живёт в `rooms.json`
// (поле `pool` у зоны), а сам набор — в `config/demo-pools.ts`. Связь между
// ними ничем не держалась, и она порвалась молча: раунд 8 завёл набор
// `grooming` под зону «Уход», а `rooms.json` во всех четырёх мужских комнатах
// продолжал показывать там `perfume`. Пять предметов ухода (станок, триммер,
// масло для бороды, несессер, одеколон) не были видны НИГДЕ, а мужская полка
// «Уход» показывала свечу с инжиром и диффузор для дома.
//
// Дешёвым это было, пока наборы только рисовались призраками. С тикета 100
// набор кладётся в комнату по-настоящему — ошибка стала попадать людям.
import { describe, expect, it } from "vitest";
import { rooms as roomPresets } from "../src/config/design";
import { demoPools } from "../src/config/demo-pools";

/**
 * Зона без набора — ровно одна и по решению продукта: «Просто деньги».
 * Внутри неё копилка на мечту (ADR-0008), предметов у неё нет и не будет.
 */
const ZONES_WITHOUT_POOL = new Set(["money"]);

/**
 * Пулы, которых пакет ещё не прислал, — поимённо, с причиной (тикет 234).
 * Полный разбор и второй замок на ту же запись — `tests/items.demo.test.ts`.
 */
const POOLS_NOT_DELIVERED = new Set(["bar"]);

describe("пулы зон (тикет 108)", () => {
  it("каждая зона смотрит в существующий набор", () => {
    const broken: string[] = [];
    for (const room of roomPresets) {
      for (const zone of room.zones) {
        if (ZONES_WITHOUT_POOL.has(zone.key)) continue;
        if (!zone.pool) {
          broken.push(`${room.id}/${zone.key}: пула нет вовсе`);
          continue;
        }
        if (POOLS_NOT_DELIVERED.has(zone.pool)) continue;
        if (!Object.hasOwn(demoPools, zone.pool)) {
          broken.push(`${room.id}/${zone.key}: пул «${zone.pool}» не существует`);
        }
      }
    }
    expect(broken).toEqual([]);
  });

  it("ни один набор не осиротел — на каждый смотрит хотя бы одна зона", () => {
    // Тот самый случай: набор есть, а показать его некому. Проверка идёт от
    // НАБОРОВ к зонам (обратная предыдущей) — только так видно сироту.
    const used = new Set(
      roomPresets.flatMap((room) => room.zones.map((zone) => zone.pool).filter(Boolean)),
    );
    const orphans = Object.keys(demoPools).filter((pool) => !used.has(pool));
    expect(orphans).toEqual([]);
  });

  it("зона «Уход» мужских комнат берёт набор ухода, а не парфюма", () => {
    // Регресс-тест на саму находку: справочник дизайна (`zones.json`) с
    // раунда 8 говорит про эту зону `pool: "grooming"`, а `rooms.json` держал
    // `perfume` — два его файла спорили между собой.
    const care = roomPresets.flatMap((room) =>
      room.zones.filter((zone) => zone.key === "grooming").map((zone) => `${room.id}=${zone.pool}`),
    );
    expect(care.length).toBeGreaterThan(0);
    expect(care.every((row) => row.endsWith("=grooming"))).toBe(true);
  });
});
