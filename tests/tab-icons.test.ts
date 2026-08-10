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
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement, type ReactElement } from "react";
import {
  IconPeople,
  IconPerson,
  IconPlus,
  IconRoom,
  IconSettings,
  IconTreasury,
} from "../src/components/icons";

const source = (file: string) =>
  readFileSync(fileURLToPath(new URL(file, import.meta.url)), "utf8");

/**
 * Знаки, которые страница ставит в ОДИН РЯД, — по её же разметке.
 *
 * `ADD_ICON_SIZE` в списке размеров не роскошь: кружок «Добавить» стоит в баре
 * пятым местом, а размер у него на единицу тише соседей. Без него сторож
 * считал бар четырёхместным и не заметил бы, встань рядом с плюсом его двойник.
 */
const usedIn = (code: string): string[] => [
  ...new Set(
    [
      ...code.matchAll(/<(Icon[A-Za-z]+) size=\{(?:CORNER_ICON_SIZE|ADD_ICON_SIZE|size)\}/gu),
    ].map((m) => m[1] as string),
  ),
];

const barRow = usedIn(source("../src/components/tab-bar/tab-slots.tsx"));
const cornerRow = usedIn(source("../src/app/room/page.tsx"));

/**
 * Файлы набора лежат В РЕПОЗИТОРИИ, а не в папке входящих пакетов: та живёт
 * на машине владельца, и тест, читающий оттуда, зелёный только у него —
 * в CI такой проверки просто нет.
 */
const PACKAGE_ICONS = path.join("design", "package", "handoff", "icons");

/**
 * Знаки ЗОН лежат отдельной папкой: она названа раундом первой поставки (15),
 * правки приезжают в неё же. Ряд «комната списком» состоит из них, поэтому
 * сторожу ряда нужны обе папки — набор один, а лежит в двух местах.
 */
const POOL_ICONS = path.join("design", "round15", "icons");

