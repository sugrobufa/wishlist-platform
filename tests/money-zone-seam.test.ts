// Стык двух строк действий в зоне «Просто деньги» (тикет 192).
//
// ЧТО СЛОМАЛОСЬ. Приёмка владельца 11.08, замечание 6 со скриншотом: «Баг,
// наслоение кнопок Показать все и Назвать цель». В зоне денег строк действий
// ДВЕ, и они друг о друге не знают: своя у карточки копилки («Назвать цель»,
// `.actions { margin-top: 18px }`) и своя у зоны («Показать все · + Добавить
// вещь», `mb-4`). Карточка рисовалась ПЕРВОЙ, её строка кончалась вплотную к
// пилюлям зоны — ноль между ними, — а свечение кнопки (`box-shadow: 0 4px 18px
// -3px`) ложилось прямо на них.
//
// ЗАЧЕМ ТЕСТ. Баг вернётся не переписыванием файла, а одной строкой соседа:
// правило тикета 139 («управляющие кнопки наверху») выполнялось в девяти зонах
// из десяти, и достаточно снова поставить карточку первой — или снять у её
// `.actions` нижний отступ, — чтобы стык сошёлся в ноль. Ни один существующий
// тест этого не видит: разметка валидна, числа на месте, падать нечему.
//
// ПОЧЕМУ ПРЯМОУГОЛЬНИКИ СЧИТАЮТСЯ, А НЕ МЕРЯЮТСЯ. Юниты идут в node
// (`vitest.config.ts` → environment: "node") — вёрстки в прогоне нет вовсе, и
// `getBoundingClientRect` вернуть тут нечего. Поэтому прямоугольники СОБИРАЮТСЯ
// из настоящих чисел: отступы и коробки читаются из тех самых файлов CSS, а
// порядок блоков — из тех самых `.tsx`. Правка любого из них меняет ответ
// модели, а не только текст рядом. Живой замер `getBoundingClientRect` на 375
// делает телефонный e2e (`e2e/mobile-layout.spec.ts`, правило 4).
//
// ЧЕГО МОДЕЛЬ НЕ ЗНАЕТ: ширины слов (шрифта в прогоне нет) и высоты абзацев в
// несколько строк. И то и другое считается по НИЖНЕЙ границе — в одну строку,
// — а высоты стоят между стыком и его соседями только сверху вниз: всякая
// лишняя строка отодвигает кнопки друг от друга, а не сближает. Значит модель
// врёт в безопасную сторону: сойдётся зазор здесь — сойдётся и в браузере.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import tokensJson from "@design/tokens.json";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const cardCss = read("../src/components/zone/money-goal.module.css");
const card = read("../src/components/zone/money-goal-card.tsx");
const panel = read("../src/components/scene/zone-panel.tsx");
const sceneCss = read("../src/components/scene/scene.module.css");
const globals = read("../src/app/globals.css");
const ownerPage = read("../src/app/room/page.tsx");
const zonePage = read("../src/app/room/zone/[zone]/page.tsx");
const messages = JSON.parse(read("../messages/ru.json")) as { Goal: Record<string, string> };

const spacing = (tokensJson as unknown as { spacing: { scale: number[] } }).spacing;

/** Зазор из тикета: ниже него стык читается наслоением. */
const MIN_GAP = 12;

/** Приёмка идёт с телефона — на нём и считаем. */
const SCREEN = 375;

/** Шаг сетки Tailwind v4 (0.25rem); своего `--spacing` проект не задаёт. */
const tw = (units: number) => units * 4;

// ---------- Чтение чисел из настоящих файлов ----------

/** Тело правила по имени класса. */
function rule(source: string, selector: string): string {
  const found = new RegExp(`\\.${selector} \\{([^}]*)\\}`, "u").exec(source);
  expect(found, `правило .${selector} пропало`).toBeTruthy();
  return (found as RegExpExecArray)[1] as string;
}

const px = (value: string): number => Number(value.replace("px", ""));

