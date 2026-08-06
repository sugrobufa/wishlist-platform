import { describe, it, expect } from "vitest";
import zonesJson from "@design/zones.json";
import { SHEET_TILES } from "../src/components/zone/ZoneGrid";

// «А если вещей много?» — вопрос владельца со стенда (тикет 59). Ответ у доски
// уже был, просто не подключённый: пятое поле каждой зоны в zones.json
// (`moreLabel`) — это ярлык «ещё N» под листом вещей.
//
// ЗАЧЕМ ТЕСТ. Само число в ярлыке — от съёмки («+26» при счётчике-заглушке
// «31 вещь»), в интерфейс оно не едет: там числа живые (полировка 16). А вот
// ПРАВИЛО, по которому дизайн его считал, в продукте живёт константой
// SHEET_TILES, и вывели мы его отсюда же — сравнением двух полей у всех зон.
// Приедет новый пакет с другой раскладкой листа (шесть плиток вместо пяти) —
// упадёт этот тест, а не тихо разъедется подпись «ещё N» с тем, что на экране.

type ZonesContract = { keys: Record<string, string[]> };
const zones = (zonesJson as unknown as ZonesContract).keys;

/** «31 вещь · 9 в подарок» → 31; у зоны `money` счётчика нет вовсе → null. */
function subtitleCount(subtitle: string): number | null {
  const match = /^(\d+)/.exec(subtitle);
  return match?.[1] ? Number(match[1]) : null;
}

/** «+26» → 26; «—» (прочерк дизайна) → null. */
function moreCount(label: string): number | null {
  const match = /^\+(\d+)$/.exec(label);
  return match?.[1] ? Number(match[1]) : null;
}

describe("лист вещей: сколько зона показывает и сколько прячет", () => {
  const rows = Object.entries(zones).map(([key, row]) => ({
    key,
    total: subtitleCount(row[1] ?? ""),
    more: moreCount(row[4] ?? ""),
    raw: row[4] ?? "",
  }));

  it("у каждой зоны пакета есть пятое поле moreLabel", () => {
    expect(rows.filter((row) => row.raw === "").map((row) => row.key)).toEqual([]);
  });

  it("moreLabel = счётчик зоны минус SHEET_TILES — во всех зонах с числом", () => {
    const hidden = rows.filter((row) => row.total !== null && row.more !== null);
    // Семнадцать зон из девятнадцати: у `flowers` вместо числа прочерк,
    // у `money` нет и счётчика («основной подарок · открыт для всех»).
    expect(hidden.length).toBeGreaterThan(10);
    expect(
      hidden
        .filter((row) => (row.total as number) - (row.more as number) !== SHEET_TILES)
        .map((row) => `${row.key}: ${row.total} − ${row.more}`),
    ).toEqual([]);
  });

  it("прочерк вместо числа стоит там, где прятать нечего", () => {
    const dash = rows.filter((row) => row.more === null && row.total !== null);
    expect(
      dash.filter((row) => (row.total as number) > SHEET_TILES).map((row) => row.key),
    ).toEqual([]);
  });
});
