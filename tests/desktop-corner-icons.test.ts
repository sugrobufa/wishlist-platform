// Верхний правый угол десктопа — целиком знаками (тикет 135, приёмка владельца
// 09.08.2026: «в десктопе надо наверху в правом углу всё превратить в иконки»).
//
// ЧТО БЫЛО. В шапке комнаты стояли два СЛОВА — «Друзья» и «Настройки» — и
// рядом знак витрины. Ряд из слов и картинки читается как две разные панели,
// случайно поставленные рядом. На телефоне беды нет: там те же пункты живут в
// таб-баре со своими знаками, а в углу сцены только витрина.
//
// ЧТО ЗДЕСЬ ЗАЩИЩАЕТСЯ:
// - слов в углу не осталось: они ушли в `aria-label` и подсказку;
// - знаки взяты ИЗ КАНОНА (`tab-friends.svg`, `tab-profile.svg`) и совпадают
//   с файлами пакета путь в путь — новых для этого места не рисовали. Два
//   разных знака одного места разошлись бы при первой правке;
// - плашка и цель нажатия — одни на весь ряд, из общего `CornerMark`;
// - ПРОМЕЖУТОК разводит две группы: уход СО страницы и работу С комнатой.
//   Ровным шагом три одинаковых кружка читаются одним набором;
// - ряд не двигает сцену: её коробку считает immersive-layout (тикеты 42/45),
//   и верхняя полоса в эту формулу не входит.
//
// ОСТОРОЖНО С ОПИСАНИЕМ ТИКЕТА: снимок владельца сделан ДО выката тикета 129,
// и знак «Списком» в углу там ещё есть. В свежем коде его нет — он переехал в
// полосу под кадром, и справа от служебных знаков стоит одна витрина.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IconPeople, IconPerson } from "../src/components/icons";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const ownerPage = read("../src/app/room/page.tsx");
const corner = read("../src/components/scene/scene-corner.tsx");
const globalsCss = read("../src/app/globals.css");
const layout = read("../src/components/scene/immersive-layout.ts");

const PACKAGE_ICONS = path.join("design", "package", "handoff", "icons");

