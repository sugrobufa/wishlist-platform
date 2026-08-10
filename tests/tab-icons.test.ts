// Набор иконок таб-бара (тикет 111, доска Б19; файлы — раунд 21).
//
// Иконки пришли шестью SVG. Тест сверяет НАШИ компоненты с ЕГО файлами
// путь в путь: набор — контракт дизайна, и «похоже» здесь не считается.
// Один сдвинутый узел ломает рифму знаков, а увидеть это глазами на 22 px
// нельзя.
//
// Сверяется и формат набора: сетка 24, контур 1.7, скруглённые концы. Цвет
// у нас `currentColor` (у него в файлах вшит #F2EDE4) — это не расхождение,
// а единственный способ дать иконке гореть акцентом активной вкладки.
//
// ЧТО ИЗМЕНИЛОСЬ (тикет 146, пакет раунда 35). `tab-treasury.svg` был аркой со
// скважиной, и её рисовал отдельный компонент `IconHall`. Дизайн прислал новую
// редакцию файла — БРИЛЛИАНТ, те же контуры, что у `ui-treasury` и
// `action-treasury`, — и `IconHall` удалён: арки не осталось ни в одном файле
// набора, сверять его стало не с чем. Место витрины в баре теперь рисует тот
// же `IconTreasury`, что стоит в углу сцены.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import {
  IconPeople,
  IconPerson,
  IconPlus,
  IconRoom,
  IconSettings,
  IconTreasury,
} from "../src/components/icons";

/**
 * Файлы набора лежат В РЕПОЗИТОРИИ, а не в папке входящих пакетов: та живёт
 * на машине владельца, и тест, читающий оттуда, зелёный только у него —
 * в CI такой проверки просто нет.
 */
const PACKAGE_ICONS = path.join("design", "package", "handoff", "icons");