/** Геометрия знака: пути, круги и прямоугольники — без цвета и размеров. */
function shapeOf(svg: string): string[] {
  const paths = [...svg.matchAll(/d="([^"]+)"/g)].map((m) => `path:${m[1]}`);
  const circles = [...svg.matchAll(/<circle[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"[^>]*r="([\d.]+)"/g)].map(
    (m) => `circle:${m[1]},${m[2]},${m[3]}`,
  );
  // `rect` добавлен раундом 36 (тикет 150): прежде прямоугольников в наборе не
  // было вовсе, и сверка, которая их не видит, объявляла бы «путь в путь»
  // знаку с разошедшейся оболочкой.
  const rects = [
    ...svg.matchAll(
      /<rect[^>]*x="([\d.]+)"[^>]*y="([\d.]+)"[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"(?:[^>]*rx="([\d.]+)")?/g,
    ),
  ].map((m) => `rect:${m[1]},${m[2]},${m[3]},${m[4]},${m[5] ?? "0"}`);
  return [...paths, ...circles, ...rects].sort();
}

/** Путь к файлу набора по имени — знак может лежать в любой из двух папок. */
function setFile(name: string): string {
  for (const dir of [PACKAGE_ICONS, POOL_ICONS]) {
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`знака ${name} в наборе нет`);
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
    // Шестерня «Настроек» пришла файлом в раунде 36 (тикет 149) и перестала
    // быть нашим рисунком: обычная сверка, как у остальных четырёх.
    ["tab-settings", IconSettings],
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

/**
 * КОНТРАКТ РЯДОВ — `handoff/icons.json` (раунд 36, ответ на письмо 39).
 *
 * ЛЕЖИТ В РЕПОЗИТОРИИ, и это не удобство. Раунд 37 приехал в тот же день и
 * забрал папку раунда 36 с диска вместе с `icons.json`: сторож, читающий из
 * входящих пакетов, умер бы через три часа после того, как его написали.
 */
type IconsContract = {
  guardRule: { wrong: string; right: string; key: string; size: string };
  rows: Record<string, string[]>;
  collisions: Array<{ pair: string[]; rows: string[]; verdict: string; fix: string }>;
  cleared: Array<{ pair: string[]; why: string }>;
};

const contract = JSON.parse(
  readFileSync(path.join("design", "package", "handoff", "icons.json"), "utf8"),
) as IconsContract;

/**
 * СМЫСЛ знака — его имя без приставки МЕСТА. `tab-treasury`,
 * `action-treasury` и `ui-treasury` — три места одного смысла «витрина»;
 * `tab-friends` и `tab-profile` — два разных смысла, «друзья» и «профиль».
 * Приставка кодирует, где знак стоит, а не что он называет.
 */
const meaningOf = (file: string) =>
  file.replace(/\.svg$/u, "").replace(/^(?:tab|action|ui|pool)-/u, "");

/** Пары, которые дизайн проверил и РАЗРЕШИЛ с причиной (`cleared`). */
const clearedPairs = new Set<string>();
for (const { pair } of contract.cleared) {
  for (const a of pair) {
    for (const b of pair) {
      if (a !== b) clearedPairs.add([a, b].sort().join(" · "));
    }
  }
}

/**
 * САМ СТОРОЖ. Возвращает нарушения ряда — пустой список значит «ряд чист».
 *
 * ПРАВИЛО ДИЗАЙНА ДОСЛОВНО (`guardRule.right`): в одном ряду не бывает
 * одинакового силуэта у РАЗНЫХ смыслов; знаки одного смысла обязаны
 * совпадать. Прежняя наша формулировка — «в ряду не бывает двух одинаковых
 * силуэтов» — забраковала бы бриллиант рядом с бриллиантом, то есть
 * правильную рифму: витрина у человека одна, и в баре, в углу и в листе она
 * ОБЯЗАНА быть одним рисунком.
 *
 * ЧТО МАШИНА МОЖЕТ ДЕРЖАТЬ, А ЧЕГО НЕТ. Письмо 39 обещало у каждого знака
 * силуэт тремя полями (оболочка · что внутри · число элементов) — в
 * присланном `icons.json` этих полей НЕТ (проверено тестом ниже). Считать их
 * самим значило бы придумать контракт вместо дизайна: его же семь вердиктов
 * между собой не сходятся — «круг со стрелками» он приравнял к «кругу в
 * круге», а «прямоугольник с горами» к «прямоугольнику с крышкой» не
 * приравнял. Поэтому сторож держит НИЖНЮЮ ГРАНИЦУ силуэта — полное совпадение
 * геометрии. Она считается точно, и забраковать правильное не может: рифмы
 * одного смысла выведены из проверки по определению.
 */
function rowViolations(files: string[], shapeByFile: Map<string, string[]>): string[] {
  const bad: string[] = [];
  for (let i = 0; i < files.length; i += 1) {
    for (let j = i + 1; j < files.length; j += 1) {
      const [a, b] = [files[i] as string, files[j] as string];
      if (meaningOf(a) === meaningOf(b)) continue; // рифма одного смысла — законна
      if (clearedPairs.has([a, b].sort().join(" · "))) continue; // разрешено дизайном
      const shapeA = shapeByFile.get(a);
      const shapeB = shapeByFile.get(b);
      if (shapeA && shapeB && JSON.stringify(shapeA) === JSON.stringify(shapeB)) {
        bad.push(`${a} · ${b}`);
      }
    }
  }
  return bad;
}

describe("сторож ряда — ПО КОНТРАКТУ, а не по паре имён (тикет 151)", () => {
  // ЧТО ЗДЕСЬ БЫЛО ВЧЕРА. Одна проверка с двумя именами внутри: «IconPerson и
  // IconPeople в одном ряду не стоят» — пара, которую владелец увидел на
  // приёмке 10.08. Она держала ровно один случай из семи и не знала ни про
  // ряды, ни про смыслы. Дизайн разобрал набор рядами (письмо 39, работа 2) и
  // назвал ещё четыре пары, все в самом длинном ряду продукта — «комната
  // списком», тринадцать знаков зон столбцом.
  //
  // Теперь ряды, разрешённые пары и сама формулировка приезжают из
  // `icons.json`, а имён в коде сторожа нет ни одного.

  /** Все файлы набора обеих папок — с геометрией. */
  const shapeByFile = new Map<string, string[]>();
  for (const dir of [PACKAGE_ICONS, POOL_ICONS]) {
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".svg"))) {
      shapeByFile.set(name, shapeOf(readFileSync(path.join(dir, name), "utf8")));
    }
  }

  it("формулировка правила — та, под которую написан сторож", () => {
    // Дизайн поправит правило — тест скажет об этом здесь, а не молча
    // продолжит держать вчерашнее.
    expect(contract.guardRule.right).toContain("РАЗНЫМ смыслом");
    expect(contract.guardRule.right).toContain("знаки одного смысла обязаны совпадать");
    expect(contract.guardRule.wrong).toContain("забракует бриллиант");
  });

  it("у каждого знака каждого ряда есть файл в наборе", () => {
    // Знак, названный в ряду, но не лежащий в репозитории, — дыра в сторожe:
    // геометрии нет, сравнивать нечего, пара тихо пропускается.
    for (const [row, files] of Object.entries(contract.rows)) {
      for (const file of files) {
        expect(() => setFile(file), `${row}: ${file}`).not.toThrow();
      }
    }
    // САМЫЙ ДЛИННЫЙ РЯД ПРОДУКТА — не бар из пяти, а «комната списком»:
    // тринадцать знаков зон столбцом на 20 px, и обе его редакции (женская и
    // мужская) полной длины. Ровно там дизайн нашёл четыре пары из семи.
    for (const row of ["список зон Ж", "список зон М"]) {
      expect(contract.rows[row], `ряд «${row}» усох`).toHaveLength(13);
    }
  });

  it("ЗНАКИ ОДНОГО СМЫСЛА СОВПАДАЮТ — вторая половина правила", () => {
    // Сегодня такой смысл один — витрина, три места: бар, угол, лист действий.
    // Разойдись файлы — на одном экране окажутся два разных знака одной двери
    // (в комнате угол сцены и таб-бар видны ОДНОВРЕМЕННО). Проверка общая, а
    // не про витрину: заведётся второй смысл на два места — попадёт сюда сам.
    const byMeaning = new Map<string, string[]>();
    for (const file of shapeByFile.keys()) {
      const key = meaningOf(file);
      byMeaning.set(key, [...(byMeaning.get(key) ?? []), file]);
    }
    const shared = [...byMeaning.entries()].filter(([, files]) => files.length > 1);
    expect(shared.length, "смыслов на несколько мест не осталось — проверь `meaningOf`").toBeGreaterThan(0);
    for (const [meaning, files] of shared) {
      const first = shapeByFile.get(files[0] as string);
      for (const file of files.slice(1)) {
        expect(shapeByFile.get(file), `смысл «${meaning}»: ${file} разошёлся с ${files[0]}`).toEqual(
          first,
        );
      }
    }
  });

  it("НИ В ОДНОМ РЯДУ нет одинакового силуэта у разных смыслов", () => {
    for (const [row, files] of Object.entries(contract.rows)) {
      expect(rowViolations(files, shapeByFile), `ряд «${row}»`).toEqual([]);
    }
  });

  it("ряд, который рисует КОД, — тот же, что в контракте", () => {
    // ВОТ ЧТО ЗАМЕНИЛО ПАРУ ИМЁН. Вчерашняя проверка запрещала конкретное
    // соседство; эта требует совпадения состава с контрактом — и ловит ту же
    // ошибку строже. Верни «Настройкам» силуэт человека — в углу окажется
    // `tab-profile.svg`, которого в ряду контракта нет, и тест назовёт файл.
    //
    // Имена файлов не набиты руками: компонент опознаётся ПО ГЕОМЕТРИИ — тем
    // же способом, каким сверяется с набором.
    //
    // СРАВНИВАЕМ ПО СМЫСЛУ, А НЕ ПО ИМЕНИ ФАЙЛА, и это не послабление. У
    // витрины три файла одной геометрии (`tab-`, `action-`, `ui-`), и по
    // рисунку они неразличимы НАРОЧНО — то самое, что дизайн просил не
    // считать ошибкой. Опознание вернуло бы любой из трёх, и сверка имён
    // падала бы на порядке чтения папки. Смысл же у них один, и он верный.
    const meaningOfComponent = (name: string, element: ReactElement): string => {
      const shape = JSON.stringify(shapeOf(renderToStaticMarkup(element)));
      const hits = [...shapeByFile]
        .filter(([, fileShape]) => JSON.stringify(fileShape) === shape)
        .map(([file]) => meaningOf(file));
      if (hits.length === 0) throw new Error(`${name}: знака нет в наборе — его никто не сверял`);
      expect(new Set(hits).size, `${name}: один рисунок называет разные смыслы`).toBe(1);
      return hits[0] as string;
    };
    // «Комната» опознаётся без тёплой точки: точка — наше законное исключение
    // (tokens.json → icons.exception), файл её не знает.
    const catalogue: Record<string, ReactElement> = {
      IconRoom: createElement(IconRoom, { dot: false }),
      IconPeople: createElement(IconPeople),
      IconPlus: createElement(IconPlus),
      IconTreasury: createElement(IconTreasury),
      IconSettings: createElement(IconSettings),
      IconPerson: createElement(IconPerson),
    };
    for (const [where, contractRow, drawn] of [
      ["бар", "бар", barRow],
      ["угол", "угол", cornerRow],
    ] as const) {
      const drawnMeanings = drawn.map((name) => {
        const element = catalogue[name];
        if (!element) throw new Error(`${where}: незнакомый знак ${name} — добавь его в каталог`);
        return meaningOfComponent(name, element);
      });
      expect(drawnMeanings.sort(), `ряд «${where}» разошёлся с контрактом`).toEqual(
        (contract.rows[contractRow] as string[]).map(meaningOf).sort(),
      );
    }
  });

  it("в ряду нет одного знака дважды", () => {
    for (const [where, row] of [
      ["таб-бар", barRow],
      ["угол сцены", cornerRow],
    ] as const) {
      expect(new Set(row).size, `${where}: один знак стоит в ряду дважды`).toBe(row.length);
    }
  });

  it("СТОРОЖ ПРОВЕРЕН НА СЕБЕ: ловит запрещённое и пропускает правильное", () => {
    // Сторож, который ничего не ловит, зелёный по той же причине, что и
    // сторож, которому нечего ловить. Разница видна только на подложных
    // данных, поэтому они здесь и есть.
    const music = shapeByFile.get("pool-music.svg") as string[];

    // 1. ЗАПРЕЩЁННОЕ. Два РАЗНЫХ смысла с одной геометрией в одном ряду —
    //    ровно то, чем были пластинка и часы до раунда 36.
    const forged = new Map(shapeByFile);
    forged.set("pool-watches.svg", music);
    expect(rowViolations(["pool-music.svg", "pool-watches.svg"], forged)).toEqual([
      "pool-music.svg · pool-watches.svg",
    ]);

    // 2. ПРАВИЛЬНОЕ — БРИЛЛИАНТ РЯДОМ С БРИЛЛИАНТОМ. Тот самый случай, ради
    //    которого дизайн и просил переписать правило: три файла витрины
    //    совпадают НАРОЧНО, и сторож обязан молчать.
    expect(
      rowViolations(["tab-treasury.svg", "action-treasury.svg", "ui-treasury.svg"], shapeByFile),
      "сторож забраковал правильную рифму одного смысла",
    ).toEqual([]);

    // 3. РАЗРЕШЁННОЕ ДИЗАЙНОМ. Пара из `cleared` молчит, даже совпав целиком.
    const clearedForged = new Map(shapeByFile);
    clearedForged.set("pool-grooming.svg", clearedForged.get("pool-perfume.svg") as string[]);
    expect(
      rowViolations(["pool-perfume.svg", "pool-grooming.svg"], clearedForged),
      "список `cleared` перестал работать",
    ).toEqual([]);
  });

  it("силуэта ТРЕМЯ ПОЛЯМИ в контракте нет — письмо обещало, файл не привёз", () => {
    // ЗАПИСАНО ТЕСТОМ, А НЕ ОБИДОЙ. `guardRule.key` говорит «поля у каждого
    // знака ниже — сторожу их можно читать прямо отсюда»; ниже их нет.
    // Приедут — тест покраснеет, и сторож станет строже: полное совпадение
    // геометрии сменится совпадением силуэта, то есть начнёт ловить и
    // «похоже», а не только «то же самое».
    expect(contract.guardRule.key).toContain("Поля у каждого знака ниже");
    const raw = JSON.stringify(contract);
    for (const field of ['"shell"', '"inside"', '"means"']) {
      expect(raw, `поле ${field} приехало — пора сделать сторожа строже`).not.toContain(field);
    }
  });
});

describe("что сторож ряда держать не может — держим отдельно (тикеты 147, 149)", () => {
  // ЧЕСТНАЯ ГРАНИЦА. Сторож выше знает ряды и смыслы, но не знает, чем именно
  // рисуется место: он сверяет состав, а не назначение. Две проверки ниже —
  // про назначение, и машине его взять неоткуда, кроме как из кода.
  it("«Настройки» рисует шестерня, и она ИЗ НАБОРА (тикет 149)", () => {
    // ПЕРЕВЁРНУТО. Сутки здесь стояло обратное ожидание — файла шестерни в
    // наборе НЕТ, знак наш, держим правилом и спрашиваем письмом (так живёт
    // открытый глаз, тикет 51). Дизайн ответил раундом 36: прислал свою и
    // благословил нашу «если сходится по числам с допуском 0.3». Не сошлась —
    // вершина зуба 7.7 против 8.6, длина 1.8 против 2.8, — и правилу больше
    // нечего держать: знак сверяется с файлом наверху, вместе с остальным
    // каноном. Здесь остаётся то, чего сверка путей не видит: файл в наборе
    // ЕСТЬ, и оба места рисуют именно шестерню.
    expect(barRow).toContain("IconSettings");
    expect(cornerRow).toContain("IconSettings");
    expect(
      existsSync(path.join(PACKAGE_ICONS, "tab-settings.svg")),
      "файл шестерни пропал из набора — знаку снова нечем поверяться",
    ).toBe(true);
    // Формат набора: цвет у нас `currentColor`, у него в файле вшит #F2EDE4.
    const svg = renderToStaticMarkup(createElement(IconSettings));
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('stroke-width="1.7"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).not.toContain("#F2EDE4");
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