/** Стороны CSS-сокращения: 1 значение → все, 2 → верх/низ и бока, и так далее. */
function sides(values: string[]): { top: number; right: number; bottom: number; left: number } {
  const [a = 0, b, c, d] = values.map(px);
  const top = a;
  const right = b ?? a;
  const bottom = c ?? a;
  const left = d ?? right;
  return { top, right, bottom, left };
}

/**
 * Число отступа/поля — хоть longhand-записью, хоть сокращением. Нет свойства —
 * ноль: это и есть «отступа не задано».
 */
function edge(body: string, prop: "margin" | "padding", side: "top" | "bottom" | "left"): number {
  const long = new RegExp(`${prop}-${side}:\\s*([-\\d.]+px|0)\\s*;`, "u").exec(body);
  if (long) return px(long[1] as string);
  const short = new RegExp(`(?:^|;|\\*/)\\s*${prop}:\\s*([^;]+);`, "u").exec(body);
  if (!short) return 0;
  return sides((short[1] as string).trim().split(/\s+/u))[side];
}

/** Высота строк текста по записи `font: 600 13px/1.4 …`. */
function textHeight(body: string, lines = 1): number {
  const found = /font:\s*\d+\s+([\d.]+)px\/([\d.]+)/u.exec(body);
  expect(
    found,
    `в правиле нет разбираемой записи шрифта: ${body.trim().slice(0, 60)}`,
  ).toBeTruthy();
  const [, size, line] = found as RegExpExecArray;
  return Number(size) * Number(line) * lines;
}

type Shadow = { x: number; y: number; blur: number; spread: number };

/** `box-shadow: 0 4px 18px -3px …` — четыре числа тени. */
function shadow(body: string): Shadow {
  const found = /box-shadow:\s*([-\d.]+px|0)\s+([-\d.]+px|0)\s+([-\d.]+px|0)\s+([-\d.]+px|0)/u.exec(
    body,
  );
  expect(found, "у кнопки пропала запись свечения").toBeTruthy();
  const [, x, y, blur, spread] = found as RegExpExecArray;
  return {
    x: px(x as string),
    y: px(y as string),
    blur: px(blur as string),
    spread: px(spread as string),
  };
}

// ---------- Настоящие числа зоны денег ----------

const sheetPad = sides(
  (/padding:\s*([^;]+);/u.exec(rule(sceneCss, "panelBody"))?.[1] ?? "").split(/\s+/u),
);
/** Ширина полосы листа на 375 — в ней и раскладываются кнопки. */
const CONTENT = SCREEN - sheetPad.left - sheetPad.right;

const quietPill = rule(globals, "btn-quiet");
const PILL_BORDER = px(/border:\s*([\d.]+px)/u.exec(quietPill)?.[1] ?? "0");
const PILL_H =
  edge(quietPill, "padding", "top") +
  textHeight(quietPill) +
  edge(quietPill, "padding", "bottom") +
  PILL_BORDER * 2;

const root = rule(cardCss, "root");
const badge = rule(cardCss, "badge");
const title = rule(cardCss, "title");
const empty = rule(cardCss, "empty");
const amounts = rule(cardCss, "amounts");
const big = rule(cardCss, "big");
const hint = rule(cardCss, "hint");
const actions = rule(cardCss, "actions");
const primary = rule(cardCss, "primary");
const quiet = rule(cardCss, "quiet");

const ROOT_MT = edge(root, "margin", "top");
const ACTIONS_MT = edge(actions, "margin", "top");
const ACTIONS_MB = edge(actions, "margin", "bottom");
const ACTIONS_GAP = px(/gap:\s*([\d.]+px)/u.exec(actions)?.[1] ?? "0");
const GLOW = shadow(primary);

const BADGE_H =
  edge(badge, "padding", "top") + textHeight(badge) + edge(badge, "padding", "bottom");
