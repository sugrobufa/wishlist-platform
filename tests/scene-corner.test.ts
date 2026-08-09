// Знаки в правом верхнем углу сцены (тикеты 118 и 119) и артефакт
// «поделиться» под открытой зоной (тикет 121). Приёмка владельца 09.08.2026,
// ответ дизайна — турн 36c.
//
// ЧТО ЗДЕСЬ ЗАЩИЩАЕТСЯ:
// - знак «Списком» и знак «Сокровищница» есть у ОБЕИХ сторон, в одном месте и
//   ведут каждый в свой существующий экран;
// - пилюли со словами, стоявшие под оглавлением зон, не вернулись: слово
//   живёт только в `aria-label` и подсказке;
// - у гостя шкатулки НЕТ при закрытой витрине, и решается это тем же
//   механизмом, что собрал тикет 116 (канал «занято», поле `hallOpen`), —
//   второго запроса и чтения сессии на ISR-странице не появилось;
// - числа доски: знак 22 на цели 44, плашка rgba(11,8,6,.55) с блюром;
// - знаки лежат ПОВЕРХ кадра и в раскладку (тикеты 42/45) не входят;
// - кнопка «поделиться» при открытой зоне снята с рендера — не «прозрачна»:
//   прозрачный элемент поверх листа остаётся кликабельным, и это был второй
//   баг в том же месте.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IconList, IconTreasury } from "../src/components/icons";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const ownerPage = read("../src/app/room/page.tsx");
const guestPage = read("../src/app/r/[slug]/page.tsx");
const corner = read("../src/components/scene/scene-corner.tsx");
const hallLink = read("../src/app/r/[slug]/booking/hall-link.tsx");
const shareButton = read("../src/app/room/share-button.tsx");
const globalsCss = read("../src/app/globals.css");

/**
 * Файлы набора лежат В РЕПОЗИТОРИИ (`design/package/handoff/icons`), а не в
 * папке входящих пакетов: та живёт на машине владельца, и тест, читающий
 * оттуда, зелёный только у него — в CI такой проверки просто нет. Тот же
 * адрес, что у набора таб-бара (tests/tab-icons.test.ts).
 */
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

describe("иконки угла — путь в путь с набором дизайна", () => {
  it.each([
    ["ui-list", IconList],
    ["ui-treasury", IconTreasury],
  ])("%s совпадает с файлом набора", (file, component) => {
    expect(fromOurs(component)).toEqual(fromPackage(file));
  });

  it("формат набора: сетка 24, контур 1.7, скруглённые концы, currentColor", () => {
    const svg = renderToStaticMarkup(createElement(IconTreasury));
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('stroke-width="1.7"');
    expect(svg).toContain('stroke-linecap="round"');
    expect(svg).toContain('stroke-linejoin="round"');
    // Цвет знак берёт у плашки — вшитого в набор #F2EDE4 у нас нет.
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).not.toContain("#F2EDE4");
  });

  it("точки «Списком» — заливка, а не контур: иначе знак читается как меню", () => {
    const svg = renderToStaticMarkup(createElement(IconList));
    expect(svg).toContain('fill="currentColor"');
  });
});

