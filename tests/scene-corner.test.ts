// Знаки в правом верхнем углу сцены (тикеты 118 и 119) и артефакт
// «поделиться» под открытой зоной (тикет 121). Приёмка владельца 09.08.2026,
// ответ дизайна — турн 36c.
//
// ЧТО ИЗМЕНИЛОСЬ (тикет 129). Знак «Списком» ИЗ УГЛА УШЁЛ: владелец показал
// снимком, что ему место в полосе под кадром, у правого края, и что он должен
// переключать содержимое этой полосы, а не уводить на отдельную страницу.
// Проверки «в углу два знака» поэтому переписаны на «в углу одна шкатулка», а
// сам переключатель проверяется своим файлом (tests/rail-list-toggle).
// Знак сокровищницы владелец не двигал — он только забраковал рисунок, и
// шкатулка стала бриллиантом (набор обновлён, сверка ниже — та же).
//
// ЧТО ЗДЕСЬ ЗАЩИЩАЕТСЯ:
// - знак «Сокровищница» есть у ОБЕИХ сторон, в одном месте и ведёт в свой
//   существующий экран;
// - одиночный знак в углу не тянет за собой раскладку, рассчитанную на двоих;
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
import { IconHall, IconList, IconTreasury } from "../src/components/icons";

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

describe("иконки — путь в путь с набором дизайна", () => {
  it.each([
    // `ui-list` живёт теперь не в углу, а в полосе (тикет 129) — сверка та же:
    // знак не менялся, менялось его место.
    ["ui-list", IconList],
    ["ui-treasury", IconTreasury],
  ])("%s совпадает с файлом набора", (file, component) => {
    expect(fromOurs(component)).toEqual(fromPackage(file));
  });

  it("шкатулка стала бриллиантом — и только у знаков ВИТРИНЫ", () => {
    // Владелец 09.08: «мне не нравится сундук, нужна другая, более читаемая,
    // может бриллиант». Дизайн ответил новой редакцией `ui-treasury` и
    // `action-treasury`. Знак таб-бара (`IconHall`, файл `tab-treasury`) при
    // этом остался шкатулкой — его никто не браковал, и место витрины в баре
    // живо (тикет 132). Сверяем, что мы не поменяли лишнего.
    expect(fromOurs(IconTreasury)).toEqual(fromPackage("action-treasury"));
    expect(fromOurs(IconHall)).toEqual(fromPackage("tab-treasury"));
    expect(fromOurs(IconTreasury)).not.toEqual(fromOurs(IconHall));
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

describe("знак витрины стоит у обеих сторон и ведёт в свой экран", () => {
  it("у хозяйки: «Сокровищница» → /room/hall, и она в углу одна", () => {
    expect(ownerPage).toContain("<SceneCorner>");
    expect(ownerPage).toMatch(/<CornerMark href="\/room\/hall" label=\{tHall\("toHall"\)\}/u);
    expect(ownerPage).toContain("<IconTreasury size={CORNER_ICON_SIZE} />");
    // Знак «Списком» уехал в полосу (тикет 129) — в углу его нет.
    expect(ownerPage).not.toMatch(/<CornerMark href="\/room\/list"/u);
  });

  it("у гостя: то же место и тот же знак, адрес — его комнаты", () => {
    expect(guestPage).toContain("<SceneCorner>");
    expect(guestPage).toMatch(/<CornerMark href=\{hallHref\}/u);
    expect(guestPage).toContain("<IconTreasury size={CORNER_ICON_SIZE} />");
    expect(guestPage).not.toMatch(/<CornerMark href=\{`\$\{roomPath\}\/list`\}/u);
  });

  it("одиночный знак в углу не сломал раскладку ряда", () => {
    // Ряд собран флексом с шагом, а не сеткой на две колонки: убыль знака
    // ничего не двигает, и второй при надобности встанет рядом.
    expect(globalsCss).toMatch(/\.imm-corner \{[\s\S]*?display: flex;/u);
    expect(globalsCss).not.toMatch(/\.imm-corner \{[\s\S]*?grid-template-columns/u);
    // Дети ряда рисуют страницы, и число их не зашито в компоненте.
    expect(corner).toContain("children");
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
    // Слот `below` у хозяйки СНОВА ЗАНЯТ, и это не возврат пилюли: там стоят
    // блоки пустой комнаты («Или начни с готового» и плашка про пять вещей).
    // Прежде оба были `position: fixed` и ложились на строки зон — починка
    // наложения, приёмка 09.08.
    expect(ownerPage).toContain("imm-empty-slot");
  });
});

describe("блоки пустой комнаты стоят в потоке полосы, а не слоем поверх неё", () => {
  // ЧТО БЫЛО СЛОМАНО. В пустой комнате под кадром оказывались три слоя, ничего
  // не знающих друг о друге: строки зон (нижняя полоса, absolute от кадра до
  // таб-бара), «Или начни с готового» (fixed, таб-бар + 78) и плашка про пять
  // вещей (fixed, таб-бар + 18). Высоты у двух последних отмерены на глаз, и
  // слова шли прямо сквозь слова. В комнате С ВЕЩАМИ обоих блоков нет вовсе —
  // потому поломка и жила незамеченной.
  it("ни у одного из блоков не осталось своего позиционирования", () => {
    for (const selector of ["imm-starter", "imm-share-plaque"]) {
      const body = new RegExp(`\\.${selector} \\{([^}]*)\\}`, "u").exec(globalsCss)?.[1] ?? "";
      expect(body, `${selector}: правило не найдено`).not.toBe("");
      expect(body, `${selector}: position должен уйти вместе с отступами`).not.toMatch(
        /position:\s*fixed/u,
      );
      expect(body, `${selector}: отступ от таб-бара отмерян на глаз`).not.toMatch(
        /--imm-tab-bar/u,
      );
    }
  });

  it("оба живут одним контейнером в слоте `below` нижней полосы", () => {
    expect(globalsCss).toMatch(/\.imm-empty-slot \{[\s\S]*?flex-direction: column;/u);
    // Контейнер стоит внутри ZoneRail, а не рядом с таб-баром.
    const rail = ownerPage.slice(ownerPage.indexOf("<ZoneRail"), ownerPage.indexOf("</ZoneRail>"));
    expect(rail).toContain("imm-empty-slot");
    expect(rail).toContain("<StarterPack");
    expect(rail).toContain("imm-share-plaque");
  });

  it("список зон гибкий, а блоки — нет: место отдаёт он, а не они", () => {
    // Стопка полосы — flex-колонка; список прокручивается сам (min-height: 0),
    // слот `below` объявлен `flex: none`. Наложиться такой стопке нечем.
    const railCss = read("../src/components/scene/zone-index.module.css");
    expect(railCss).toMatch(/\.below \{[\s\S]*?flex: none;/u);
    const listCss = read("../src/components/scene/zone-list.module.css");
    expect(listCss).toMatch(/\.list \{[\s\S]*?min-height: 0;[\s\S]*?overflow-y: auto;/u);
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
