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
 * КОНТРАКТ РЯДОВ — `handoff/icons.json` (раунд 40, ответ на письма 39 и 42).
 *
 * ЛЕЖИТ В РЕПОЗИТОРИИ, и это не удобство. Раунд 37 приехал в тот же день и
 * забрал папку раунда 36 с диска вместе с `icons.json`: сторож, читающий из
 * входящих пакетов, умер бы через три часа после того, как его написали.
 *
 * ЧТО ПРИВЕЗ РАУНД 40 (тикет 165). Блок `set` — 39 знаков, у каждого объект
 * `silhouette` из трёх полей. В раунде 36 его не было вовсе (потеря дизайна
 * при сборке файла), и сторож держал нижнюю границу — полное совпадение
 * геометрии. Теперь он держит сам силуэт, то есть ловит «похоже», а не только
 * «то же самое».
 *
 * ЧТО ПРИВЕЗ РАУНД 41 (тикет 169) — ОТВЕТ НА ПИСЬМО 44, и отвечено на всё.
 * Знаков стало 41: `ui-treasury` получил запись в `set` (был назван в
 * `cleared`, а силуэта не имел), приехал новый `ui-back`. Блок `rows` дизайн
 * пересобрал ИЗ ПОЛЕЙ знаков — расхождение в семи знаках исчезло само.
 * И главное: **`pool-home` перерисован лампой**, то есть правило поймало
 * восьмую пару, а дизайн её закрыл. Все подпорки, которыми мы этот день
 * держали, сняты в один заход — их и не должно оставаться дольше, чем причина.
 */
