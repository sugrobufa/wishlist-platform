// КОНТРАКТ ЗЁРЕН — `design/package/handoff/seeds/seeds.json` (тикет 136).
//
// ФАЙЛ ПРИЕХАЛ ИЗ `tests/starter-pack.test.ts` (тикет 191). Тот тест держал две
// разные вещи под одной крышей: контракт зёрен и поведение кнопки «Или начни с
// готового». Кнопку владелец снял 11.08.2026 — комнату за человека больше не
// наполняют, — а контракт остался: по нему сеется СТЕНД (`npm run db:seed`,
// тикет 175), то есть та комната, на которой владелец принимает работу.
// Сторож контракта пережил снятие вместе с зёрнами; всё, что проверяло
// `applyStarterPack` и `starterPackSize`, удалено вместе с ними.
//
// Что здесь защищается:
// - контракт целиком: 19 пулов по 5 зёрен, у каждого цена, ни одного «уже моё»;
// - дарителей и годов контракт НЕ приносит: выдуманное воспоминание в
//   сокровищнице — это ложь про человека (инвариант №2);
// - у каждой видимой зоны продукта пул наполнен, кроме «Просто денег»;
// - каждый кадр контракта лежит в пакете файлом.
//
// Числа зафиксированы поставкой round33 и посчитаны нами по файлу. Тест упал —
// значит приехал новый пакет: это повод сверить его с письмом, а не поправить
// ожидания.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import seedsJson from "@design/seeds/seeds.json";
import { livePoolSeeds, packSeedsRejected } from "../src/server/services/pack-seeds";
import { rooms as roomPresets } from "../src/config/design";

const CONTRACT = {
  pools: 19,
  seeds: 95,
  perPool: 5,
  withPhoto: 36,
} as const;

/** Зона без пула: там копилка на мечту, а не вещи (инвариант №9). */
const MONEY_POOL = "money";

/**
 * ПУЛ, КОТОРОГО В КОНТРАКТЕ ЗЁРЕН ЕЩЁ НЕТ, — назван поимённо (тикет 234).
 *
 * Полка «Бар и табак» приехала справочником зон пакета 51 и заведена в карту
 * тикетом 234; зёрен к ней пакет не прислал — в `seeds/seeds.json` по-прежнему
 * девятнадцать пулов. Придумывать вещи здесь нельзя: их названия и цены —
 * значения пакета, и весь смысл этого файла в том, что они живут в пакете, а не
 * в коде. Приедут зёрна — запись уйдёт, и проверка станет строгой сама.
 */
const POOLS_NOT_DELIVERED: Record<string, string> = {
  bar: "пакет 51 прислал полку «Бар и табак» без зёрен: в seeds.json по-прежнему девятнадцать пулов",
};

const contractPools = (seedsJson as unknown as { pools: Record<string, unknown[]> }).pools;

describe("контракт зёрен — значения пакета живут в пакете, а не в коде", () => {
  it("19 пулов ровно по 5 зёрен — всего 95", () => {
    const keys = Object.keys(contractPools);
    expect(keys).toHaveLength(CONTRACT.pools);
    for (const key of keys) {
      expect(livePoolSeeds(key), `пул ${key}`).toHaveLength(CONTRACT.perPool);
    }
    const total = keys.reduce((sum, key) => sum + livePoolSeeds(key).length, 0);
    expect(total).toBe(CONTRACT.seeds);
    // Пула `money` в контракте нет и не должно быть.
    expect(livePoolSeeds(MONEY_POOL)).toEqual([]);
    expect(livePoolSeeds("нет-такого-пула")).toEqual([]);
  });

  it("сторож не выбросил ни одного зерна: у всех цена и ни одного «уже моё»", () => {
    // Ноль отброшенных — второе имя тех же двух правил: контракт им отвечает
    // целиком, а не «в основном».
    expect(packSeedsRejected).toEqual([]);

    for (const key of Object.keys(contractPools)) {
      for (const seed of livePoolSeeds(key)) {
        expect(seed.mine, `«${seed.title}»`).toBe(false);
        if (seed.mine) continue; // сузить тип для полей желания
        expect(seed.priceRub, `цена «${seed.title}»`).toBeGreaterThan(0);
        expect(Number.isFinite(seed.priceRub), `цена «${seed.title}»`).toBe(true);
        expect(seed, `«${seed.title}»`).not.toHaveProperty("giverName");
        expect(seed, `«${seed.title}»`).not.toHaveProperty("receivedYear");
      }
    }
  });

  it("36 зёрен с кадром, и каждый кадр лежит в пакете", () => {
    const photos = Object.keys(contractPools)
      .flatMap((key) => livePoolSeeds(key))
      .map((seed) => seed.photo)
      .filter((photo): photo is string => Boolean(photo));

    expect(photos).toHaveLength(CONTRACT.withPhoto);
    for (const photo of photos) {
      // Путь раздачи, а не голое имя: его понимают и хранилище посева,
      // и `itemPhotoUrl`.
      expect(photo).toMatch(/^refs\/[a-z0-9][a-z0-9-]*\.jpg$/);
      const file = resolve(process.cwd(), "design/package", photo);
      expect(existsSync(file), `кадра ${photo} нет в пакете`).toBe(true);
    }
  });

  it("у каждой видимой зоны продукта пул наполнен (кроме «Просто денег»)", () => {
    for (const room of roomPresets) {
      for (const zone of room.zones) {
        if (zone.pool === MONEY_POOL) {
          expect(livePoolSeeds(zone.pool), `${room.id}/${zone.key}`).toEqual([]);
          continue;
        }
        if (POOLS_NOT_DELIVERED[zone.pool]) {
          expect(
            livePoolSeeds(zone.pool),
            `${room.id}/${zone.key}: зёрна приехали, запись просрочена`,
          ).toEqual([]);
          continue;
        }
        expect(livePoolSeeds(zone.pool), `${room.id}/${zone.key}`).toHaveLength(CONTRACT.perPool);
      }
    }
    // Названный пул обязан ПРАВДА стоять в карте: запись, не разрешающая
    // ничего, завтра разрешит случайно совпавший ключ.
    for (const pool of Object.keys(POOLS_NOT_DELIVERED)) {
      expect(
        roomPresets.some((room) => room.zones.some((zone) => zone.pool === pool)),
        `${pool}: пула нет ни в одной комнате — запись лишняя`,
      ).toBe(true);
    }
  });
});
