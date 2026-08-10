// Строка списка зоны — 52 px по контракту (тикет 152, закрывает 144).
//
// ЗАЧЕМ ТЕСТ. Форму строки ломает не переписывание файла, а одно число,
// поправленное «на глаз»: миниатюра «чуть крупнее», промежуток «чуть
// воздушнее», знак «как у соседнего экрана». Каждое такое движение забирает
// пиксели у ИМЕНИ — единственного, ради чего список зоны существует. Ровно
// так экран и приехал к дефекту 144: он взял строку у «комнаты списком»
// (миниатюра 72) и добавил к ней два знака действий по 44 — имени осталось
// 71 px на 375 и 56 на 360, и слово легло на цену.
//
// Поэтому числа сверяются с ПАКЕТОМ, а не с самими собой: файл контракта
// читается здесь же (`@design/zone-row.json`), и разойдись с ним код — тест
// назовёт число.
//
// ЗАМЕР В БРАУЗЕРЕ (10.08, стенд, Onest живой, образец цены «140 000 ₽»
// из самого контракта):
//   375 → имя 173.2 (контракт 171) · 360 → 158.0 (156) · 320 → 118.0 (116);
//   с огоньком «мечтаю» — ровно на 13 меньше на всех трёх ширинах;
//   строка 52.0 в высоту, коробка «⋯» 32×44, цель нажатия 44×44 и заходит
//   на 6 px в правый отступ листа; имя в 62 знака без пробелов и дефисов
//   страницу вбок не тянет (scrollWidth 320 при innerWidth 320).
// Расхождение +2 постоянно на всех ширинах и живёт целиком в ЦЕНЕ: образец
// «140 000 ₽» у нас 66.0 px, у контракта подразумевается 68.2. Геометрия
// строки сходится с таблицей до пикселя — см. проверку «таблица ширин».
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import contractJson from "@design/zone-row.json";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const css = read("../src/components/zone-row/zone-row.module.css");
const row = read("../src/components/zone-row/zone-row.tsx");
const screen = read("../src/app/room/zone/[zone]/owner-zone-grid.tsx");
const page = read("../src/app/room/zone/[zone]/page.tsx");
const actionsCss = read("../src/components/item/item-actions.module.css");
const shared = read("../src/components/room-list/room-list.module.css");

const contract = contractJson as unknown as {
  form: {
    height: number;
    padding: string;
    divider: string;
    thumb: { size: number; radius: number; fit: string; empty: string };
    gaps: string[];
    name: { font: string; color: string; lines: number; overflow: string };
    price: { font: string; nowrap: boolean; tabularNums: boolean; color: string };
    wishDot: { size: number; when: string };
    trailing: { glyph: number; hit: string; icon: string };
  };
  widths: Record<string, { available: number; name: number } | string>;
  states: Record<string, string>;
  counters: string;
};

const form = contract.form;

/** Все числа строки промежутков: «миниатюра → 12 → [огонёк 5 → 8] → …». */
const gaps = (form.gaps[0] ?? "").match(/\d+/gu)?.map(Number) ?? [];

function nth(index: number): number {
  const value = gaps[index];
  if (value === undefined) throw new Error(`в промежутках пакета нет числа №${index + 1}`);
  return value;
}

const GAP_THUMB = nth(0);
const DOT = nth(1);
const GAP_DOT = nth(2);
const GAP_NAME = nth(3);
const GAP_PRICE = nth(4);

/** «600 13.5/1.2 Onest» → правило CSS этого проекта. */
function cssFont(spec: string): string {
  const parsed = /^(\d+) ([\d.]+)\/([\d.]+) Onest$/u.exec(spec);
  expect(parsed, `непонятная запись шрифта: ${spec}`).toBeTruthy();
  const [, weight, size, height] = parsed as RegExpExecArray;
  return `font: ${weight} ${size}px/${height} var(--font-ui);`;
}

/** Тело правила по имени класса. */
function rule(source: string, selector: string): string {
  const found = new RegExp(`\\.${selector} \\{([^}]*)\\}`, "u").exec(source);
  expect(found, `правило .${selector} пропало`).toBeTruthy();
  return (found as RegExpExecArray)[1] as string;
}