/** Геометрия знака: пути и круги по порядку — без цвета и размеров. */
function shapeOf(svg: string): string[] {
  const paths = [...svg.matchAll(/d="([^"]+)"/g)].map((m) => `path:${m[1]}`);
  const circles = [
    ...svg.matchAll(/<circle[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"[^>]*r="([\d.]+)"/g),
  ].map((m) => `circle:${m[1]},${m[2]},${m[3]}`);
  return [...paths, ...circles].sort();
}

const fromPackage = (file: string) =>
  shapeOf(readFileSync(path.join(PACKAGE_ICONS, `${file}.svg`), "utf8"));
const fromOurs = (component: Parameters<typeof createElement>[0]) =>
  shapeOf(renderToStaticMarkup(createElement(component)));

/** Ряд служебных входов шапки — от `<nav` до его закрытия. */
const actionsRow = (() => {
  const start = ownerPage.indexOf('<nav className="imm-area-actions');
  return start === -1 ? "" : ownerPage.slice(start, ownerPage.indexOf("</nav>", start));
})();

describe("слов в углу не осталось", () => {
  it("ряд собран знаками, а не текстовыми ссылками", () => {
    expect(actionsRow, "ряд служебных входов не найден").not.toBe("");
    expect(actionsRow).toContain("<CornerMark href=\"/connections\"");
    expect(actionsRow).toContain("<CornerMark href=\"/settings\"");
    // Прежний вид: тихая текстовая ссылка со словом прямо в разметке.
    expect(actionsRow).not.toMatch(/text-xs font-semibold text-text-muted/u);
    expect(actionsRow).not.toMatch(/>\s*\{t\("(?:connectionsLink|settingsLink)"\)\}\s*</u);
  });

  it("слово живёт в aria-label и подсказке — их даёт общий CornerMark", () => {
    // Знак без слова обязан называть себя читалке и мыши. Своей разметки для
    // этого ряд не заводит: подпись ставит тот же компонент, что и у витрины.
    expect(actionsRow).toContain('label={t("connectionsLink")}');
    expect(actionsRow).toContain('label={t("settingsLink")}');
    expect(corner).toContain("aria-label={label}");
    expect(corner).toContain("title={label}");
  });
});

describe("знаки — из канона, новых не рисовали", () => {
  it.each([
    ["tab-friends", IconPeople],
    ["tab-profile", IconPerson],
  ])("%s совпадает с файлом набора путь в путь", (file, component) => {
    expect(fromOurs(component)).toEqual(fromPackage(file));
  });

  it("те же компоненты рисуют таб-бар телефона — знак у места один", () => {
    // Ровно этого требует тикет: два разных знака для одного места разошлись
    // бы при первой правке. Ловим импорт из общего файла набора, а не копию.
    expect(ownerPage).toMatch(
      /import \{ IconPeople, IconPerson, IconTreasury \} from "@\/components\/icons";/u,
    );
    const slots = read("../src/components/tab-bar/tab-slots.tsx");
    expect(slots).toContain("IconPeople");
    expect(slots).toContain("IconPerson");
  });

  it("размер 22 берётся из общего числа, а не набивается руками", () => {
    expect(actionsRow).toContain("<IconPeople size={CORNER_ICON_SIZE} />");
    expect(actionsRow).toContain("<IconPerson size={CORNER_ICON_SIZE} />");
    expect(corner).toContain("export const CORNER_ICON_SIZE = 22;");
    expect(actionsRow).not.toMatch(/size=\{22\}/u);
  });

  it("плашка и цель 44 — те же, что у соседа справа (тикет 119)", () => {
    // Ряд одного рода: одна плашка на все знаки, и живёт она в одном правиле.
    expect(globalsCss).toMatch(
      /\.imm-corner-mark \{[\s\S]*?width: var\(--hit-target-min, 44px\);[\s\S]*?height: var\(--hit-target-min, 44px\);/u,
    );
    expect(globalsCss).toMatch(/\.imm-corner-mark \{[\s\S]*?background: rgba\(11, 8, 6, 0\.55\);/u);
    expect(globalsCss).toMatch(/\.imm-corner-mark \{[\s\S]*?backdrop-filter: blur\(8px\);/u);
  });
});

describe("промежуток разводит две группы", () => {
  it("внутри группы шаг 8, между группами 18", () => {
    // Слева уход СО страницы (Друзья, Настройки), справа работа С комнатой
    // (витрина). Без разного шага ряд читается одним набором равных действий.
    const actions = /\.imm-area-actions \{([^}]*)\}/u.exec(globalsCss)?.[1] ?? "";
    expect(actions, "правило ряда не найдено").not.toBe("");
    expect(actions).toMatch(/gap: 8px;/u);
    expect(globalsCss).toMatch(/\.imm-corner \{[\s\S]*?gap: 8px;/u);
    expect(globalsCss).toMatch(
      /@media \(min-width: 1024px\) \{\s*\.imm-corner \{\s*position: static;\s*grid-area: corner;\s*margin-left: 18px;/u,
    );
  });

  it("на телефоне ряда нет вовсе: те же пункты стоят в таб-баре", () => {
    expect(ownerPage).toMatch(/className="imm-area-actions imm-desktop-only"/u);
    expect(globalsCss).toMatch(/\.imm-rail \.imm-desktop-only \{\s*display: none;/u);
  });
});

describe("ряд знаков не двигает сцену (территория тикетов 42/45)", () => {
  it("верхняя полоса в формулу коробки кадра не входит", () => {
    expect(layout).not.toContain("imm-area-actions");
    expect(layout).not.toContain("imm-corner");
  });

  it("знаки стоят В СЕТКЕ шапки, каждая группа своей колонкой", () => {
    // Отдельным слоем поверх они легли бы прямо на этот же ряд: он идёт от
    // того же правого края и на той же высоте.
    expect(globalsCss).toMatch(
      /\.imm-top-grid \{\s*grid-template-columns: minmax\(0, 1fr\) auto auto auto;\s*grid-template-areas: "titles quiet actions corner";/u,
    );
    expect(globalsCss).toMatch(/\.imm-area-actions \{[\s\S]*?grid-area: actions;/u);
  });
});