describe("знаки стоят у обеих сторон и ведут в свои экраны", () => {
  it("у хозяйки: «Списком» → /room/list, «Сокровищница» → /room/hall", () => {
    expect(ownerPage).toContain("<SceneCorner>");
    expect(ownerPage).toMatch(/<CornerMark href="\/room\/list" label=\{tList\("toList"\)\}/u);
    expect(ownerPage).toMatch(/<CornerMark href="\/room\/hall" label=\{tHall\("toHall"\)\}/u);
    expect(ownerPage).toContain("<IconList size={CORNER_ICON_SIZE} />");
    expect(ownerPage).toContain("<IconTreasury size={CORNER_ICON_SIZE} />");
  });

  it("у гостя: тот же ряд и те же знаки, адреса — его комнаты", () => {
    expect(guestPage).toContain("<SceneCorner>");
    expect(guestPage).toMatch(/<CornerMark href=\{`\$\{roomPath\}\/list`\}/u);
    expect(guestPage).toMatch(/<CornerMark href=\{hallHref\}/u);
    expect(guestPage).toContain("<IconList size={CORNER_ICON_SIZE} />");
    expect(guestPage).toContain("<IconTreasury size={CORNER_ICON_SIZE} />");
  });

  it("размер знака — одно число на обе стороны, руками не набивается", () => {
    expect(corner).toContain("export const CORNER_ICON_SIZE = 22;");
    for (const [name, page] of [
      ["комната хозяйки", ownerPage],
      ["комната гостя", guestPage],
    ] as const) {
      expect(page, name).toContain("CORNER_ICON_SIZE");
      expect(page, name).not.toMatch(/<Icon(?:List|Treasury) size=\{22\}/u);
    }
  });

  it("слово ушло с экрана в aria-label и подсказку", () => {
    // «Знак без слова обязан быть понятен сам» — но читалке и мыши слово
    // нужно, и оно есть у каждого знака.
    expect(corner).toContain("aria-label={label}");
    expect(corner).toContain("title={label}");
  });

  it("пилюли со словами под оглавлением зон не вернулись", () => {
    // Так они выглядели до тикетов 118/119: `btn-quiet` со строкой словаря.
    expect(ownerPage).not.toMatch(/btn-quiet[\s\S]{0,120}tList\("toList"\)/u);
    expect(guestPage).not.toMatch(/btn-quiet[\s\S]{0,120}tList\("toList"\)/u);
    expect(guestPage).not.toMatch(/btn-quiet[\s\S]{0,120}tHall\("toHall"\)/u);
    // У хозяйки слот `below` был ровно под эту пилюлю и опустел вместе с ней.
    expect(ownerPage).not.toContain("below={");
  });
});