const PRIMARY_H =
  textHeight(primary) +
  edge(primary, "padding", "bottom") +
  px(/border-bottom:\s*([\d.]+px)/u.exec(primary)?.[1] ?? "0");
const QUIET_H = textHeight(quiet);
/** Строка действий карточки ростом с самую высокую кнопку (align-items: center). */
const ACTIONS_H = Math.max(PRIMARY_H, QUIET_H);

// ---------- Крошечная раскладка: вертикальный поток и flex-строка ----------

type Rect = { top: number; bottom: number; left: number; right: number };
type Box = { name: string; marginTop: number; height: number; marginBottom: number };

/**
 * Вертикальный поток блоков: соседние отступы схлопываются в больший, как в
 * CSS. Ширина у всех одна — полоса листа: и пилюли зоны, и «Назвать цель»
 * начинаются от левого края, поэтому по X их полосы пересекаются при любой
 * ширине слова. Стык решает Y — его и считаем.
 */
function flow(boxes: Box[]): Map<string, Rect> {
  const out = new Map<string, Rect>();
  let y = 0;
  let pending = 0;
  boxes.forEach((box, index) => {
    y += index === 0 ? box.marginTop : Math.max(pending, box.marginTop);
    out.set(box.name, { top: y, bottom: y + box.height, left: 0, right: CONTENT });
    y += box.height;
    pending = box.marginBottom;
  });
  return out;
}

/** Строка `display: flex; flex-wrap: wrap; gap` — и по горизонтали, и по рядам. */
function flexRow(
  items: Array<{ name: string; width: number; height: number }>,
  containerWidth: number,
  gap: number,
): Map<string, Rect> {
  const out = new Map<string, Rect>();
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const item of items) {
    if (x > 0 && x + item.width > containerWidth) {
      y += rowHeight + gap;
      x = 0;
      rowHeight = 0;
    }
    out.set(item.name, { top: y, bottom: y + item.height, left: x, right: x + item.width });
    x += item.width + gap;
    rowHeight = Math.max(rowHeight, item.height);
  }
  return out;
}

function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Куда свечение уходит за собственную коробку кнопки. */
function withGlow(rect: Rect, sh: Shadow): Rect {
  const reach = sh.blur + sh.spread;
  return {
    top: rect.top - reach + sh.y,
    bottom: rect.bottom + reach + sh.y,
    left: rect.left - reach + sh.x,
    right: rect.right + reach + sh.x,
  };
}

function get(rects: Map<string, Rect>, name: string): Rect {
  const rect = rects.get(name);
  expect(rect, `в раскладке нет блока «${name}»`).toBeTruthy();
  return rect as Rect;
}

/** Два прямоугольника не пересекаются и стоят друг от друга не ближе, чем надо. */
function expectApart(above: Rect, below: Rect, what: string): number {
  expect(intersects(above, below), `${what}: прямоугольники наложились`).toBe(false);
  const gap = below.top - above.bottom;
  expect(
    gap,
    `${what}: между кнопками ${gap.toFixed(1)} px при минимуме ${MIN_GAP}`,
  ).toBeGreaterThanOrEqual(MIN_GAP);
  return gap;
}

// ---------- Стопка зоны денег ----------

/** Строка действий ЗОНЫ: «Показать все · + Добавить вещь», `mb-4` под собой. */
const ZONE_ACTIONS: Box = {
  name: "Показать все",
  marginTop: 0,
  height: PILL_H,
  marginBottom: tw(4),
};

/**
 * Карточка копилки глазами хозяйки. `.root` своих полей и границ не имеет, и
 * его верхний отступ схлопывается с отступом соседа — поэтому он приезжает
 * верхним отступом ПЕРВОГО блока карточки, а не отдельной коробкой.
 *
 * `goal: true` — цель задана: вместо подсказки встают сумма и тихая строка
 * «сколько собрано, узнаешь после праздника», а кнопка называется «Изменить
 * цель», и рядом появляется «Убрать копилку».
 */