/** Геометрия знака: пути и круги по порядку — без цвета и размеров. */
function shapeOf(svg: string): string[] {
  const paths = [...svg.matchAll(/d="([^"]+)"/g)].map((m) => `path:${m[1]}`);
  const circles = [...svg.matchAll(/<circle[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"[^>]*r="([\d.]+)"/g)].map(
    (m) => `circle:${m[1]},${m[2]},${m[3]}`,
  );
  return [...paths, ...circles].sort();
}

function fromPackage(file: string): string[] {
  return shapeOf(readFileSync(path.join(PACKAGE_ICONS, `${file}.svg`), "utf8"));
}

function fromOurs(component: Parameters<typeof createElement>[0]): string[] {
  return shapeOf(renderToStaticMarkup(createElement(component)));
}

describe("иконки таб-бара — путь в путь с набором дизайна", () => {
  it.each([
    ["tab-add", IconPlus],
    ["tab-friends", IconPeople],
    ["tab-profile", IconPerson],
    // Витрину в баре рисует общий знак витрины, а не свой знак бара (тикет
    // 146): файл `tab-treasury.svg` новой редакции — тот же бриллиант.
    ["tab-treasury", IconTreasury],
  ])("%s совпадает с файлом набора", (file, component) => {
    expect(fromOurs(component)).toEqual(fromPackage(file));
  });

  it("«Комната» совпадает по арке, а тёплая точка — НАША и остаётся", () => {
    // Доска Б19 просит «арку с тёплой точкой», но в присланном файле точки
    // нет. Точка — единственная законная заливка набора (tokens.json →
    // icons.exception) и горит только у активной вкладки. Сверяем арку, а
    // расхождение по точке записано в письме.
    const withoutDot = fromOurs(() => createElement(IconRoom, { dot: false }));
    expect(withoutDot).toEqual(fromPackage("tab-room"));
    expect(fromOurs(IconRoom).length).toBe(withoutDot.length + 1);
  });

  it("у витрины ОДИН знак на все три её места (тикет 146)", () => {
    // ПРАВИЛО. Витрина у человека одна, и во всём продукте её называет один
    // рисунок: угол сцены, лист действий вещи и таб-бар. Три файла набора
    // держат одну геометрию, и оба наших компонента — её же.
    //
    // ЧТО СЛОМАЕТСЯ, ЕСЛИ НАРУШИТЬ. В комнате угол сцены и таб-бар видны
    // ОДНОВРЕМЕННО: разойдись файлы — на одном экране окажутся два разных
    // знака одного места, и человек прочитает их как две разные двери. Ровно
    // за это владелец забраковал шкатулку 09.08, и ровно поэтому арку из бара
    // убрал сам дизайн (раунд 35). Тест падает при правке ЛЮБОГО из трёх
    // файлов поодиночке — а именно так расхождение и заводится.
    const tab = fromPackage("tab-treasury");
    expect(fromPackage("ui-treasury"), "угол сцены разошёлся с таб-баром").toEqual(tab);
    expect(fromPackage("action-treasury"), "лист действий разошёлся с таб-баром").toEqual(tab);
    expect(fromOurs(IconTreasury)).toEqual(tab);
  });

  it("арка со скважиной не вернулась ни в набор, ни в код", () => {
    // `IconHall` удалён (тикет 146): в наборе не осталось файла с этими
    // контурами, а знак, которому нечем поверяться, тихо разъезжается с
    // доской. Ловим сами узлы — вернётся арка копией под другим именем,
    // упадёт здесь.
    const iconsSource = readFileSync(
      fileURLToPath(new URL("../src/components/icons.tsx", import.meta.url)),
      "utf8",
    );
    for (const node of [
      'd="M4.5 11.5h15V19a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 19v-7.5z"',
      '<circle cx="12" cy="14.6" r="1.5"',
    ]) {
      expect(iconsSource, node).not.toContain(node);
    }
    expect(iconsSource).not.toContain("export function IconHall");
  });

  it("формат набора: сетка 24, контур 1.7, скруглённые концы, currentColor", () => {
    const svg = renderToStaticMarkup(createElement(IconTreasury));
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('stroke-width="1.7"');
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-linejoin="round"');
    // Цвет иконка берёт у вкладки — вшитого в набор #F2EDE4 у нас нет.
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).not.toContain("#F2EDE4");
  });
});

describe("знаки живут В РЯДУ, и в ряду они обязаны различаться (тикет 147)", () => {
  // ТРЕТИЙ СЛУЧАЙ ОДНОЙ БОЛЕЗНИ ЗА ДЕНЬ. Витрина в баре рисовалась аркой, а
  // через одно место стоит «Комната» — та же арка с точкой (тикет 138).
  // Шкатулку в углу владелец забраковал 09.08 как нечитаемую на 22 px.
  // «Настройки» оказались силуэтом «Друзей», нарисованным один раз вместо
  // двух (тикет 147, приёмка 10.08). Набор рисовался по знаку за раз, а живут
  // знаки рядами по три-пять штук на одном экране размером 22 px.
  //
  // ЧЕГО ЭТОТ ТЕСТ НЕ УМЕЕТ, И ЭТО ЧЕСТНО СКАЗАТЬ: «похоже ли» решает глаз, а
  // не машина — `IconPerson` и `IconPeople` разными числами рисуют один и тот
  // же силуэт, и никакая сверка путей этого не поймает. Аудит ряда заказан
  // дизайну письмом 39. Здесь держим ровно то, что машина держать может:
  // состав ряда и названную владельцем пару.
  const source = (file: string) =>
    readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

  /** Знаки, которые страница ставит в один ряд, — по её же импорту и разметке. */
  const usedIn = (code: string): string[] => [
    ...new Set([...code.matchAll(/<(Icon[A-Za-z]+) size=\{(?:CORNER_ICON_SIZE|size)\}/gu)].map((m) => m[1] as string)),
  ];

  const barRow = usedIn(source("../src/components/tab-bar/tab-slots.tsx"));
  const cornerRow = usedIn(source("../src/app/room/page.tsx"));

  it("в ряду нет одного знака дважды", () => {
    for (const [where, row] of [
      ["таб-бар", barRow],
      ["угол сцены", cornerRow],
    ] as const) {
      expect(new Set(row).size, `${where}: один знак стоит в ряду дважды`).toBe(row.length);
    }
  });

  it("силуэт человека и силуэт двоих в одном ряду не стоят", () => {
    // Пара, которую владелец увидел первым: «Друзья и настройки выглядят
    // одинаково». Круг головы плюс дуга плеч — у соседа он же, просто дважды.
    for (const [where, row] of [
      ["таб-бар", barRow],
      ["угол сцены", cornerRow],
    ] as const) {
      const both = row.includes("IconPerson") && row.includes("IconPeople");
      expect(both, `${where}: силуэт человека снова стоит рядом с силуэтом двоих`).toBe(false);
    }
  });

  it("«Настройки» рисует шестерня, и она НАША — файла в наборе нет", () => {
    // Оформлена как открытый глаз (тикет 51): рисуем сами, держим правилом,
    // спрашиваем дизайн письмом. Придёт файл — пути меняются в icons.tsx, в
    // одном месте, и эта проверка станет сверкой с файлом.
    expect(barRow).toContain("IconSettings");
    expect(cornerRow).toContain("IconSettings");
    expect(
      existsSync(path.join(PACKAGE_ICONS, "tab-settings.svg")),
      "файл шестерни появился в наборе — сверять её пути, а не держать правилом",
    ).toBe(false);
    // Формат набора у нашего знака тот же, что у канона.
    const svg = renderToStaticMarkup(createElement(IconSettings));
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('stroke-width="1.7"');
    expect(svg).toContain('stroke="currentColor"');
  });

  it("силуэт человека из набора никуда не делся — у него две другие работы", () => {
    // Он остаётся `tab-profile.svg` канона (сверка выше) и силуэтом-заглушкой
    // аватара там, где у человека нет фотографии. Удалить его вместе с
    // «Настройками» значило бы выбросить знак набора и заглушку разом.
    expect(fromOurs(IconPerson)).toEqual(fromPackage("tab-profile"));
    const avatarUsers = [
      "../src/app/connections/connections-list.tsx",
      "../src/components/consent/stay-in-touch.tsx",
    ];
    expect(
      avatarUsers.filter((file) => source(file).includes("IconPerson")).length,
      "силуэт-заглушка аватара больше нигде не рисуется — проверь, не мёртвый ли знак",
    ).toBeGreaterThan(0);
  });
});
