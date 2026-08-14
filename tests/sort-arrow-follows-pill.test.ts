import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const GRID = readFileSync(
  resolve(process.cwd(), "src/app/room/zone/[zone]/owner-zone-grid.tsx"),
  "utf8",
);

/**
 * 246 — СТРЕЛКА ПЕРЕХОДИТ ЗА ВЫБРАННОЙ ПИЛЮЛЕЙ.
 *
 * Приёмка владельца 14.08.2026: «почему стрелочка только на одной пилюле? Я
 * думал, лучше будет, если стрелочка будет переходить в зависимости от
 * выбранной пилюли». Стрелка была прибита к «по дате», и переворачивалась
 * только дата — сказать «сначала дорогие» было нечем.
 */
describe("246 — направление принадлежит порядку, а не одному чипу", () => {
  it("направление одно на все порядки, а не «asc для даты»", () => {
    expect(GRID).toContain("const [asc, setAsc] = useState(false);");
    expect(GRID).not.toContain("dateAsc");
  });

  it("стрелку рисует ВЫБРАННЫЙ чип", () => {
    expect(GRID).toMatch(/sort === key \? `\$\{label\} \$\{asc \? "↑" : "↓"\}` : label/u);
    // Оба порядка зовут одно и то же — прибитой стрелки у «даты» больше нет.
    expect(GRID).toContain('chip("date", withArrow("date", tl("sortDate")), () => pickSort("date"))');
    expect(GRID).toContain(
      'chip("price", withArrow("price", tl("sortPrice")), () => pickSort("price"))',
    );
  });

  it("«скрытые» стрелки не получают — это фильтр, а не порядок", () => {
    expect(GRID).toContain('chip("hidden", tl("sortHidden")');
    expect(GRID).not.toContain('withArrow("hidden"');
  });

  it("цена сортируется в обе стороны, вещь без цены всегда в хвосте", () => {
    expect(GRID).toContain("return asc ? a - b : b - a;");
    // Оба «нет цены» — до сравнения направлением: иначе переворот поднял бы их
    // наверх и человек решил бы, что цены пропали.
    expect(GRID).toMatch(/if \(a == null\) return 1;\s*\n\s*if \(b == null\) return -1;/u);
  });

  it("свой чип переворачивает, чужой — выбирает и сбрасывает направление", () => {
    expect(GRID).toMatch(/if \(sort === key\) \{\s*\n\s*setAsc\(\(value\) => !value\);/u);
    expect(GRID).toMatch(/setSort\(key\);\s*\n\s*setAsc\(false\);/u);
  });
});
