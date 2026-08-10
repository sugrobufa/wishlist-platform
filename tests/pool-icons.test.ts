// Знаки ЗОН — набор пулов (тикет 82; правки раунда 36 — тикет 150).
//
// ЗАЧЕМ ТЕСТ, ЕСЛИ ФАЙЛ ГЕНЕРИРУЕТСЯ. `pool-icons.tsx` собирает скрипт
// (.scratch/round16/gen-pool-icons.mjs), и пока его гоняют — расхождения быть
// не может. Ломается это ровно один раз: кто-то правит один узел прямо в
// сгенерированном файле, «чтобы не запускать скрипт», и следующий прогон
// правку молча стирает. Сверка путь в путь ловит обе беды: и правку руками, и
// забытый прогон после новой партии значков.
//
// РЯД ЭТОТ — САМЫЙ ДЛИННЫЙ В ПРОДУКТЕ: тринадцать знаков зон столбцом на
// экране «комната списком» (icons.json → rows). Правило их различимости
// держит сторож в tests/tab-icons; здесь — только сами файлы и `money`.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { POOL_ICON_KEYS, PoolIcon, hasPoolIcon } from "../src/components/pool-icons";
import { tileAppearance } from "../src/components/zone/tile-appearance";

/**
 * Файлы знаков зон лежат В РЕПОЗИТОРИИ — как и знаки интерфейса, иначе тест
 * зелёный только на машине владельца. Папка названа раундом ПЕРВОЙ поставки
 * (15), правки приезжают в неё же: раунд 36 переписал `music` и `bags` и
 * добавил `money`.
 */
const POOL_ICONS = path.join("design", "round15", "icons");

/** Геометрия знака: пути, круги и прямоугольники — без цвета и размеров. */
function shapeOf(svg: string): string[] {
  const paths = [...svg.matchAll(/d="([^"]+)"/gu)].map((m) => `path:${m[1]}`);
  const circles = [
    ...svg.matchAll(/<circle[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"[^>]*r="([\d.]+)"/gu),
  ].map((m) => `circle:${m[1]},${m[2]},${m[3]}`);
  const rects = [
    ...svg.matchAll(
      /<rect[^>]*x="([\d.]+)"[^>]*y="([\d.]+)"[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"(?:[^>]*rx="([\d.]+)")?/gu,
    ),
  ].map((m) => `rect:${m[1]},${m[2]},${m[3]},${m[4]},${m[5] ?? "0"}`);
  return [...paths, ...circles, ...rects].sort();
}

const fileNames = readdirSync(POOL_ICONS).filter((f) => f.endsWith(".svg"));

describe("знаки зон — путь в путь с файлами набора", () => {
  it.each(POOL_ICON_KEYS)("pool-%s.svg", (key) => {
    const file = readFileSync(path.join(POOL_ICONS, `pool-${key}.svg`), "utf8");
    expect(shapeOf(renderToStaticMarkup(createElement(PoolIcon, { pool: key })))).toEqual(
      shapeOf(file),
    );
  });

  it("ключей ровно столько, сколько файлов — лишнего знака не завели", () => {
    // Знак, которого нет в наборе, — это знак, который никто не сверял.
    expect([...POOL_ICON_KEYS].sort()).toEqual(
      fileNames.map((f) => f.replace(/^pool-|\.svg$/gu, "")).sort(),
    );
  });

  it("формат набора: сетка 24, контур 1.7, в сборке currentColor", () => {
    for (const name of fileNames) {
      const svg = readFileSync(path.join(POOL_ICONS, name), "utf8");
      expect(svg, name).toContain('viewBox="0 0 24 24"');
      expect(svg, name).toContain('stroke-width="1.7"');
    }
    const markup = renderToStaticMarkup(createElement(PoolIcon, { pool: "money" }));
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).not.toContain("#F2EDE4");
  });
});

describe("у зоны «Просто деньги» знак ПОЯВИЛСЯ (тикет 150)", () => {
  it("`money` больше не безымянный: знак есть и рисуется", () => {
    // ПЕРЕВЁРНУТО. До раунда 36 здесь было обратное: пула `money` в наборе не
    // было вовсе, и это записали не пропуском, а свойством пакета. Дизайн
    // назвал это своей пропажей: строка «Просто деньги» есть в КАЖДОЙ комнате,
    // а знака у неё не было ни в одной.
    expect(hasPoolIcon("money")).toBe(true);
    expect(renderToStaticMarkup(createElement(PoolIcon, { pool: "money" }))).toContain("<rect");
  });

  it("вещь без фото в зоне денег показывает конверт, а не букву", () => {
    const look = tileAppearance({ photoUrl: null, isDemo: false, title: "Подарок маме" }, "money");
    expect(look.poolIcon).toBe("money");
    expect(look.monogram, "буква осталась поверх знака — их рисуют по очереди").toBeNull();
  });
});

describe("запасной путь остался: буква там, где знака нет", () => {
  // Появление `money` не должно было превратить букву в наследство. Она —
  // рабочий запасной путь для зоны без пула и для пула, которого в наборе нет
  // (зона заводится в rooms.json, а знак приезжает пакетом — они разъезжаются
  // во времени, и разъезд обязан быть тихим, а не пустым местом на плитке).
  it.each([null, undefined, "", "неизвестный-пул"])("пул %p → знака нет", (pool) => {
    expect(hasPoolIcon(pool)).toBe(false);
    expect(renderToStaticMarkup(createElement(PoolIcon, { pool: String(pool) }))).toBe("");
  });

  it("вместо знака встаёт буква названия", () => {
    const look = tileAppearance(
      { photoUrl: null, isDemo: false, title: "Плетёная корзинка" },
      "неизвестный-пул",
    );
    expect(look.poolIcon).toBeNull();
    expect(look.monogram).toBe("П");
  });
});