function cardBoxes(goal: boolean): Box[] {
  const body: Box[] = [
    { name: "плашка", marginTop: ROOT_MT, height: BADGE_H, marginBottom: 0 },
    {
      name: "заголовок",
      marginTop: edge(title, "margin", "top"),
      height: textHeight(title),
      marginBottom: 0,
    },
  ];
  if (goal) {
    body.push(
      {
        name: "сумма",
        marginTop: edge(amounts, "margin", "top"),
        height: textHeight(big),
        marginBottom: 0,
      },
      {
        name: "тихая строка",
        marginTop: edge(hint, "margin", "top"),
        height: textHeight(hint),
        marginBottom: 0,
      },
    );
  } else {
    body.push({
      name: "подсказка",
      marginTop: edge(empty, "margin", "top"),
      height: textHeight(empty),
      marginBottom: 0,
    });
  }
  body.push({
    name: goal ? "Изменить цель" : "Назвать цель",
    marginTop: ACTIONS_MT,
    height: ACTIONS_H,
    marginBottom: ACTIONS_MB,
  });
  return body;
}

/** Ссылка «+ Добавить вещь» экрана зоны: `text-xs` — строка 16 по шкале Tailwind. */
const ADD_LINK: Box = {
  name: "+ Добавить вещь",
  marginTop: 0,
  height: 16,
  marginBottom: tw(6),
};

/**
 * ПОРЯДОК БЕРЁТСЯ ИЗ ФАЙЛА, А НЕ ИЗ ГОЛОВЫ ТЕСТА. Иначе прямоугольники сойдутся
 * при любой правке соседа: модель считала бы задуманную раскладку, а не ту,
 * которая нарисуется. Переставят карточку обратно наверх — стопка приедет
 * другая, и числа приедут с ней.
 */
function stackOf(source: string, actions: Box, marker: string, goal: boolean): Box[] {
  const cardAt = source.indexOf("<MoneyGoalCard");
  const actionsAt = source.indexOf(marker);
  expect(cardAt, "карточка копилки пропала из файла").toBeGreaterThan(-1);
  expect(actionsAt, "строка действий зоны пропала из файла").toBeGreaterThan(-1);
  return cardAt < actionsAt ? [...cardBoxes(goal), actions] : [actions, ...cardBoxes(goal)];
}

/** Лист зоны денег в сцене: `children` начинается строкой действий зоны. */
const sheetStack = (goal: boolean) => stackOf(panel, ZONE_ACTIONS, "{children ??", goal);

/** Экран «зона целиком списком»: та же пара, второе место вызова карточки. */
const screenStack = () => stackOf(zonePage, ADD_LINK, "href={`/room/add?zone=${zone.key}`}", false);

/** Кто выше, тот и первый: порядок задал файл, а не порядок аргументов. */
function ordered(a: Rect, b: Rect): [Rect, Rect] {
  return a.top <= b.top ? [a, b] : [b, a];
}

// ---------- Порядок: действия зоны первыми ВО ВСЕХ зонах ----------

describe("192 — карточка копилки идёт после действий зоны, а не перед ними", () => {
  it("в листе сцены `children` (а он начинается строкой действий) стоит раньше карточки", () => {
    const children = panel.indexOf("{children ??");
    const goalCard = panel.indexOf("<MoneyGoalCard");
    expect(children, "лист зоны перестал рисовать своё содержимое").toBeGreaterThan(-1);
    expect(goalCard, "карточка копилки пропала из листа зоны").toBeGreaterThan(-1);
    expect(
      children,
      "карточка копилки снова стоит НАД действиями зоны — правило тикета 139 выполняется не во всех зонах",
    ).toBeLessThan(goalCard);
  });

  it("на экране зоны целиком карточка идёт после «+ Добавить вещь»", () => {
    const add = zonePage.indexOf("href={`/room/add?zone=${zone.key}`}");
    const goalCard = zonePage.indexOf("<MoneyGoalCard");
    expect(add, "с экрана зоны пропала дорога «Добавить вещь»").toBeGreaterThan(-1);
    expect(goalCard, "карточка копилки пропала с экрана зоны").toBeGreaterThan(-1);
    expect(add, "второе место вызова карточки разъехалось с первым").toBeLessThan(goalCard);
  });

  it("строка действий зоны по-прежнему без верхнего отступа — своё место держит карточка", () => {
    // Проверяем именно это: у пилюль зоны отступа сверху нет и не должно быть
    // (тикет 139 поставил их первыми в листе). Значит стык обязан держать
    // сосед — карточка своим нижним отступом.
    expect(ownerPage).toContain('<div className="mb-4 flex flex-wrap items-center gap-3">');
    expect(
      ownerPage,
      "пилюлям зоны задали верхний отступ — стык снова зависит от двоих",
    ).not.toContain("mt-4 mb-4 flex flex-wrap");
  });
});

