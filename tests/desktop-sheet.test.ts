import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Потолок листа вещей на ДЕСКТОПЕ (тикет 60).
//
// ЗАЧЕМ ТЕСТ. Прежнее число было долей экрана («треть», тикет 42) и пережило
// появление содержимого: на 1280×800 лист давал 150.7 px при ряде плиток в
// 178.8 — не помещалось НИ ОДНОЙ вещи целиком. Новое число — не доля, а сумма:
// шапка листа + самый высокий ряд + шаг + кромка следующего ряда. Сумма тем и
// опасна, что живёт в двух файлах: сложи её один раз в комментарии — и любое
// слагаемое (колонка сетки, промежуток, толщина кромки, поле листа) уедет
// молча, а владелец снова увидит срезанную плитку.
//
// Поэтому здесь сумма СЧИТАЕТСЯ ЗАНОВО из тех же CSS-файлов, а не переписана
// числом. Упадёт тест — значит потолок пора пересчитать, и в сообщении сразу
// видно, какого слагаемого не хватило.

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const sceneCss = read("../src/components/scene/scene.module.css");
const gridCss = read("../src/components/zone/zone-grid.module.css");
const tokensCss = read("../src/styles/tokens.css");

/**
 * Тело ПОСЛЕДНЕГО правила `.selector`, в котором это свойство вообще задано.
 * Последнее — потому что переопределяют его ниже по файлу (десктопная ветка);
 * «в котором задано» — потому что ниже десктопной ветки лежит ещё
 * `prefers-reduced-motion`, и там у того же класса только длительности.
 */
function ruleBody(css: string, selector: string, property: string): string {
  const bodies = [...css.matchAll(new RegExp(`\\.${selector} \\{([^}]*)\\}`, "gu"))]
    .map((m) => m[1] ?? "")
    .filter((body) => new RegExp(`(?:^|[;\\s])${property}:`, "u").test(body));
  expect(bodies.length, `в CSS нет правила .${selector} со свойством ${property}`).toBeGreaterThan(
    0,
  );
  return bodies[bodies.length - 1] as string;
}

/** Первое число перед `px` у свойства. */
function px(css: string, selector: string, property: string): number {
  const body = ruleBody(css, selector, property);
  const match = new RegExp(`${property}:\\s*(-?\\d+(?:\\.\\d+)?)px`, "u").exec(body);
  expect(match, `у .${selector} свойство ${property} задано не в px`).not.toBeNull();
  return Number(match?.[1]);
}

/** `font: 500 11.5px/1.3 var(--font-ui)` → высота строки в px. */
function lineHeight(css: string, selector: string): number {
  const body = ruleBody(css, selector, "font");
  const match = /font:\s*\d+\s+(\d+(?:\.\d+)?)px\/(\d+(?:\.\d+)?)/u.exec(body);
  expect(match, `у .${selector} нет сокращённого font с размером и интерлиньяжем`).not.toBeNull();
  return Number(match?.[1]) * Number(match?.[2]);
}