describe("у гостя шкатулки нет при закрытой витрине (тикет 116, ADR-0011)", () => {
  it("три положения решаются тремя способами, и все три сохраняют ISR", () => {
    // ALL — знак рисует сервер: ответ один на всех.
    expect(guestPage).toMatch(/hasHall && room\.hallVisibility === "ALL" && \(/u);
    // MUTUAL — ответ про конкретного зрителя, его приносит клиентский HallLink.
    expect(guestPage).toMatch(/hasHall && room\.hallVisibility === "MUTUAL" && <HallLink/u);
    // NONE — ветки нет вовсе: знака не появляется ни при каком зрителе.
    expect(guestPage).not.toContain('hallVisibility === "NONE"');
    // Страница по-прежнему не читает сессию — иначе полностраничный ISR
    // (revalidate = 300) отдавал бы один ответ всем зрителям подряд.
    expect(guestPage).not.toMatch(/\bawait auth\(\)/u);
    expect(guestPage).not.toMatch(/from "next\/headers"/u);
  });

  it("HallLink берёт ответ из УЖЕ существующего канала «занято», без второго запроса", () => {
    expect(hallLink).toContain("useGuestBooking()");
    expect(hallLink).toContain("if (!hallOpen) return null;");
    // Ни своего fetch, ни нового роута ради одной ссылки.
    expect(hallLink).not.toContain("fetch(");
    expect(hallLink).not.toContain("useEffect");
  });

  it("знак витрины у гостя — тот же, что у хозяйки", () => {
    expect(hallLink).toContain("<IconTreasury size={CORNER_ICON_SIZE} />");
    expect(hallLink).toContain("<CornerMark href={href}");
  });
});

describe("числа знака и его место", () => {
  it("плашка 44×44 rgba(11,8,6,.55) с блюром — как в 36c", () => {
    expect(globalsCss).toMatch(/\.imm-corner-mark \{[\s\S]*?background: rgba\(11, 8, 6, 0\.55\);/u);
    expect(globalsCss).toMatch(/\.imm-corner-mark \{[\s\S]*?backdrop-filter: blur\(8px\);/u);
    expect(globalsCss).toMatch(
      /\.imm-corner-mark \{[\s\S]*?width: var\(--hit-target-min, 44px\);[\s\S]*?height: var\(--hit-target-min, 44px\);/u,
    );
  });

  it("ряд стоит в правом верхнем углу, шаг 8, и учитывает чёлку", () => {
    expect(globalsCss).toMatch(/\.imm-corner \{[\s\S]*?right: 14px;/u);
    expect(globalsCss).toMatch(
      /\.imm-corner \{[\s\S]*?top: calc\(12px \+ var\(--imm-safe-top, 0px\)\);/u,
    );
    expect(globalsCss).toMatch(/\.imm-corner \{[\s\S]*?gap: 8px;/u);
  });

  it("знаки лежат ПОВЕРХ кадра и раскладку не двигают (территория 42/45)", () => {
    // На телефоне знаки выпадают из потока верхней полосы в самый угол — в
    // формулу коробки сцены и целей нажатия зон (immersive-layout.ts) они не
    // входят, ровно как не входит постоянный таб-бар.
    expect(globalsCss).toMatch(/\.imm-corner \{[\s\S]*?position: absolute;/u);
    expect(globalsCss).toMatch(/\.imm-corner \{[\s\S]*?z-index: 3;/u);
    const layout = read("../src/components/scene/immersive-layout.ts");
    expect(layout).not.toContain("imm-corner");
  });

  it("на десктопе знаки встают В РЯД полосы, а не ложатся на служебные ссылки", () => {
    // Строка ссылок шапки идёт от того же правого края и на той же высоте:
    // отдельным слоем поверх знаки легли бы прямо на неё. Место им даёт
    // четвёртая колонка сетки — только так они выравниваются со ссылками по
    // одной оси.
    expect(globalsCss).toMatch(
      /\.imm-top-grid \{\s*grid-template-columns: minmax\(0, 1fr\) auto auto auto;\s*grid-template-areas: "titles quiet actions corner";/u,
    );
    // Правило обязано стоять ПОСЛЕ базового `.imm-corner`: вес у них
    // одинаковый, побеждает нижнее по файлу.
    const base = globalsCss.indexOf(".imm-corner {");
    expect(base).toBeGreaterThan(-1);
    expect(globalsCss.slice(base)).toMatch(
      /@media \(min-width: 1024px\) \{\s*\.imm-corner \{\s*position: static;\s*grid-area: corner;/u,
    );
  });

  it("второй двери в витрину на десктопе не осталось: текстовой ссылки нет", () => {
    // Тот же довод, что и у таб-бара (тикет 119): знак-шкатулка стоит в том же
    // углу той же полосы, и текст «Сокровищница» рядом с ним — дважды
    // нарисованная дверь.
    expect(ownerPage).not.toContain('t("hallLink")');
    expect(ownerPage).toContain('t("connectionsLink")');
    expect(ownerPage).toContain('t("settingsLink")');
  });

  it("знаки — часть верхней полосы, а не свой слой со своим состоянием", () => {
    // Полоса при наезде камеры не прячется (имя комнаты видно всё время), и
    // знаки живут по её правилам. Своего состояния «зона открыта» у них нет —
    // прячутся только те вещи, которые в зоне начали бы врать (подсказка,
    // нить) или лечь на лист (значок «поделиться», тикет 121).
    expect(corner).not.toContain("useZoneIndexState");
    expect(corner).not.toContain("use client");
    for (const [name, page] of [
      ["комната хозяйки", ownerPage],
      ["комната гостя", guestPage],
    ] as const) {
      // Знаки стоят ВНУТРИ сетки шапки — иначе десктопная ветка CSS
      // (четвёртая колонка) не сработает, и они лягут на служебные ссылки.
      const grid = page.slice(page.indexOf("imm-top-grid"), page.indexOf("</header>"));
      expect(grid, name).toContain("<SceneCorner>");
    }
  });
});

describe("«поделиться» при открытой зоне (тикет 121)", () => {
  it("кнопки нет в дереве: ни видимой, ни прозрачной", () => {
    expect(shareButton).toContain('const { active: openZoneKey } = useZoneIndexState();');
    expect(shareButton).toContain("if (openZoneKey !== null) return null;");
  });

  it("полумер не осталось: ни opacity, ни visibility, ни pointer-events у самой кнопки", () => {
    // Ровно на этом владелец и поймал баг: круг «просвечивал» сквозь лист
    // зоны и оставался нажимаемым. Гасить наполовину здесь больше нечем.
    // Сам круг — ПОСЛЕДНЯЯ кнопка файла; выше него живут кнопки просьбы
    // укрепить аккаунт, и `pointer-events-none` у подтверждения с адресом
    // законен: оно висит НАД полосой и нажатия не перехватывает (тикет 24).
    const button = shareButton.slice(shareButton.lastIndexOf("<button"));
    expect(button).not.toMatch(/opacity-/u);
    expect(button).not.toMatch(/invisible/u);
    expect(button).not.toMatch(/pointer-events-none/u);
  });

  it("свой признак «зона открыта» кнопка не заводит — берёт из моста", () => {
    expect(shareButton).toContain('from "@/components/scene/zone-index-context"');
    expect(shareButton).not.toMatch(/useState<[^>]*zoom/iu);
  });
});
