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
// ФАЙЛ КОНТРАКТА ЗАМЕНЁН ОРИГИНАЛОМ (тикет 163). Строку мы собирали по копии,
// восстановленной из прочтения: папку round36 перезаписали, файл исчез с диска.
// Дизайн прислал оригинал раундом 40, и три числа разошлись с нашей копией:
//   • глиф «⋯» 20 → 19 — ОПИСКА ПАКЕТА, подтверждённая письмом 42 («как весь
//     набор»). Своего кегля у строки не осталось: 19 и есть общий SIGN_SIZE;
//   • цвет имени #F2EDE4 → #FFF9F2: первый объявлен непродуктовым вовсе
//     (доска-документ и заливка по умолчанию в файлах знаков);
//   • ширины цены в контракте больше НЕТ — цена auto. Зато коробка знака 32
//     теперь стоит прямым числом (form.trailing.box), и выводить её не нужно.
//
// ЗАМЕР В БРАУЗЕРЕ (10.08, стенд, Onest живой, образец цены «140 000 ₽»):
//   375 → имя 173.2 · 360 → 158.0 · 320 → 118.0; с огоньком «мечтаю» — ровно
//   на 13 меньше на всех трёх ширинах; строка 52.0 в высоту, коробка «⋯»
//   32×44, цель нажатия 44×44 и заходит на 6 px в правый отступ листа; имя в
//   62 знака без пробелов и дефисов страницу вбок не тянет (scrollWidth 320
//   при innerWidth 320). ЭТИ ЖЕ ТРИ ЧИСЛА СТОЯТ ТЕПЕРЬ В ПАКЕТЕ: таблица
//   ширин помечена иллюстрацией на образце цены, и дизайн заменил свои
//   171/156/116 нашими замерами. Прежнее расхождение +2 целиком жило в ЦЕНЕ —
//   одна строка в двух отрисовках, у нас 66.0 px, у него 68.2.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import contractJson from "@design/zone-row.json";
import tokensJson from "@design/tokens.json";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const css = read("../src/components/zone-row/zone-row.module.css");
const row = read("../src/components/zone-row/zone-row.tsx");
const screen = read("../src/app/room/zone/[zone]/owner-zone-grid.tsx");
const page = read("../src/app/room/zone/[zone]/page.tsx");
const actions = read("../src/components/item/item-actions.tsx");
const actionsCss = read("../src/components/item/item-actions.module.css");
const shared = read("../src/components/room-list/room-list.module.css");

const contract = contractJson as unknown as {
  form: {
    height: number;
    padding: string;
    divider: string;
    thumb: { size: number; radius: number; fit: string; empty: string };
    gaps: string[];
    name: { font: string; color: string; lines: number; overflow: string; width: string };
    price: {
      font: string;
      nowrap: boolean;
      tabularNums: boolean;
      color: string;
      width: string;
    };
    wishDot: { size: number; when: string };
    trailing: { glyph: number; box: number; hit: string; icon: string };
  };
  widths: Record<string, number | string>;
  states: Record<string, string>;
  counters: string;
  confirmations: Record<string, string>;
};

const form = contract.form;

/** Лестница цветов — чтобы «ступень text.primary» проверялась, а не верилась. */
const tokens = tokensJson as unknown as { text: { primary: string; body: string } };

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

/**
 * Цвет из записи контракта. Теперь он приходит ступенью лестницы со значением
 * в скобках — «text.primary (#FFF9F2)», — и проверять надо оба: имя ступени
 * говорит, ОТКУДА цвет, значение — какой он.
 */