/** Цвета пакета и CSS пишутся по-разному: «,.72» против «, 0.72». */
const norm = (value: string) => value.replace(/\s/gu, "").replace(/0\.(\d)/gu, ".$1").toLowerCase();

describe("контракт прочитан целиком — иначе проверять нечего", () => {
  it("в файле пакета есть все числа, которыми меряется строка", () => {
    expect(form.height).toBe(52);
    expect(form.thumb.size).toBe(36);
    expect(form.thumb.radius).toBe(0);
    expect(form.wishDot.size).toBe(5);
    expect(form.trailing.glyph).toBe(20);
    expect(gaps, "строка промежутков пакета читается пятью числами").toEqual([12, 5, 8, 10, 6]);
  });
});

describe("высота, поля и разделитель", () => {
  it("строка ровно 52 и не зависит от содержимого", () => {
    expect(rule(css, "row")).toContain(`height: ${form.height}px;`);
    // Вторая строка имени запрещена контрактом: переменная внутренность
    // ломает ритм 52 и мешает считать список глазами.
    expect(rule(css, "name")).toContain("white-space: nowrap;");
    expect(rule(css, "name")).toContain("text-overflow: ellipsis;");
    expect(rule(css, "name")).toContain("overflow: hidden;");
  });

  it("вопрос-подтверждение стоит ПОД строкой, а не внутри её 52", () => {
    // Иначе высота поехала бы ровно там, где человек нажал «Удалить».
    expect(css).toMatch(/\.under \{/u);
    expect(row).toContain("className={s.under}");
    // Узел стоит СНАРУЖИ `.row` — иначе он растянул бы фиксированную высоту.
    expect(row.indexOf("className={s.under}")).toBeGreaterThan(row.indexOf("</div>"));
  });

  it("поля листа 20 — их даёт страница зоны, своих строка не заводит", () => {
    expect(form.padding).toContain("20");
    // px-5 Tailwind = 20 px; на десктопе поля снимает контейнер.
    expect(page).toContain('className="mx-auto w-full max-w-3xl px-5 lg:px-0"');
    expect(css, "у списка появились свои поля — они удвоятся с полями страницы").not.toMatch(
      /\.rows \{[^}]*padding: [1-9]/u,
    );
  });

  it("разделитель 1px .06 между строками, у последней его нет", () => {
    expect(norm(form.divider)).toContain("1pxrgba(255,255,255,.06)");
    expect(norm(rule(css, "item"))).toContain("border-bottom:1pxsolidrgba(255,255,255,.06);");
    expect(css).toMatch(/\.item:last-child \{\s*border-bottom: none;/u);
  });
});

describe("миниатюра 36 и пустая плитка", () => {
  it("36×36, без скругления, cover", () => {
    const thumb = rule(css, "thumb");
    expect(thumb).toContain(`width: ${form.thumb.size}px;`);
    expect(thumb).toContain(`height: ${form.thumb.size}px;`);
    expect(thumb).toContain(`border-radius: ${form.thumb.radius};`);
    expect(form.thumb.fit).toBe("cover");
    expect(thumb).toContain("background-size: cover;");
  });

  it("пустая — плитка .05 со знаком зоны 18 при .35", () => {
    const empty = form.thumb.empty.replace(/\s/gu, "");
    expect(empty).toContain("rgba(255,255,255,.05)");
    expect(empty).toContain("18");
    expect(empty).toContain(".35");
    expect(rule(css, "thumb")).toContain("background-color: rgba(255, 255, 255, 0.05);");
    expect(rule(css, "mark")).toContain("opacity: 0.35;");
    expect(row, "знак зоны перестал быть 18 px").toContain("const MARK_SIZE = 18;");
  });
});

describe("промежутки — те самые пять чисел", () => {
  it("миниатюра → 12", () => {
    expect(rule(css, "thumb")).toContain(`margin-right: ${GAP_THUMB}px;`);
  });

  it("огонёк 5 → 8 → имя", () => {
    const dot = rule(css, "dot");
    expect(dot).toContain(`width: ${DOT}px;`);
    expect(dot).toContain(`height: ${DOT}px;`);
    expect(dot).toContain(`margin-right: ${GAP_DOT}px;`);
  });

  it("имя → 10 → цена → 6 → ⋯", () => {
    expect(rule(css, "meta")).toContain(`margin-left: ${GAP_NAME}px;`);
    expect(rule(css, "more")).toContain(`margin-left: ${GAP_PRICE}px;`);
  });
});

describe("огонёк — один и только у «мечтаю»", () => {
  it("верхняя ступень и ничего ниже", () => {
    expect(form.wishDot.when).toContain("только степень 4");
    // Число ступени берётся у шкалы, а не пишется здесь заново.
    expect(row).toContain('import { DESIRE_DREAM } from "@/components/item/desire-scale";');
    expect(row).toMatch(/desire === DESIRE_DREAM && \(/u);
    expect(row, "в строке снова появилась вся лестница огоньков").not.toContain("DesireScale");
  });

  it("свечение 0 0 7px акцентом", () => {
    expect(form.wishDot.when).toContain("0 0 7px");
    expect(rule(css, "dot")).toContain("box-shadow: 0 0 7px var(--zr-accent");
  });
});

describe("имя и цена — шрифтами пакета", () => {
  it("имя 600 13.5/1.2 и цвет #F2EDE4", () => {
    expect(rule(css, "name")).toContain(cssFont(form.name.font));
    expect(rule(css, "name")).toContain(`color: ${form.name.color.toLowerCase()};`);
    expect(form.name.lines).toBe(1);
  });

  it("цена 500 12.5/1, tabular-nums, без переноса", () => {
    const price = rule(css, "price");
    expect(price).toContain(cssFont(form.price.font));
    expect(norm(price)).toContain(norm(`color: ${form.price.color};`));
    expect(form.price.nowrap).toBe(true);
    expect(price).toContain("white-space: nowrap;");
    expect(form.price.tabularNums).toBe(true);
    expect(price).toContain("font-variant-numeric: tabular-nums;");
  });
});

describe("знак в конце — ОДИН, 20 на цели 44", () => {
  it("главного знака в строке зоны нет: дорога в вещь — сама строка", () => {
    // Карандаш отсюда ушёл вместе с 44 px, которые он занимал. Точка входа
    // теперь настоящая: строка — ссылка.
    expect(screen, "в строке зоны снова два знака").not.toContain("primary={{");
    expect(screen).toMatch(/href=\{[\s\S]{0,120}`\/room\/zone\/\$\{zoneKey\}\/i\/\$\{item\.id\}`/u);
    expect(row).toContain("<Link href={href}");
  });

  it("глиф 20 — число контракта, а не общий 19", () => {
    expect(row).toContain(`export const ZONE_ROW_GLYPH = ${form.trailing.glyph};`);
    expect(screen).toContain("glyph={ZONE_ROW_GLYPH}");
  });

  it("коробка 32 при цели 44 — цель заходит в правый отступ листа", () => {
    // 32 выведены из самого контракта: «у гостя знака ⋯ нет вовсе, поэтому
    // имени +38» — это промежуток 6 плюс коробка. Цель добирают по 6 с двух
    // сторон, и правые 6 ложатся в 20 px отступа листа.
    expect(form.trailing.hit).toContain("44");
    expect(rule(css, "row")).toContain("--sign-box: 32px;");
    expect(actionsCss).toContain("width: var(--sign-box, var(--hit-target-min, 44px));");
    expect(actionsCss).toMatch(/\.sign::after \{[^}]*width: var\(--hit-target-min, 44px\);/u);
  });
});

describe("состояния", () => {
  it("спрятана: приглушение .48 и знак 16 перед ценой", () => {
    expect(contract.states.hidden).toContain(".48");
    expect(contract.states.hidden).toContain("16");
    expect(contract.states.hidden).toContain("action-hide.svg");
    expect(rule(css, "dim")).toContain("opacity: 0.48;");
    expect(row).toContain("const HIDDEN_MARK_SIZE = 16;");
    // `action-hide.svg` — это наш перечёркнутый глаз: он совпал с файлом
    // пакета целиком (tests/item-actions).
    expect(row).toContain("<IconEyeOff size={HIDDEN_MARK_SIZE} />");
    // Слово «спрятана» осталось читалке — знак без подписи ей молчит.
    expect(row).toContain('aria-label={t("itemHiddenBadge")}');
  });

  it("«уже дарят» в строке НЕ показывается хозяйке — тихая бронь", () => {
    // Состояние «занято» контракт описывает для гостя; экрана «зона списком»
    // у гостя пока нет вовсе, а хозяйке знать о бронях нельзя ни при каких
    // условиях (инвариант №1). Поэтому в строке нет ни слова, ни пропа.
    expect(contract.states.taken).toContain("уже дарят");
    expect(row, "в строку зоны приехала бронь").not.toMatch(/taken/iu);
    expect(screen, "экран хозяйки узнал про занятые вещи").not.toMatch(/taken/iu);
  });

  it("у гостя знака ⋯ нет вовсе — и имени от этого +38", () => {
    expect(contract.states.guest).toContain("+38");
    // Ширина имени нигде не задана числом: она остаток полосы. Значит
    // «форма та же минус знак» получается сама — узел просто не рисуется.
    expect(row).toMatch(/\{trailing && <span className=\{s\.more\}>/u);
    expect(
      rule(css, "name"),
      "имени задали ширину числом — тогда у гостя она не сойдётся",
    ).not.toMatch(/^\s*width:/mu);
  });
});

describe("таблица ширин пакета сходится с нашей геометрией", () => {
  // Числа контракта: 171 на 375, 156 на 360, 116 на 320. Проверяем не сами
  // ширины (их меряет браузер), а ГЕОМЕТРИЮ: имя — остаток полосы, и запас
  // справа обязан быть одним и тем же на всех трёх ширинах.
  const rows = ["320", "360", "375"].map((key) => {
    const entry = contract.widths[key];
    expect(typeof entry === "object", `в таблице ширин пропала ${key}`).toBe(true);
    return entry as { available: number; name: number };
  });

  const BOX = 32;
  const fixed = form.thumb.size + GAP_THUMB + GAP_NAME + GAP_PRICE + BOX;

  it("поля листа: доступная ширина = экран − 20 − 20", () => {
    expect(rows.map((r) => r.available)).toEqual([320 - 40, 360 - 40, 375 - 40]);
  });

  it("запас под цену один и тот же на 320, 360 и 375", () => {
    const reserve = rows.map((r) => r.available - r.name - fixed);
    expect(new Set(reserve).size, `запас разъехался: ${reserve.join(" / ")}`).toBe(1);
    // Он же — ширина образца «140 000 ₽» в разметке дизайна.
    expect(reserve[0]).toBe(68);
  });

  it("«+38 у гостя» — это ровно промежуток 6 плюс коробка 32", () => {
    expect(GAP_PRICE + BOX).toBe(38);
  });

  it("«с огоньком минус 13» — это точка 5 плюс промежуток 8", () => {
    expect(String(contract.widths.note)).toContain("минус 13");
    expect(DOT + GAP_DOT).toBe(13);
  });
});

describe("счётчики зоны — над списком, не в строках", () => {
  it("хозяйке «N вещей» стоит в шапке страницы, раньше сетки", () => {
    expect(contract.counters).toContain("над списком");
    const counter = page.indexOf('t("zoneCounts"');
    const list = page.indexOf("<OwnerZoneGrid");
    expect(counter).toBeGreaterThan(-1);
    expect(counter).toBeLessThan(list);
  });

  it("в самой строке счётчиков нет", () => {
    expect(row).not.toContain("zoneCounts");
    expect(row).not.toContain("counts");
  });
});

describe("«комната списком» осталась прежней", () => {
  it("экран зоны больше не берёт у неё ни строки, ни модуля", () => {
    expect(screen, "экран зоны снова читает общий модуль").not.toContain("room-list");
    expect(screen).toContain('from "@/components/zone-row/zone-row"');
  });

  it("её собственные числа не тронуты: миниатюра 72, шаг 16", () => {
    // У неё в том же вердикте пакета своя форма — секции-зоны без знаков.
    // Правка формы зоны не имеет права её задеть.
    expect(shared).toMatch(/\.thumb \{[^}]*width: 72px;/u);
    expect(shared).toMatch(/\.row \{[^}]*gap: 16px;/u);
    expect(shared, "в общую строку приехала высота списка зоны").not.toContain("height: 52px");
    expect(shared, "в общую строку приехала миниатюра списка зоны").not.toContain("width: 36px");
  });

  it("телефонной ветки у неё по-прежнему нет вовсе", () => {
    expect([...shared.matchAll(/@media not all and \(min-width: 1024px\) \{/gu)]).toHaveLength(0);
  });
});