type Silhouette = { shell: string; inside: string; count: number };
type IconEntry = Silhouette & { means: string; rows: string[]; silhouette: Silhouette };
type IconsContract = {
  guardRule: { wrong: string; right: string; key: string; size: string };
  rows: Record<string, string[]>;
  collisions: Array<{ pair: string[]; rows: string[]; verdict: string; fix: string }>;
  cleared: Array<{ pair: string[]; why: string }>;
  set: Record<string, IconEntry>;
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

/** Силуэт знака одной строкой — то, что дизайн просит сравнивать. */
const silhouetteOf = (file: string, set: Record<string, IconEntry>): string | null => {
  const entry = set[file];
  if (!entry) return null;
  return `${entry.silhouette.shell} · ${entry.silhouette.inside} · ${entry.silhouette.count}`;
};

/**
 * РЯДЫ, ПО КОТОРЫМ ХОДИТ СТОРОЖ, — ОБЪЕДИНЕНИЕ ДВУХ СПИСКОВ КОНТРАКТА.
 *
 * Дизайн назвал ряды дважды: блоком `rows` («ряд → файлы») и полем `rows` у
 * каждого знака. Списки расходятся в семи знаках, и расхождение не в пользу
 * одной из сторон: блок не знает четырёх рядов вовсе («аватар», «лист
 * действий», «строка списка зоны», «профиль»), а поля знаков не знают, что
 * плюс стоит ещё и в баре гостя. Возьми мы одну сторону — вторая половина
 * пар не проверялась бы молча, а молчание тут и есть та болезнь, которую
 * лечит весь тикет. Берём объединение: пропуск любой из сторон закрыт другой.
 * Само расхождение выписано письмом 44 и пришпилено тестом ниже, чтобы
 * ответ дизайна не проехал мимо.
 */
const rowsToGuard = (): Map<string, string[]> => {
  const rows = new Map<string, Set<string>>();
  const add = (row: string, files: string[]) =>
    rows.set(row, new Set([...(rows.get(row) ?? []), ...files]));
  for (const [row, files] of Object.entries(contract.rows)) add(row, files);
  for (const [file, entry] of Object.entries(contract.set)) for (const row of entry.rows) add(row, [file]);
  return new Map([...rows].map(([row, files]) => [row, [...files]]));
};

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
 * ЧТО ОН ТЕПЕРЬ ДЕРЖИТ (тикет 165). Силуэт — тройка `{shell, inside, count}`
 * из блока `set`, а не геометрия. Разница не косметическая: геометрия ловила
 * только ДОСЛОВНОЕ совпадение узлов, то есть копию файла. Два РАЗНЫХ рисунка,
 * читающихся на 20 px одинаково — «прямоугольник с ручкой сверху» у сумки и у
 * чемодана, — она пропускала целиком, а глазами владельца ровно они и
 * ловились три раза за день. Тройка их видит.
 *
 * ЧЕГО ОН ПО-ПРЕЖНЕМУ НЕ УМЕЕТ. Тройка — СЛОВА ДИЗАЙНА, и слова эти он пишет
 * сам: назови он два одинаковых рисунка разными словами — сторож промолчит.
 * Одно поле из трёх привязано к файлу и врать не может — `count` (якорь ниже,
 * сошёлся у 39 из 39); `shell` и `inside` остаются прозой. Поэтому проверка
 * геометрии не убрана, а осталась рядом: она держит вторую половину правила
 * («знаки одного смысла обязаны совпадать») точно, без слов.
 */
function rowViolations(files: string[], set: Record<string, IconEntry>): string[] {
  const bad: string[] = [];
  for (let i = 0; i < files.length; i += 1) {
    for (let j = i + 1; j < files.length; j += 1) {
      const a = files[i] as string;
      const b = files[j] as string;
      const pair = [a, b].sort().join(" · ");
      if (meaningOf(a) === meaningOf(b)) continue; // рифма одного смысла — законна
      if (clearedPairs.has(pair)) continue; // разрешено дизайном
      const silhouetteA = silhouetteOf(a, set);
      const silhouetteB = silhouetteOf(b, set);
      if (silhouetteA !== null && silhouetteA === silhouetteB) bad.push(pair);
    }
  }
  return bad;
}

/**
 * ЗНАЕМ И ЖДЁМ ОТВЕТА — ПО СИЛУЭТАМ. Данные дизайна иногда нарушают его же
 * правило, и замазать это нельзя: правило верное, оно и ловит.
 *
 * Красить прогон в красный из-за ЧУЖОГО файла тоже нельзя — красный, который
 * чинится не нами, за сутки становится фоном, и следующее настоящее падение
 * никто не заметит. Поэтому пара живёт здесь: прогон зелёный, факт записан с
 * номером письма, а проверка ниже требует РАВЕНСТВА найденного и этого списка.
 * Список поэтому не растёт молча (новая пара — красный) и не залёживается
 * (дизайн починит — красный скажет вычеркнуть).
 *
 * СЕГОДНЯ СПИСОК ПУСТ, И ЭТО НЕ «НЕЧЕГО СТОРОЖИТЬ», А ЗАКРЫТЫЙ СЛУЧАЙ. Сутки
 * здесь стояла пара `pool-home` · `pool-flowers`: «Для дома» и «Цветы» имели
 * дословно один силуэт {без оболочки · силуэт предмета · 4} при разных смыслах
 * — восьмая коллизия набора, и нашли её не глаза, а само правило, через сутки
 * после того, как мы его написали. Дизайн ответил раундом 41: дом перерисован
 * НАСТОЛЬНОЙ ЛАМПОЙ (трапеция абажура, ножка, основание), у знака появилась
 * оболочка, и ряд «список зон Ж» развёлся. Пара внесена и в его `collisions`.
 *
 * Строчку убрал не человек, а красный: пока пара стояла здесь, проверка
 * равенства требовала её НАЙТИ — а сторож по новым данным её не находит. Ровно
 * так список и обязан было залёживаться: пустеет он тоже с красного.
 */
const PENDING: Array<{ row: string; pair: string; letter: number; what: string }> = [];

/**
 * ЗНАЕМ И ЖДЁМ ОТВЕТА — ПО СОСТАВУ РЯДА. Тот же приём, другая болезнь.
 *
 * `PENDING` выше про СИЛУЭТЫ: два знака в одном ряду читаются одинаково. Здесь
 * про СОСТАВ: контракт называет в ряду знак, которого экран не рисует и рисовать
 * не может. Смешивать их в один список нельзя — у них разные проверки и разные
 * последствия, и общий список молча прикрывал бы одно другим.
 *
 * ЧТО СЛУЧИЛОСЬ. Раунд 41 пересобрал блок `rows` из полей знаков, и ряд «угол
 * сцены» вырос с трёх имён до четырёх: к витрине, друзьям и шестерне добавился
 * `tab-room.svg`. **В УГЛУ КОМНАТЫ ЗНАКА КОМНАТЫ БЫТЬ НЕ МОЖЕТ** — человек в
 * ней уже стоит, и дверь, ведущая туда, где ты есть, это не дверь. Экран
 * (`src/app/room/page.tsx`) рисует три знака: люди, шестерня, бриллиант.
 *
 * ЧИНИТЬ НЕ НАШЕ ДЕЛО. Поставить четвёртый знак значило бы выполнить чужой файл
 * против смысла экрана; вычеркнуть строку из контракта — сочинить контракт за
 * дизайн. Правило то же, что у мелочей письма 44: **чужие данные не чиним и не
 * сочиняем, фиксируем числом, чтобы изменение позвало.** Выписано письмом 45.
 *
 * ПРОВЕРКА НА РАВЕНСТВО, как и у `PENDING`: список не растёт молча (назовёт
 * дизайн в ряду ещё один знак — красный) и не залёживается (уберёт `tab-room`
 * из ряда — тоже красный, «вычеркни»). Обратная сторона строже некуда: знак,
 * который рисует КОД и которого нет в контракте, не записывается сюда никогда —
 * это уже наша самодеятельность, и она красная сразу.
 */
const ROW_PENDING: Array<{ row: string; meaning: string; letter: number; what: string }> = [
  {
    row: "угол",
    meaning: "room",
    letter: 45,
    what: "контракт зовёт в угол сцены `tab-room.svg`, но угол СТОИТ В КОМНАТЕ: знак увёл бы туда, где человек уже находится. Экран рисует три — люди, шестерня, бриллиант",
  },
];

describe("сторож ряда — ПО СИЛУЭТУ, а не по геометрии (тикеты 151, 165)", () => {
  // ЧТО ЗДЕСЬ БЫЛО ВЧЕРА. Одна проверка с двумя именами внутри: «IconPerson и
  // IconPeople в одном ряду не стоят» — пара, которую владелец увидел на
  // приёмке 10.08. Она держала ровно один случай из семи и не знала ни про
  // ряды, ни про смыслы. Дизайн разобрал набор рядами (письмо 39, работа 2) и
  // назвал ещё четыре пары, все в самом длинном ряду продукта — «комната
  // списком», тринадцать знаков зон столбцом. Тикет 151 заменил пару имён
  // контрактом; тикет 165 — геометрию настоящим силуэтом.
  //
  // Ряды, разрешённые пары, силуэты и сама формулировка приезжают из
  // `icons.json`, а имён знаков в коде сторожа нет ни одного.

  /** Все файлы набора обеих папок — с геометрией. */
  const shapeByFile = new Map<string, string[]>();
  for (const dir of [PACKAGE_ICONS, POOL_ICONS]) {
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".svg"))) {
      shapeByFile.set(name, shapeOf(readFileSync(path.join(dir, name), "utf8")));
    }
  }

  const guardedRows = rowsToGuard();

  it("формулировка правила — та, под которую написан сторож", () => {
    // Дизайн поправит правило — тест скажет об этом здесь, а не молча
    // продолжит держать вчерашнее.
    expect(contract.guardRule.right).toContain("РАЗНЫМ смыслом");
    expect(contract.guardRule.right).toContain("знаки одного смысла обязаны совпадать");
    expect(contract.guardRule.wrong).toContain("забракует бриллиант");
    // И источник силуэта — тот, из которого сторож его читает.
    expect(contract.guardRule.key).toContain("объект silhouette у каждого знака");
  });

  it("у каждого знака каждого ряда есть И ФАЙЛ, И СИЛУЭТ", () => {
    // Две дыры одной формы. Знак, названный в ряду, но не лежащий в
    // репозитории, — геометрии нет. Знак без записи в `set` — силуэта нет.
    // В обоих случаях пара тихо пропускается, а тихо тут нельзя.
    for (const [row, files] of guardedRows) {
      for (const file of files) {
        expect(() => setFile(file), `${row}: ${file}`).not.toThrow();
        expect(silhouetteOf(file, contract.set), `${row}: у ${file} нет силуэта в \`set\``).not.toBeNull();
      }
    }
    // САМЫЙ ДЛИННЫЙ РЯД ПРОДУКТА — не бар из пяти, а «комната списком»:
    // тринадцать знаков зон столбцом на 20 px, и обе его редакции (женская и
    // мужская) полной длины. Ровно там дизайн нашёл четыре пары из семи.
    for (const row of ["список зон Ж", "список зон М"]) {
      expect(contract.rows[row], `ряд «${row}» усох`).toHaveLength(13);
    }
  });

  it("ЯКОРЬ: `silhouette.count` каждого знака = число узлов его SVG", () => {
    // ЗАЧЕМ ЯКОРЬ. Силуэт — слова дизайна, и два поля из трёх («оболочка», «что
    // внутри») проверить нечем: они проза. Без привязки к файлу вся тройка
    // однажды отстанет от рисунка — знак перерисуют, а строчку в json забудут,
    // и сторож будет сторожить вчерашний набор, оставаясь зелёным.
    //
    // Третье поле привязать можно, и дизайн сам, не обещав, дал его сходящимся:
    // `count` совпал с числом узлов в его же SVG у 39 из 39 (раунд 40) и у
    // 41 из 41 (раунд 41 — два новых знака приехали такими же сходящимися,
    // и перерисованный лампой `pool-home` тоже). Берём его якорем — теперь
    // расхождение файла со словами краснеет само.
    const off: string[] = [];
    for (const [file, entry] of Object.entries(contract.set)) {
      const nodes = shapeByFile.get(file)?.length;
      if (nodes !== entry.silhouette.count) off.push(`${file}: count=${entry.silhouette.count}, узлов=${nodes}`);
    }
    expect(off, "силуэт отстал от рисунка").toEqual([]);
    expect(Object.keys(contract.set), "знаков в `set` стало не 41 — проверь якорь заново").toHaveLength(41);
    // И СТОЛЬКО ЖЕ ФАЙЛОВ В ДВУХ ПАПКАХ НАБОРА. Якорь сверяет `set` с файлами,
    // но только по тем именам, что в `set` есть: положи дизайн знак, забыв
    // строчку, — якорь промолчит. Здесь равенство числами закрывает и это.
    expect(shapeByFile.size, "файлов набора и записей в `set` стало не поровну").toBe(41);
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
        // И силуэтом тоже — той же тройкой, которой сторож меряет чужие пары.
        // Геометрия и слова обязаны говорить одно, иначе одно из двух врёт.
        const silhouette = silhouetteOf(file, contract.set);
        if (silhouette !== null) {
          expect(silhouette, `смысл «${meaning}»: у ${file} силуэт назван иначе, чем у ${files[0]}`).toBe(
            silhouetteOf(files[0] as string, contract.set),
          );
        }
      }
    }
    // СМЫСЛ ПО ИМЕНИ ФАЙЛА И `means` ДИЗАЙНА — не одно и то же, и сторож
    // берёт первое. `means` — проза: витрину он зовёт «Сокровищница» в баре,
    // «В сокровищницу» в листе и «Сокровищница (в тексте и в полосе)» в углу,
    // то есть по его словам это ТРИ РАЗНЫХ смысла с одним рисунком — пары,
    // которые сторож обязан пропустить и пропускает только благодаря имени
    // файла. Расхождений стало три, а не одно, и выросли они законно: раунд 41
    // завёл `ui-treasury` запись в `set`, и третий бриллиант просто добрал
    // пары к двум прежним. Станет больше по другой причине — сторож начнёт
    // мерить не то, и узнаем мы об этом здесь.
    const names = Object.keys(contract.set);
    const stemVsMeans = names.flatMap((a, i) =>
      names.slice(i + 1).filter((b) => {
        const sameStem = meaningOf(a) === meaningOf(b);
        const sameMeans = (contract.set[a] as IconEntry).means === (contract.set[b] as IconEntry).means;
        return sameStem !== sameMeans;
      }).map((b) => [a, b].sort().join(" · ")),
    );
    expect(stemVsMeans.sort(), "имя файла и `means` разошлись не там, где вчера").toEqual([
      "action-treasury.svg · tab-treasury.svg",
      "action-treasury.svg · ui-treasury.svg",
      "tab-treasury.svg · ui-treasury.svg",
    ]);
  });

  it("НИ В ОДНОМ РЯДУ нет одинакового силуэта у разных смыслов — кроме выписанных письмом", () => {
    // РАВЕНСТВО, А НЕ ПУСТОТА. Найденное сверяется со списком «знаем и ждём
    // ответа» ЦЕЛИКОМ: новая пара — красный (список не растёт молча), пара
    // починена дизайном — тоже красный (список не залёживается).
    const found = [...guardedRows].flatMap(([row, files]) =>
      rowViolations(files, contract.set).map((pair) => `${row}: ${pair}`),
    );
    expect(found.sort(), "сошлись силуэты у разных смыслов").toEqual(
      PENDING.map((p) => `${p.row}: ${p.pair}`).sort(),
    );
  });

  it("список «знаем и ждём ответа» короток, назван письмом и не притворяется", () => {
    // Сам список — тоже сторож, и сторожить его надо. Три требования.
    expect(PENDING.length, "ждущих пар стало много — это уже не ожидание, а свой набор").toBeLessThanOrEqual(3);
    for (const item of PENDING) {
      // 1. У каждой пары есть номер письма и своими словами сказано, что не
      //    так: молча ждать нельзя, ждут ОТВЕТА, и через месяц никто не
      //    вспомнит, чего именно.
      expect(item.letter, `${item.pair}: пара без номера письма — её никто не спрашивал`).toBeGreaterThanOrEqual(44);
      expect(item.what.length, `${item.pair}: пара без объяснения`).toBeGreaterThan(40);
      // 2. Пара действительно нарушает правило — иначе строчка тут лишняя и
      //    прикрывает собой пустое место (а завтра прикроет непустое).
      const [a, b] = item.pair.split(" · ") as [string, string];
      expect(silhouetteOf(a, contract.set), `${item.pair}: силуэты РАЗНЫЕ — вычеркни пару`).toBe(
        silhouetteOf(b, contract.set),
      );
      expect(meaningOf(a), `${item.pair}: смысл один — это законная рифма, а не коллизия`).not.toBe(meaningOf(b));
      // 3. Пары нет в `cleared`: разрешённое дизайном ждать нечего.
      expect(clearedPairs.has(item.pair), `${item.pair}: дизайн её уже разрешил — вычеркни`).toBe(false);
      // 4. И ровно этого он в своих `collisions` не назвал — иначе правка едет.
      const named = contract.collisions.some(
        (c) => [...c.pair].sort().join(" · ") === item.pair,
      );
      expect(named, `${item.pair}: дизайн внёс пару в \`collisions\` — правка в пути, вычеркни`).toBe(false);
    }
  });

  it("список «ждём ответа по составу ряда» — те же три требования (письмо 45)", () => {
    // Сторожить надо и этот список, теми же мерками, что и `PENDING`.
    expect(ROW_PENDING.length, "ждущих рядов стало много — это уже свой контракт").toBeLessThanOrEqual(3);
    for (const item of ROW_PENDING) {
      // 1. Номер письма и объяснение своими словами: ждут ОТВЕТА, и через
      //    месяц никто не вспомнит, чего именно.
      expect(item.letter, `${item.row}/${item.meaning}: строка без номера письма`).toBeGreaterThanOrEqual(45);
      expect(item.what.length, `${item.row}/${item.meaning}: строка без объяснения`).toBeGreaterThan(40);
      // 2. Знак ДЕЙСТВИТЕЛЬНО назван контрактом в этом ряду — иначе строчка
      //    прикрывает пустое место (а завтра прикроет непустое).
      const row = contract.rows[item.row];
      expect(row, `${item.row}: такого ряда в контракте нет`).toBeDefined();
      expect(
        (row as string[]).map(meaningOf),
        `${item.row}: знака «${item.meaning}» контракт в этом ряду не называет — вычеркни`,
      ).toContain(item.meaning);
      // 3. И у знака есть файл: ждать ответа про имя, за которым ничего не
      //    лежит, — это ждать про опечатку, а не про рисунок.
      const files = [...shapeByFile.keys()].filter((f) => meaningOf(f) === item.meaning);
      expect(files.length, `${item.row}: знака «${item.meaning}» нет в наборе файлом`).toBeGreaterThan(0);
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
    // СРАВНЕНИЕ РАЗОБРАНО НА ДВЕ СТОРОНЫ, и они не равноправны (тикет 169).
    // Знак, который рисует КОД мимо контракта, — наша самодеятельность, и она
    // красная всегда. Знак, который называет КОНТРАКТ, а код не рисует, бывает
    // и нашей забывчивостью, и чужой ошибкой; чужие — выписаны в `ROW_PENDING`
    // с номером письма, и сверяются на РАВЕНСТВО.
    for (const [where, contractRow, drawn] of [
      ["бар", "бар", barRow],
      ["угол", "угол", cornerRow],
    ] as const) {
      const drawnMeanings = drawn.map((name) => {
        const element = catalogue[name];
        if (!element) throw new Error(`${where}: незнакомый знак ${name} — добавь его в каталог`);
        return meaningOfComponent(name, element);
      });
      const wanted = (contract.rows[contractRow] as string[]).map(meaningOf);
      const extra = drawnMeanings.filter((m) => !wanted.includes(m)).sort();
      const missing = wanted.filter((m) => !drawnMeanings.includes(m)).sort();
      expect(extra, `ряд «${where}»: код рисует знак, которого в контракте нет`).toEqual([]);
      expect(missing, `ряд «${where}» разошёлся с контрактом`).toEqual(
        ROW_PENDING.filter((item) => item.row === contractRow)
          .map((item) => item.meaning)
          .sort(),
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
    const forge = (file: string, like: string): Record<string, IconEntry> => ({
      ...contract.set,
      [file]: { ...(contract.set[file] as IconEntry), silhouette: (contract.set[like] as IconEntry).silhouette },
    });

    // 1. ЗАПРЕЩЁННОЕ. Два РАЗНЫХ смысла с одним силуэтом в одном ряду — ровно
    //    то, чем были пластинка и часы до раунда 36.
    expect(
      rowViolations(["pool-music.svg", "pool-watches.svg"], forge("pool-watches.svg", "pool-music.svg")),
    ).toEqual(["pool-music.svg · pool-watches.svg"]);

    // 1а. И «ПОХОЖЕЕ», А НЕ ТОЛЬКО «ТО ЖЕ САМОЕ» — вот что дала замена
    //     геометрии силуэтом. Рисунки разные (геометрия бы промолчала), а
    //     читаются на 20 px одинаково: сумка и чемодан до раунда 36.
    const bags = shapeByFile.get("pool-bags.svg") as string[];
    const travel = shapeByFile.get("pool-travel.svg") as string[];
    expect(bags, "сумка и чемодан стали копией — подложка потеряла смысл").not.toEqual(travel);
    expect(
      rowViolations(["pool-bags.svg", "pool-travel.svg"], forge("pool-bags.svg", "pool-travel.svg")),
      "сторож видит только дословную копию — силуэт до него не доехал",
    ).toEqual(["pool-bags.svg · pool-travel.svg"]);

    // 2. ПРАВИЛЬНОЕ — БРИЛЛИАНТ РЯДОМ С БРИЛЛИАНТОМ. Тот самый случай, ради
    //    которого дизайн и просил переписать правило: знаки витрины совпадают
    //    НАРОЧНО, и сторож обязан молчать.
    expect(
      rowViolations(["tab-treasury.svg", "action-treasury.svg"], contract.set),
      "сторож забраковал правильную рифму одного смысла",
    ).toEqual([]);

    // 3. РАЗРЕШЁННОЕ ДИЗАЙНОМ. Пара из `cleared` молчит, даже совпав целиком.
    expect(
      rowViolations(
        ["pool-perfume.svg", "pool-grooming.svg"],
        forge("pool-grooming.svg", "pool-perfume.svg"),
      ),
      "список `cleared` перестал работать",
    ).toEqual([]);
  });

  it("СИЛУЭТ ТРЕМЯ ПОЛЯМИ ПРИЕХАЛ — и сходится сам с собой", () => {
    // ПЕРЕВЁРНУТО (тикет 165). Сутки здесь стояло обратное: полей силуэта в
    // файле НЕТ, письмо обещало — файл не привёз, и сторож держал нижнюю
    // границу (полное совпадение геометрии). Раунд 40 привёз блок `set`:
    // дизайн назвал причину — блок не попал в файл при сборке пакета целиком.
    //
    // Теперь проверяем не отсутствие, а сходимость: у каждого знака есть все
    // три поля, и плоские псевдонимы (`shell`/`inside`/`count` рядом с
    // объектом — по правилу дизайна `keyMoves`) не разошлись с объектом. Два
    // источника одного числа расходятся всегда; вопрос только когда.
    const entries = Object.entries(contract.set);
    expect(entries.length).toBe(41);
    const broken: string[] = [];
    for (const [file, entry] of entries) {
      const { shell, inside, count } = entry.silhouette;
      if (typeof shell !== "string" || shell === "") broken.push(`${file}: пустой shell`);
      if (typeof inside !== "string" || inside === "") broken.push(`${file}: пустой inside`);
      if (typeof count !== "number") broken.push(`${file}: count не число`);
      if (entry.shell !== shell || entry.inside !== inside || entry.count !== count) {
        broken.push(`${file}: плоский псевдоним разошёлся с объектом silhouette`);
      }
      if (typeof entry.means !== "string" || entry.means === "") broken.push(`${file}: знак без смысла`);
    }
    expect(broken).toEqual([]);
  });

  it("ДВЕ МЕЛОЧИ ПИСЬМА 44 ЗАКРЫТЫ — и проверки остались сторожить пустоту", () => {
    // ПЕРЕВЁРНУТО (тикет 169). Сутки здесь стояли две записанные кривизны
    // раунда 40 — обе безвредные тогда и обе дыры завтра. Раунд 41 закрыл обе,
    // и проверки не удалены, а перевёрнуты: они теперь требуют ПУСТОТЫ.
    // Удалить их значило бы снять сторожа с места, где болезнь уже случалась
    // однажды, — а такие места и болеют повторно.

    // 1. БЫЛО: `ui-treasury.svg` назван в `cleared`, а записи в `set` нет —
    //    силуэт есть у 39 файлов из 40. Своего мы ему не писали: сочинять
    //    контракт за дизайн — ровно то, чего тикет 165 и избегал.
    //    СТАЛО: дизайн добавил запись сам («был назван в cleared, но в set не
    //    попал — добавлен»), и знаков без силуэта не осталось ни одного.
    const withoutSilhouette = [...shapeByFile.keys()].filter((f) => !contract.set[f]);
    expect(withoutSilhouette, "знак набора снова без силуэта — контракт отстал от набора").toEqual(
      [],
    );

    // 2. БЫЛО: блок `rows` и поля `rows` у знаков расходились в семи знаках.
    //    Сторож ходит по ОБЪЕДИНЕНИЮ (см. `rowsToGuard`), поэтому расхождение
    //    ничего не прятало, — но два списка одного факта расходятся всегда,
    //    вопрос только когда.
    //    СТАЛО: дизайн пересобрал блок ИЗ ПОЛЕЙ знаков, и двух источников
    //    больше нет — есть один, разложенный двумя способами. Объединение в
    //    `rowsToGuard` при этом оставлено: оно и раньше было не костылём под
    //    расхождение, а способом не зависеть от того, какой из списков полнее.
    const fromBlock = new Map<string, string[]>();
    for (const [row, files] of Object.entries(contract.rows)) {
      for (const file of files) fromBlock.set(file, [...(fromBlock.get(file) ?? []), row]);
    }
    const disagree = Object.keys(contract.set).filter(
      (file) =>
        JSON.stringify((contract.set[file] as IconEntry).rows.slice().sort()) !==
        JSON.stringify((fromBlock.get(file) ?? []).sort()),
    );
    expect(disagree.sort(), "блок `rows` снова разошёлся с полями знаков").toEqual([]);
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