function colorOf(spec: string): string {
  const found = /(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/u.exec(spec);
  expect(found, `в записи цвета нет самого цвета: ${spec}`).toBeTruthy();
  return (found as RegExpExecArray)[1] as string;
}

describe("контракт прочитан целиком — иначе проверять нечего", () => {
  it("в файле пакета есть все числа, которыми меряется строка", () => {
    expect(form.height).toBe(52);
    expect(form.thumb.size).toBe(36);
    expect(form.thumb.radius).toBe(0);
    expect(form.wishDot.size).toBe(5);
    // 19, а не 20: описку пакета дизайн признал письмом 42.
    expect(form.trailing.glyph).toBe(19);
    // Коробка знака стоит ПРЯМЫМ числом — выводить её из «+38» больше не надо.
    expect(form.trailing.box).toBe(32);
    expect(gaps, "строка промежутков пакета читается пятью числами").toEqual([12, 5, 8, 10, 6]);
  });

  it("это ОРИГИНАЛ пакета, а не наша копия из прочтения", () => {
    // Копия жила с пометкой о восстановлении и с тремя разошедшимися числами.
    // Оригинал приехал раундом 40 и лежит в нём же — сверяем побайтно, чтобы
    // «восстановленный по памяти» файл не вернулся однажды назад.
    // Перевод строки нормализуем: под Windows git отдаёт файлы с CRLF, и
    // сравнение сырых байтов ловило бы не подмену числа, а настройку рабочей
    // копии. Всё остальное — посимвольно.
    const eol = (text: string) => text.replace(/\r\n/gu, "\n");
    expect(eol(read("../design/package/handoff/zone-row.json"))).toBe(
      eol(read("../design/package/handoff/round40/zone-row.json")),
    );
    expect(JSON.stringify(contractJson)).not.toContain("ВОССТАНОВЛЕНО");
    // И сам пакет называет, что именно поменялось против нашей копии.
    expect(contract.confirmations.glyph).toContain("ОПИСКА НАША");
    expect(contract.confirmations.priceWidth).toContain("не должно быть в контракте");
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
  it("имя 600 13.5/1.2 и цвет #FFF9F2 — ступень text.primary", () => {
    expect(rule(css, "name")).toContain(cssFont(form.name.font));
    expect(form.name.lines).toBe(1);
    // ЦВЕТ СМЕНИЛСЯ. #F2EDE4 дизайн объявил непродуктовым вовсе: это цвет
    // доски-документа и заливка по умолчанию в файлах знаков (в сборке —
    // currentColor). Ловим оба конца: имя ступени и её значение.
    expect(form.name.color).toContain("text.primary");
    expect(colorOf(form.name.color).toLowerCase()).toBe("#fff9f2");
    expect(rule(css, "name")).toContain(`color: ${colorOf(form.name.color).toLowerCase()};`);
    // И ступень эта настоящая: то же число лежит в лестнице токенов.
    expect(norm(tokens.text.primary)).toBe(norm(colorOf(form.name.color)));
    // Ловим объявление, а не упоминание: в комментарии рядом с правилом
    // прежний цвет назван нарочно — чтобы следующий читатель знал, откуда он
    // взялся и почему ушёл.
    expect(css, "непродуктовый цвет вернулся в строку").not.toMatch(/color:\s*#f2ede4/iu);
  });

  it("цена 500 12.5/1, tabular-nums, без переноса — ступень text.body", () => {
    const price = rule(css, "price");
    expect(price).toContain(cssFont(form.price.font));
    expect(form.price.color).toContain("text.body");
    // Цепочка «пакет → токен → модуль» проверяется двумя звеньями, потому что
    // с тикета 174 модуль пишет ИМЯ ступени, а не её значение: значение стоит
    // ровно в одном месте — объявлении токена.
    expect(norm(tokens.text.body)).toBe(norm(colorOf(form.price.color)));
    expect(price).toContain("color: var(--color-text-body);");
    expect(form.price.nowrap).toBe(true);
    expect(price).toContain("white-space: nowrap;");
    expect(form.price.tabularNums).toBe(true);
    expect(price).toContain("font-variant-numeric: tabular-nums;");
  });

  it("ШИРИНЫ У ЦЕНЫ НЕТ — ни в контракте, ни в CSS", () => {
    // Прежде мы выводили её из таблицы ширин имени (68 на образце «140 000 ₽»)
    // и держали это число в шапке CSS. Дизайн снял ширину из контракта вовсе:
    // «цена это СОДЕРЖИМОЕ — width auto, nowrap, tabular-nums». Числа в записи
    // теперь нет ни одного — и появиться ему негде.
    expect(form.price.width).toContain("auto");
    expect(form.price.width, "в ширину цены вернулось число").not.toMatch(/\d/u);
    expect(rule(css, "price"), "цене задали ширину — она перестала быть содержимым").not.toMatch(
      /^\s*width:/mu,
    );
    // Имя — остаток полосы, и это тоже сказано словами, а не числом.
    expect(form.name.width).toContain("min-width 0");
  });
});

describe("знак в конце — ОДИН, 19 в коробке 32 на цели 44", () => {
  it("главного знака в строке зоны нет: дорога в вещь — сама строка", () => {
    // Карандаш отсюда ушёл вместе с 44 px, которые он занимал. Точка входа
    // теперь настоящая: строка — ссылка.
    expect(screen, "в строке зоны снова два знака").not.toContain("primary={{");
    expect(screen).toMatch(/href=\{[\s\S]{0,120}`\/room\/zone\/\$\{zoneKey\}\/i\/\$\{item\.id\}`/u);
    expect(row).toContain("<Link href={href}");
  });

  it("глиф — ОБЩИЙ 19, своего числа у строки зоны больше нет", () => {
    // Полгода строка носила собственный кегль 20, и это была ОПИСКА пакета:
    // «глиф ⋯ — 19, как весь набор» (письмо 42). Второе число на тот же знак
    // и есть та щель, в которую уезжает пиксель разницы с соседним экраном.
    expect(actions).toContain(`export const SIGN_SIZE = ${form.trailing.glyph};`);
    // Опять же объявление, а не упоминание: имя снятой константы в
    // комментарии — часть объяснения, почему её больше нет.
    expect(row, "у строки снова завёлся свой кегль").not.toMatch(/ZONE_ROW_GLYPH\s*=/u);
    expect(screen, "экрану зоны снова задают кегль знака руками").not.toContain("glyph=");
  });

  it("коробка 32 при цели 44 — цель заходит в правый отступ листа", () => {
    // Число ПРИШЛО ИЗ ПАКЕТА прямым (form.trailing.box), а не выведено нами из
    // фразы «у гостя знака ⋯ нет вовсе, поэтому имени +38». Дизайн подтвердил
    // и вывод, и число: 19 знак + по 6.5 воздуха. Цель добирают по 6 с двух
    // сторон, и правые 6 ложатся в 20 px отступа листа.
    expect(form.trailing.hit).toContain("44");
    expect(rule(css, "row")).toContain(`--sign-box: ${form.trailing.box}px;`);
    expect(actionsCss).toContain("width: var(--sign-box, var(--hit-target-min, 44px));");
    expect(actionsCss).toMatch(/\.sign::after \{[^}]*width: var\(--hit-target-min, 44px\);/u);
    // Коробка 32 при знаке 19 — это ровно по 6.5 воздуха с каждой стороны.
    expect((form.trailing.box - form.trailing.glyph) / 2).toBe(6.5);
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

  it("«занято» СНЯТО из формы самим пакетом — показывать некому", () => {
    // Прежняя копия контракта описывала это состояние для гостя. Оригинал
    // раунда 40 снял его целиком и назвал причину нашими же словами: хозяйке
    // бронь не показывается никогда (инвариант №1), а у гостя нет самого
    // экрана. Мы этого пропа и не заводили — теперь так и в пакете.
    expect(contract.states.taken).toContain("СНЯТО");
    expect(contract.states.taken).toContain("тихая бронь");
    expect(row, "в строку зоны приехала бронь").not.toMatch(/taken/iu);
    expect(screen, "экран хозяйки узнал про занятые вещи").not.toMatch(/taken/iu);
  });

  it("гостевого экрана нет — но строка к нему готова, и знак у неё необязателен", () => {
    // Поправку про гостя дизайн принял целиком: «ЭКРАНА НЕТ». Наша
    // структурная готовность при этом названа правильной и оставлена как есть
    // — знак «⋯» необязателен, ширина имени нигде не число. Отсюда и «+38 у
    // гостя»: узел просто не рисуется, и остаток полосы прибавляется сам.
    expect(contract.states.guest).toContain("ЭКРАНА НЕТ");
    expect(contract.states.guest).toContain("необязателен");
    expect(row).toMatch(/\{trailing && <span className=\{s\.more\}>/u);
    expect(
      rule(css, "name"),
      "имени задали ширину числом — тогда у гостя она не сойдётся",
    ).not.toMatch(/^\s*width:/mu);
  });
});

describe("таблица ширин — ИЛЛЮСТРАЦИЯ с нашими замерами", () => {
  // ЭТО САМОЕ ВАЖНОЕ ИЗМЕНЕНИЕ ТИКЕТА 163, и оно не про числа, а про их вес.
  // Прежде таблица была КОНТРАКТОМ (171/156/116), и мы выводили из неё два
  // числа: коробку знака 32 и ширину цены 68. Дизайн разобрал оба вывода:
  // коробку подтвердил и вписал прямым числом, а таблицу пометил образцом —
  // «ИЛЛЮСТРАЦИЯ на образце „140 000 ₽“, не контракт», — и заменил свои числа
  // НАШИМИ замерами. Значит проверять её как контракт больше нельзя; зато
  // можно проверить, что иллюстрация не спорит с нашей же геометрией.
  const MEASURED: Record<string, number> = { "320": 118, "360": 158, "375": 173.2 };
  const SHEET_PADDING = 20;
  const fixed = form.thumb.size + GAP_THUMB + GAP_NAME + GAP_PRICE + form.trailing.box;

  it("таблица помечена образцом и держит наши замеры, а не свои прежние", () => {
    expect(String(contract.widths.note)).toContain("ИЛЛЮСТРАЦИЯ");
    expect(String(contract.widths.note)).toContain("не контракт");
    for (const [screenWidth, name] of Object.entries(MEASURED)) {
      expect(contract.widths[screenWidth], `ширина ${screenWidth}`).toBe(name);
    }
    // Прежние 171/156/116 из пакета ушли — иначе иллюстрация врёт вдвойне.
    expect(Object.values(contract.widths)).not.toContain(171);
  });

  it("запас справа один и тот же на 320, 360 и 375 — имя правда остаток", () => {
    // Единственное, что таблица всё ещё доказывает: у имени нет своей ширины.
    // Раз оно остаток полосы, то «экран − поля − имя» обязано быть постоянным.
    const reserve = Object.entries(MEASURED).map(
      ([screenWidth, name]) => Number(screenWidth) - SHEET_PADDING * 2 - name,
    );
    const spread = Math.max(...reserve) - Math.min(...reserve);
    expect(spread, `запас разъехался: ${reserve.join(" / ")}`).toBeLessThanOrEqual(0.2);
  });

  it("в запасе — фикс строки и наш замер цены 66, а не выведенные 68", () => {
    // 96 = миниатюра 36 + 12 + 10 + 6 + коробка 32. Остаток и есть цена
    // образца «140 000 ₽» в НАШЕЙ отрисовке: 66.0. Дизайн назвал разницу с
    // его 68.2 прямо — «одна строка в двух отрисовках», — и потому ширины
    // цены в контракте больше нет вовсе.
    expect(fixed).toBe(96);
    const price = 320 - SHEET_PADDING * 2 - MEASURED["320"]! - fixed;
    expect(price).toBe(66);
    expect(contract.confirmations.priceWidth).toContain("66.0");
    expect(contract.confirmations.priceWidth).toContain("68.2");
  });

  it("«+38 у гостя» — это ровно промежуток 6 плюс коробка 32 из пакета", () => {
    expect(GAP_PRICE + form.trailing.box).toBe(38);
    expect(row, "в строке пропало объяснение, откуда у гостя +38").toContain("+38");
  });

  it("«с огоньком минус 13» — это точка 5 плюс промежуток 8", () => {
    // Строка переехала из note в свой ключ и стала подтверждением: «сошлось у
    // обоих» — это единственное число таблицы, которое дизайн у себя проверил.
    expect(String(contract.widths.wishDot)).toContain("минус 13");
    expect(DOT + GAP_DOT).toBe(13);
  });

  it("высота 52 — на всех ширинах и на десктопе", () => {
    expect(String(contract.widths.rowHeight)).toContain(`${form.height}`);
    expect(rule(css, "row")).toContain(`height: ${form.height}px;`);
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