describe("десктопный лист вещей вмещает ряд плиток целиком (тикет 60)", () => {
  // --- то, что обязано влезть ---------------------------------------------

  // Шапка листа: кромка сверху + поле листа + вкладки «Люблю/Хочу» + воздух
  // над сеткой. Поле листа берётся десктопное — оно задано ниже базового.
  const panelBorder = px(sceneCss, "panel", "border-top");
  const panelPadTop = px(sceneCss, "panelBody", "padding");
  const tabsHeight = lineHeight(gridCss, "tab") + 2 * px(gridCss, "tab", "padding");
  const gridMarginTop = px(gridCss, "grid", "margin");
  const head = panelBorder + panelPadTop + tabsHeight + gridMarginTop;

  // Плитка: квадрат в ширину колонки + подпись и цена под ним.
  const tileChrome =
    px(gridCss, "title", "margin") +
    lineHeight(gridCss, "title") +
    px(gridCss, "meta", "margin") +
    lineHeight(gridCss, "meta");

  // Колонка: `minmax(<min>px, 1fr)`, десктопная — последняя.
  const minmaxes = [...gridCss.matchAll(/minmax\((\d+(?:\.\d+)?)px, 1fr\)/gu)].map((m) =>
    Number(m[1]),
  );
  const minCol = minmaxes[minmaxes.length - 1] as number;
  const [rowGap, colGap] = (() => {
    const match = /gap:\s*(\d+(?:\.\d+)?)px (\d+(?:\.\d+)?)px/u.exec(
      ruleBody(gridCss, "grid", "gap"),
    );
    expect(match, "у сетки нет двухчастного gap").not.toBeNull();
    return [Number(match?.[1]), Number(match?.[2])];
  })();

  // Порог десктопной ветки и боковые поля листа — из них выводится, сколько
  // колонок бывает МЕНЬШЕ ВСЕГО, а значит какая колонка бывает шире всего.
  const breakpoint = Number(/@media \(min-width: (\d+)px\)/u.exec(sceneCss)?.[1]);
  const sidePad = Number(/--imm-d-side-pad:\s*(\d+)px/u.exec(tokensCss)?.[1]);

  // Кромка «ниже есть ещё» (тикет 59): под ней обязано быть содержимое.
  const fadeHeight = px(sceneCss, "panelFade", "height");

  // Сам потолок.
  const ceiling = Number(/--sheet-max:\s*min\((\d+(?:\.\d+)?)px,/u.exec(sceneCss)?.[1]);

  it("слагаемые читаются из CSS, а не выдуманы", () => {
    expect({ panelBorder, panelPadTop, tabsHeight, gridMarginTop }).toEqual({
      panelBorder: 1,
      panelPadTop: 20,
      tabsHeight: 25.5,
      gridMarginTop: 14,
    });
    expect(head).toBeCloseTo(60.5, 4);
    expect(tileChrome).toBeCloseTo(40.45, 4);
    expect({ minCol, rowGap, colGap, breakpoint, sidePad, fadeHeight }).toEqual({
      minCol: 132,
      rowGap: 12,
      colGap: 10,
      breakpoint: 1024,
      sidePad: 44,
      fadeHeight: 30,
    });
    expect(ceiling, "в scene.module.css не нашлась --sheet-max: min(<N>px, …)").toBe(300);
  });

  it("самый высокий ряд бывает на самом УЗКОМ десктопе, а не на широком", () => {
    // `1fr` раздаёт колонкам остаток ряда: чем колонок меньше, тем каждая
    // толще, а плитка квадратная — значит и выше. Меньше всего колонок на
    // пороге десктопной ветки.
    const minCols = Math.floor((breakpoint - 2 * sidePad + colGap) / (minCol + colGap));
    expect(minCols, "на пороге десктопа стало другое число колонок").toBe(6);
    // Предел ширины колонки при N колонках: ещё пиксель — и влезет N+1-я.
    const widestCol = minCol + (minCol + colGap) / minCols;
    expect(widestCol).toBeCloseTo(155.67, 2);
    // Замер на стенде (1086×768): колонка 155.5, ряд 195.9 — расчёт сходится.
    expect(widestCol + tileChrome).toBeCloseTo(196.1, 1);
  });

  it("потолок вмещает шапку, самый высокий ряд и кромку следующего", () => {
    const minCols = Math.floor((breakpoint - 2 * sidePad + colGap) / (minCol + colGap));
    const widestRow = minCol + (minCol + colGap) / minCols + tileChrome;
    const needed = head + widestRow + rowGap + fadeHeight;
    expect(
      ceiling,
      `потолок листа ${ceiling} < ${needed.toFixed(1)} = шапка ${head} + ряд ` +
        `${widestRow.toFixed(1)} + шаг ${rowGap} + кромка ${fadeHeight}: ` +
        `на узком десктопе ряд плиток снова не влезет целиком`,
    ).toBeGreaterThanOrEqual(needed);
  });

  it("телефонная ветка потолка не изменилась (тикет 59 остаётся в силе)", () => {
    // Своя формула у телефона и своё число у десктопа — они не общие, и
    // правка одного не должна проезжать по другому.
    expect(sceneCss).toContain(
      "max-height: calc(100dvh - var(--band-h) * 0.75 - var(--rail-bottom));",
    );
    expect(sceneCss, "десктопный лист перестал брать высоту из --sheet-max").toMatch(
      /\.panel \{[^}]*max-height: var\(--sheet-max\);/u,
    );
    // Подпись зоны считает своё место от того же числа: разъедутся — «Отойти»
    // уедет под лист или повиснет в воздухе.
    expect(sceneCss).toContain(
      "bottom: calc(var(--band-bleed-y) + var(--rail-bottom) + var(--sheet-max) + 24px);",
    );
  });
});