// ---------- Прямоугольники ----------

describe("192 — прямоугольники «Назвать цель» и «Показать все» не пересекаются", () => {
  it("лист зоны, цели ещё нет", () => {
    const rects = flow(sheetStack(false));
    const pills = get(rects, "Показать все");
    const button = get(rects, "Назвать цель");
    expectApart(...ordered(pills, button), "лист зоны денег");
    // Свечение соседа тоже не долетает: оно уходит на blur+spread в каждую
    // сторону, вниз ещё и на смещение 4.
    expect(
      intersects(withGlow(button, GLOW), pills),
      "свечение «Назвать цель» снова ложится на пилюли зоны",
    ).toBe(false);
    // …и порядок именно тот, которого требует тикет 139: кнопки зоны наверху.
    expect(pills.top, "действия зоны уехали под карточку копилки").toBeLessThan(button.top);
  });

  it("лист зоны, цель задана: «Изменить цель» и рядом «Убрать копилку»", () => {
    // Вторая кнопка стоит В ТОЙ ЖЕ строке карточки и высоты ей не добавляет —
    // стык вернуть ей нечем. Считаем и убеждаемся числом.
    const rects = flow(sheetStack(true));
    const pills = get(rects, "Показать все");
    const button = get(rects, "Изменить цель");
    expectApart(...ordered(pills, button), "лист зоны с целью");
    expect(
      intersects(withGlow(button, GLOW), pills),
      "свечение «Изменить цель» ложится на пилюли зоны",
    ).toBe(false);
  });

  it("экран зоны целиком: «Назвать цель» ниже «+ Добавить вещь»", () => {
    // Ссылка `inline-block`, её нижний отступ с верхним отступом карточки не
    // схлопывается вовсе — берём меньшее из двух возможных расстояний.
    expect(zonePage).toContain('className="pressable mb-6 inline-block text-xs font-semibold"');
    const rects = flow(screenStack());
    const link = get(rects, "+ Добавить вещь");
    const button = get(rects, "Назвать цель");
    expectApart(...ordered(link, button), "экран зоны целиком");
    expect(link.top, "карточка копилки снова выше действий зоны").toBeLessThan(button.top);
  });

  it("ТОТ САМЫЙ БАГ ловится: карточка первой и без нижнего отступа — наслоение", () => {
    // Реконструкция прежнего порядка. Если эта проверка позеленеет «сама» —
    // значит модель перестала видеть стык, и все остальные ничего не стоят.
    const before = cardBoxes(false).map((box) =>
      box.name === "Назвать цель" ? { ...box, marginBottom: 0 } : box,
    );
    const rects = flow([...before, { ...ZONE_ACTIONS, marginBottom: 0 }]);
    const button = get(rects, "Назвать цель");
    const pills = get(rects, "Показать все");
    expect(pills.top - button.bottom, "прежний стык был ровно нулевым").toBe(0);
    expect(
      intersects(withGlow(button, GLOW), pills),
      "свечение кнопки обязано накрывать пилюли — иначе модель не про этот баг",
    ).toBe(true);
  });
});

describe("192 — две кнопки карточки не наезжают друг на друга", () => {
  // Ширины слов в прогоне не измерить — шрифта нет. Поэтому берём ДВА заведомо
  // разных случая: обычные слова в одну строку и заведомо широкое первое слово,
  // от которого строка переносится. Оба обязаны разойтись: `gap: 16px` одним
  // числом задаёт и промежуток между кнопками, и промежуток между рядами.
  const probes: Array<[string, number, number]> = [
    ["в одну строку", 96, 118],
    ["с переносом", CONTENT - 20, 118],
  ];

  for (const [what, wide, narrow] of probes) {
    it(`«Изменить цель» и «Убрать копилку» ${what}`, () => {
      const rects = flexRow(
        [
          { name: "Изменить цель", width: wide, height: PRIMARY_H },
          { name: "Убрать копилку", width: narrow, height: QUIET_H },
        ],
        CONTENT,
        ACTIONS_GAP,
      );
      const change = get(rects, "Изменить цель");
      const clear = get(rects, "Убрать копилку");
      expect(intersects(change, clear), "кнопки карточки наложились друг на друга").toBe(false);
      const apart =
        clear.left >= change.right ? clear.left - change.right : clear.top - change.bottom;
      expect(apart, `между кнопками карточки ${apart} px`).toBeGreaterThanOrEqual(MIN_GAP);
    });
  }

  it("свечение «Изменить цель» не достаёт до соседки по строке", () => {
    // Вбок тень уходит на blur+spread = 15, а промежуток строки 16 — влезает.
    const reach = GLOW.blur + GLOW.spread;
    expect(
      ACTIONS_GAP,
      `промежуток строки ${ACTIONS_GAP} против вылета свечения ${reach}`,
    ).toBeGreaterThanOrEqual(reach);
  });
});

describe("192 — нижний отступ карточки вмещает её собственное свечение", () => {
  it("отступа хватает на вылет тени вниз", () => {
    const down = GLOW.blur + GLOW.spread + GLOW.y;
    expect(
      ACTIONS_MB,
      `нижний отступ строки действий ${ACTIONS_MB} против вылета свечения ${down}`,
    ).toBeGreaterThanOrEqual(down);
    // …и его хватает на зазор тикета даже соседу без своих отступов.
    expect(ACTIONS_MB).toBeGreaterThanOrEqual(MIN_GAP);
  });

  it("число взято со ступени системы, а не с потолка", () => {
    expect(spacing.scale, `${ACTIONS_MB} — не ступень шага системы`).toContain(ACTIONS_MB);
  });
});

// ---------- Границы тикета ----------

describe("192 — карточку копилки не переписывали", () => {
  it("слова кнопок прежние", () => {
    expect(card).toContain('{goal ? t("ownerChange") : t("ownerSet")}');
    expect(card).toContain('{t("ownerClear")}');
    expect(messages.Goal.ownerSet).toBe("Назвать цель");
    expect(messages.Goal.ownerChange).toBe("Изменить цель");
  });

  it("инварианты №1 и №9 на месте: у хозяйки ни прогресса, ни переводов", () => {
    const owner = card.slice(
      card.indexOf('if (state.viewer === "owner")'),
      card.indexOf("// ---------- Гость ----------"),
    );
    expect(owner.length, "ветка хозяйки пропала из карточки").toBeGreaterThan(0);
    expect(owner, "в ветку хозяйки приехал прогресс сбора").not.toMatch(
      /percent|pledged|participants/u,
    );
    expect(owner, "в ветке хозяйки появилась полоса прогресса").not.toContain("progressbar");
    expect(owner).toContain('t("ownerQuiet")');
    // Правка 192 — про отступы и порядок: у карточки не изменилось ни одного
    // правила, кроме нижнего отступа строки действий.
    expect(cardCss).toContain("margin-top: 18px;");
    expect(rule(cardCss, "primary")).toContain("box-shadow: 0 4px 18px -3px");
  });
});
