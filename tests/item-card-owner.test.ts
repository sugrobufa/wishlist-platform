// Карточка вещи глазами хозяйки, редакция v2 (тикет 159, доска 47a; контракт
// round41 — тикет 170).
//
// ЗАЧЕМ ТЕСТ. У этой карточки две обязанности, и обе ломаются молча.
//
// Первая — ИНВАРИАНТ №1. Карточка вещи это главный соблазн его нарушить: на
// экране одна вещь, про неё известно всё, и «показать, что её уже забрали»
// выглядит заботой. Нарушение не падает ни в типах, ни в линте — оно просто
// однажды появляется строчкой «занята» или подсказкой у знака. Поэтому здесь
// проверяется не только текст, но и АТРИБУТЫ: `aria-label`, `title`, `data-*`
// уезжают в разметку сервером ровно так же, как видимые слова.
//
// Вторая — ЧИСЛА КОНТРАКТА. Они читаются ИЗ КОНТРАКТА, а не набиты сюда
// руками: приедет раунд 40 с другим фото — тест покраснеет и скажет, что
// разошлось, вместо того чтобы держать позапрошлые числа с уверенным видом.
//
// Отдельным разделом — ЧЕГО МЫ ИЗ КОНТРАКТА НЕ ВЗЯЛИ и почему. Молчаливое
// расхождение с пакетом = баг (CLAUDE.md), а названное вслух и проверенное —
// решение. Разойдись причина с действительностью (дизайн поправит числа,
// у нас появится галерея) — покраснеет здесь, а не на приёмке.
//
// СЕГОДНЯ ЭТОТ РАЗДЕЛ ПУСТ ПО СУЩЕСТВУ, И ЭТО ЕГО ЛУЧШИЙ ДЕНЬ (тикет 170).
// Пять расхождений держались списком с round39; раунд 41 закрыл ВСЕ ПЯТЬ, и
// закрыл в нашу сторону — четыре раза словами «вы поймали верно». Проверки не
// удалены, а перевёрнуты: каждая теперь требует, чтобы контракт говорил то же,
// что делает код. Уедет он обратно — покраснеет здесь.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { IconBack } from "../src/components/icons";
import ru from "../messages/ru.json";
import en from "../messages/en.json";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const card = read("../src/app/room/zone/[zone]/i/[id]/item-card.tsx");
const page = read("../src/app/room/zone/[zone]/i/[id]/page.tsx");
const css = read("../src/components/item/owner-card.module.css");
/** Общий файл — источник чисел подложки (`.imm-corner-mark`, тикет 218). */
const globalsCss = read("../src/app/globals.css");
const sheetCss = read("../src/components/item/item-actions.module.css");
const sheetSrc = read("../src/components/item/item-actions.tsx");
const shopCss = read("../src/components/zone/shop-link.module.css");
const thumb = read("../src/components/item/shelf-frame.ts");
const dto = read("../src/server/dto/items.ts");

/** Контракт карточки — источник чисел (раунд 41, ответ на письмо 43). */
const contract = JSON.parse(
  read("../design/package/handoff/round41/item-card-owner.json"),
) as {
  screen: { photo: { h: number; fit: string; empty: string }; surface: string };
  head: { back: string; more: string };
  body: {
    name: string;
    price: string;
    zone: string;
    wish: string;
    note: string;
    link: string;
    order: string;
  };
  mainAction: { label: string; form: string; hit: string };
  sheet: {
    form: string;
    rows: ReadonlyArray<{ label: string; icon: string }>;
    confirm: string;
    galleryDropped: string;
  };
  absent: Record<string, string>;
  treasuryVariant: string;
  /** Перечень строк листа витрины — вернулся раундом 42 (тикет 179). */
  treasuryVariantSheet: {
    rows: ReadonlyArray<{ label: string; icon: string; string: string; note?: string }>;
    mainAction: string;
  };
  changedFrom: { baseline: string; changed: readonly string[] };
};

/**
 * КОНТРАКТ ЭКРАНА ЧТЕНИЯ — round45, а не round44 (тикет 196, INTAKE-round45).
 * Разница не косметическая: в round45 у КАЖДОГО блока чисел стоит свой
 * `frameWidth` и рядом правило переноса. Одного `measuredFrom` на файл не
 * хватило — оно спорило с соседним числом, мы это поймали письмом 48, и дизайн
 * починил нашей же правкой.
 *
 * `scaling` — то самое правило: высоты привязаны к 430 и переносятся на 375
 * умножением на 0.872. Не переносятся, они абсолютные: цели нажатия 44, строки
 * листа 56, полоса света 2, бирка 218×66.
 */
const reading = JSON.parse(read("../design/package/handoff/round45/item-card.json")) as {
  principle: string;
  owner: {
    question: string;
    photo: { w: number; h: number; frameWidth: number; measuredFrom: string };
    order: readonly string[];
    changedFrom47a: readonly string[];
    unchangedFrom47a: readonly string[];
    storesCollapsed: string;
    bookingInvariant: string;
  };
  guest: {
    question: string;
    photo: { w: number; h: number };
    order: readonly string[];
    notShown: readonly string[];
    tag: { w: number; h: number; rule: string };
    privacy: string;
    pool: { collapsed: string; invariant: string };
    taken: { photo: string; tag: string; instead: string };
  };
  cases: {
    noPhoto: { fill: string; h: number; inside: string; ownerAction: string; guestAction: string };
    treasury: { gone: readonly string[]; instead: string; mainAction: string; guest: string };
    noPriceNoStore: { holdsIt: string; alsoChanges: readonly string[]; noPlaceholders: string };
  };
  a11y: { targets: string; contrast: string };
  scaling: string;
};

/**
 * ЗНАКИ ШАПКИ НА ФОТОГРАФИИ — round48 (тикет 221, ответ на письмо 52, пункт 5).
 * Приём подложки дизайн принял целиком и «принял потому, что он не новый», и
 * поставил три условия. Два взяты кодом (тень снять, форма круглая), третье у
 * нас беспредметно — шапка карточки не липкая; все три читаются здесь, чтобы
 * взятое и невзятое стояли рядом и назывались вслух.
 */
const signs = JSON.parse(read("../design/package/handoff/round48/photo-signs.json")) as {
  backing: {
    size: number;
    shape: string;
    fill: string;
    blur: string;
    underBothSigns: boolean;
    whyBoth: string;
  };
  conditions: ReadonlyArray<{ n: number; rule: string; why: string }>;
  glyphs: { back: number; more: number; changed: boolean };
};

/** Условие контракта по номеру — их ровно три, и порядок в файле не обещан. */
const condition = (n: number) => {
  const found = signs.conditions.find((one) => one.n === n);
  expect(found, `в контракте нет условия ${n}`).toBeDefined();
  return found as { n: number; rule: string; why: string };
};

/** Первое число контрактной строки — «знак зоны 16 при .55», «⋯ 20 в цели 44». */
const firstNumber = (text: string): number => Number(/(\d+(?:\.\d+)?)/u.exec(text)?.[1]);

/**
 * Размер знака пула на пустом фото. Своим разбором, а не `firstNumber`:
 * строка контракта начинается с цвета заливки («rgba(255,255,255,.05)»), и
 * первое число в ней — 255, а не размер знака.
 */
const poolSignSize = (text: string): number =>
  Number(/(?:знак|значок) пула (\d+)/u.exec(text)?.[1]);

/**
 * Исходник без комментариев. Про бронь в комментариях написано много и
 * написано правильно — это объяснение, а не разметка, и ловить его нельзя.
 */
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");

/**
 * Пары «селектор → тело» из CSS БЕЗ КОММЕНТАРИЕВ. Нужны там, где важно не
 * «встречается ли свойство в файле», а «в каком именно правиле оно стоит»:
 * подложка знаков шапки законна на самих знаках и незаконна на любом их
 * предке (тикет 218, ловушка 170).
 */
function rules(css: string): Array<{ selector: string; body: string }> {
  return [...strip(css).matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map((match) => ({
    selector: (match[1] as string).trim(),
    body: match[2] as string,
  }));
}

/** Тело правила с РОВНО таким селектором (а не с похожим на него). */
function ruleBody(css: string, selector: string): string {
  const found = rules(css).filter((rule) => rule.selector === selector);
  expect(found, `в CSS нет правила ${selector}`).toHaveLength(1);
  return found[0]?.body ?? "";
}

/** Значение свойства из тела правила — «rgba(11, 8, 6, 0.55)», «blur(8px)». */
function value(body: string, property: string): string {
  const match = new RegExp(`(?:^|[;\\s])${property}:\\s*([^;]+);`, "u").exec(body);
  expect(match, `в правиле нет свойства ${property}`).not.toBeNull();
  return (match?.[1] ?? "").trim();
}

/**
 * Ключи строк листа в порядке появления, без повторов, — та же мерка, что в
 * `tests/item-actions.test.ts`: состав листа обязан падать при первой же
 * лишней или потерянной строке.
 */
function sheetKeys(source: string): string[] {
  const keys = [...source.matchAll(/key:\s*"([a-z]+)"/gu)].map((match) => match[1] as string);
  return [...new Set(keys)];
}

/** Кусок исходника, в котором собирается лист «⋯», — от `sheetRows` до JSX. */
function sheetSource(source: string): string {
  const from = source.indexOf("const sheetRows: ItemActionRow[]");
  expect(from, "sheetRows — не нашлось").toBeGreaterThan(-1);
  return source.slice(from, source.indexOf("<main className={s.screen}"));
}

describe("инвариант №1: в карточке нет ни слова о брони", () => {
  // Слова, которыми нарушение только и может выглядеть. Список нарочно шире
  // нужного: «свободна» и «осталась» ловят попытку сказать то же самое
  // наоборот — «эту ещё никто не взял» сообщает ровно столько же.
  const FORBIDDEN =
    /бронь|брони|бронир|забрал|забрана|заняt|занята|занято|свободн|подарит кто|booking|reserved/iu;

  it("ни в тексте карточки, ни в её стилях", () => {
    expect(strip(card)).not.toMatch(FORBIDDEN);
    expect(strip(css)).not.toMatch(FORBIDDEN);
  });

  it("ИСХОДНИК КАРТОЧКИ НЕ ОБРАЩАЕТСЯ К ПОЛЮ `booking` ВООБЩЕ", () => {
    // ГЛАВНАЯ ПРОВЕРКА ИНВАРИАНТА №1, и она ТЕКСТОВАЯ, а не по разметке —
    // так велит и тикет 196, и сам контракт (round45 → owner.bookingInvariant:
    // «карточка собирается из полей вещи и НЕ ЧИТАЕТ поле booking вообще. Это
    // дешевле проверить, чем „не показывать": тест — отсутствие обращения к
    // полю, а не отсутствие строки на экране»).
    //
    // Почему она сильнее проверки экрана: «не показали» обходится вёрсткой —
    // условием, `opacity: 0`, порядком блоков, — а «не прочитали» обойти
    // нечем. Читать нечего: в owner-DTO ключа `booking` нет (`booking!` в
    // сериализации), и появиться он может только новой строкой в этом файле.
    expect(reading.owner.bookingInvariant).toContain("НЕ ЧИТАЕТ поле booking");
    // Обращение к полю в любом виде: `.booking`, `booking:`, `booking =`,
    // `booking?.`, деструктуризация `{ booking }`. Комментарии сняты — про
    // бронь в них написано много и написано правильно.
    expect(strip(card)).not.toMatch(/\bbooking\b/iu);
    // И у гостевой половины та же мерка с другой стороны: там бронь ЧИТАЕТСЯ,
    // но не полем вещи, а отдельным некэшируемым каналом (тикет 08). Если
    // однажды `booking` появится в самом DTO, покраснеет здесь.
    expect(dto).toContain("booking!");
  });

  it("и ни в одном атрибуте, уезжающем в разметку", () => {
    // aria-label, title и data-* — та же разметка, только её не видно глазами.
    // Проверяются ЗНАЧЕНИЯ атрибутов: и строкой, и выражением через словарь.
    const attrs = [
      ...card.matchAll(/(?:aria-label|title|data-[a-z-]+)=\{?["`\{]?([^"`\}\n]*)/gu),
    ].map((match) => match[1] as string);
    expect(attrs.length).toBeGreaterThan(0);
    for (const value of attrs) expect(value, value).not.toMatch(FORBIDDEN);
  });

  it("страница брони не читает: у неё нет ни сервиса, ни счётчика", () => {
    expect(strip(page)).not.toMatch(/booking|Booking|takenCount|taken/u);
  });

  it("owner-DTO по-прежнему без брони — карточка берёт данные только из него", () => {
    // Пояс к подтяжкам `tests/items.dto.test.ts`: сюда карточка смотрит.
    expect(dto).toContain("booking!");
    expect(card).toContain('import type { OwnerItemDto } from "@/server/dto/items";');
  });

  it("имя дарителя живёт ТОЛЬКО в ветке сокровищницы", () => {
    // Это не бронь: имя раскрыто один раз на «что подарили» (инвариант №2), и
    // вещь к тому моменту уже переехала. Но в ветке КОМНАТЫ его быть не может
    // ни при каком условии — там оно означало бы ровно «кто её забрал».
    expect(card).toContain('const love = item.inHall ? item : null;');
    expect(card).toContain('const want = item.inHall ? null : item;');
    // Все обращения к имени идут через `love`, то есть через `item.inHall`;
    // плюс собственное состояние формы витрины (`giverName`/`setGiverName`).
    for (const hit of card.match(/[\w?.]*giverName/gu) ?? []) {
      expect(hit, hit).toMatch(/^(love\??\.giverName|giverName|setGiverName)$/u);
    }
    expect(card).not.toMatch(/want[?.]*\.giverName|item\.giverName/u);
  });

  it("«В сокровищницу» видна ВСЕГДА и одинакова — это тоже инвариант №1", () => {
    // Письмо 29: спрятанная или притушенная при живой брони кнопка сообщила бы
    // поимённо, что вещь забрали. Поэтому у строки нет ни условия показа, ни
    // ветки вида — и карточка про бронь не спрашивает вовсе.
    const treasury = /key: "treasury",[\s\S]*?onSelect: \(\) => setConfirming\("treasury"\),/u;
    expect(card).toMatch(treasury);
    const row = treasury.exec(card)?.[0] ?? "";
    expect(row).not.toContain("?");
    expect(contract.sheet.rows[0]?.label).toBe("В сокровищницу");
  });

  it("вопрос перед необратимым — про ВЕЩЬ, а не про бронь", () => {
    expect(ru.Settings.itemHallAddConfirm).toBe("Перенести в сокровищницу?");
    expect(ru.Settings.itemDeleteConfirm).toBe("Удалить насовсем?");
    for (const key of ["itemHallAddConfirm", "itemDeleteConfirm", "itemHallAddYes"] as const) {
      expect(ru.Settings[key], key).not.toMatch(FORBIDDEN);
      expect(en.Settings[key], key).not.toMatch(FORBIDDEN);
    }
  });
});

describe("инвариант №8: цена комнаты по правилу, цена витрины — только хозяйке", () => {
  it("цена вещи КОМНАТЫ видна хозяйке всегда, а не по priceVisibility", () => {
    // `priceVisibility` — про ГОСТЯ. В показе карточки его нет вовсе: он
    // остался переключателем в форме правки.
    expect(card).toContain("const roomPrice =");
    expect(card).toMatch(/want\?\.price == null \? null : formatHallMoney/u);
    // ПОКАЗ НИ РАЗУ НЕ СПРАШИВАЕТ ПРО ВИДИМОСТЬ, ЧТОБЫ РЕШИТЬ, ПОКАЗЫВАТЬ ЛИ.
    //
    // ПЕРЕВЁРНУТО ТОЧЕЧНО (тикет 196). Прежде здесь стояло «в показе слова
    // `priceVisibility` нет вовсе» — и это было верно ровно до контракта
    // round45, который просит СТРОКУ «цену видят все» (owner.order). Строка
    // читает то же поле, и запрет на слово поймал бы её первой.
    //
    // Настоящее правило не про слово, а про роль: видимость НАЗЫВАЕТ адресата
    // и решает, показать ли ЧУЖОЕ число, — но не решает, рисовать ли ЕЁ цену.
    // Поэтому проверяется, где именно поле встречается: строка-подпись (два
    // обращения) и «от {price}» в свёрнутых магазинах (третье, round46 —
    // строка магазинов зеркалит то, что получит гость).
    const view = card.slice(card.indexOf("<main className={s.screen}"), card.indexOf("{editing && ("));
    expect([...view.matchAll(/priceVisibility/gu)]).toHaveLength(3);
    expect(view).toContain('want?.priceVisibility !== "NONE" && (');
    expect(view).toContain('tField(`cardPriceVis${want?.priceVisibility ?? "ALL"}`)');
    expect(view).toContain('guestSeesPrice(want?.priceVisibility ?? "ALL")');
    // Сама цена по-прежнему нарисована БЕЗ единого условия про видимость:
    // хозяйке её собственная цена видна всегда (инвариант №8). С пакета 49
    // условие переехало на всю строку — огоньков в ней больше нет, и пустой
    // строке цены стоять не за чем (тикет 225).
    expect(view).toMatch(
      /\{!item\.inHall && roomPrice !== null && \(\s*<div className=\{s\.priceRow\}>\s*<span className=\{s\.price\}>\{roomPrice\}<\/span>/u,
    );
  });

  it("цена вещи ВИТРИНЫ приходит отдельным путём и только хозяйке", () => {
    // Ключей price/currency у формы витрины в owner-DTO нет вовсе — цену
    // считает `hallItemForOwner` (ADR-0004), и это единственный её путь сюда.
    expect(card).toContain("hall?.price != null");
    expect(page).toContain("hallItemForOwner(item, hallSettingsOf(room), null)");
    expect(dto).toContain("export type OwnerHallItemDto");
    const hallForm = /export type OwnerHallItemDto = [\s\S]*?\n\};/u.exec(dto)?.[0] ?? "";
    expect(hallForm).not.toMatch(/\bprice\b|\bcurrency\b/u);
  });

  it("«где купить» есть у формы КОМНАТЫ и нет у формы витрины", () => {
    const roomForm = /export type OwnerRoomItemDto = [\s\S]*?\n\};/u.exec(dto)?.[0] ?? "";
    expect(roomForm).toContain("shop: ShopDto | null;");
    const hallForm = /export type OwnerHallItemDto = [\s\S]*?\n\};/u.exec(dto)?.[0] ?? "";
    expect(hallForm).not.toContain("shop");
    // У хозяйки ссылка НЕ зависит от `priceVisibility`, в отличие от гостя.
    expect(dto).toContain("shop: shopOf(item.canonicalUrl),");
  });

  it("разбор адреса магазина в продукте ОДИН", () => {
    // Гостевая половина берёт его отсюда же: два разбора — два ответа на
    // вопрос «куда ведёт эта вещь».
    const guest = read("../src/server/dto/guest-items.ts");
    expect(guest).toContain("export const guestShop = shopOf;");
    expect(guest).not.toMatch(/export function guestShop/u);
  });
});

describe("числа контракта round45 — из контракта, а не набитые", () => {
  it("ПРАВИЛО ПЕРЕНОСА взято как правило, а не как множитель в коде", () => {
    // Контракт: высоты привязаны к 430 и переносятся на 375 умножением на
    // 0.872. У нас это записано `aspect-ratio` от контрактной пары — высота
    // считается ОТ ШИРИНЫ и на 375 выходит сама. Множитель, вбитый руками,
    // врал бы на любой третьей ширине, а их у продукта больше двух.
    expect(reading.scaling).toContain("0.872");
    expect(reading.owner.photo.frameWidth).toBe(430);
    // 375 / 430 и есть 0.872 — правило контракта проверяется арифметикой, а не
    // доверием: разойдись оно с числом, покраснеет здесь.
    expect(Math.round((375 / reading.owner.photo.frameWidth) * 1000) / 1000).toBe(0.872);
    // И обещанные 307 на 375 — те же 352 × 0.872.
    expect(reading.owner.photo.measuredFrom).toContain("307");
    expect(Math.round(reading.owner.photo.h * (375 / 430))).toBe(307);
    // Абсолютные числа переносу НЕ подлежат и стоят числом.
    for (const absolute of ["44", "56", "2", "218×66"]) {
      expect(reading.scaling, absolute).toContain(absolute);
    }
  });

  it("фотография 430×352 пропорцией, cover; на пустом — 236, знак 38 при .3", () => {
    expect([reading.owner.photo.w, reading.owner.photo.h]).toEqual([430, 352]);
    expect(css).toContain(
      `aspect-ratio: ${reading.owner.photo.w} / ${reading.owner.photo.h}`,
    );
    expect(css).toContain("background-size: cover");
    // ПУСТОЕ НЕ ЗАНИМАЕТ СТОЛЬКО ЖЕ, СКОЛЬКО ПОЛНОЕ: 236 вместо 352.
    expect(reading.cases.noPhoto.h).toBe(236);
    expect(css).toContain(`aspect-ratio: ${reading.owner.photo.w} / ${reading.cases.noPhoto.h}`);
    expect(reading.cases.noPhoto.fill).toBe("rgba(255,255,255,.05)");
    expect(css).toContain("background-color: rgba(255, 255, 255, 0.05)");
    // Знак пула вырос с 34 (round41) до 38, ступень — .3 вместо .35.
    expect(card).toContain(`const EMPTY_PHOTO_SIGN = ${poolSignSize(reading.cases.noPhoto.inside)}`);
    expect(poolSignSize(reading.cases.noPhoto.inside)).toBe(38);
    expect(css).toContain("color: rgba(255, 249, 242, 0.3)");
    // Подпись полки под знаком — 11/.14em uppercase при .42.
    expect(reading.cases.noPhoto.inside).toContain("подпись полки 11/.14em uppercase .42");
    expect(css).toMatch(/\.photoEmptyLabel \{[\s\S]*?font: 400 11px\/1\.2 var\(--font-ui\);/u);
    expect(css).toMatch(/\.photoEmptyLabel \{[\s\S]*?letter-spacing: 0\.14em;/u);
    expect(css).toMatch(/\.photoEmptyLabel \{[\s\S]*?color: rgba\(255, 249, 242, 0\.42\);/u);
  });

  it("прежние числа round41 УШЛИ, а не остались рядом", () => {
    // Молчаливое сосуществование двух редакций — то, ради чего этот раздел и
    // заведён: экран показывал бы round45, а половина чисел жила бы от 47a.
    expect(css).not.toContain(`height: ${contract.screen.photo.h}px`);
    expect(css).not.toContain("font: 700 22px/1.25");
    expect(css).not.toContain("font: 500 15px/1.2");
  });

  it("одна поверхность под фото — до низа экрана", () => {
    expect(contract.screen.surface).toContain("одна поверхность");
    expect(css).toMatch(/\.surface \{[\s\S]*?flex: 1 1 auto;/u);
    expect(css).toMatch(/\.column \{[\s\S]*?min-height: 100vh;/u);
  });

  it("знаки над фото: стрелка 20 и «⋯» 19, оба в целях 44", () => {
    // ОБА ЗНАКА — РИСУНКИ НАБОРА (тикет 170). Стрелка приехала файлом
    // `ui-back.svg` и рисуется `IconBack` своим числом; «⋯» рисует лист
    // действий общим `SIGN_SIZE` — своего числа у карточки на него не осталось.
    expect(card).toContain(`const BACK_SIGN = ${firstNumber(contract.head.back)}`);
    expect(card).toContain("<IconBack size={BACK_SIGN} />");
    expect(firstNumber(contract.head.more)).toBe(19);
    expect(read("../src/components/item/item-actions.tsx")).toContain(
      "export const SIGN_SIZE = 19;",
    );
    // Контракт зовёт знаки ПО ИМЕНАМ ФАЙЛОВ — оба лежат в наборе и сверены
    // путь в путь (ui-back — здесь ниже, action-more — tests/item-actions).
    expect(contract.head.back).toContain("ui-back.svg");
    expect(contract.head.more).toContain("action-more.svg");
    // Цели 44 у обоих, и они не трогались правкой знаков.
    expect(contract.head.more).toContain("44");
    expect(contract.head.back).toContain("44");
    expect(css).toMatch(/\.headSign \{[\s\S]*?width: var\(--hit-target-min, 44px\);/u);
    expect(css).toMatch(/\.headSign \{[\s\S]*?height: var\(--hit-target-min, 44px\);/u);
    // Кегль ушёл из CSS вместе с глифом: у рисунка размер задаёт проп, и два
    // места одного числа развели бы его при первой правке.
    // Правило `.headSign` целиком — `[^}]*`, а не «до первого font-size в
    // файле»: с тикета 196 в модуле есть свои `font-size` (`.nameBig`,
    // `.noteBody`), и ленивый поиск через весь файл ловил бы их.
    expect(css).not.toMatch(/\.headSign \{[^}]*font-size:/u);
  });

  it("стрелка «назад» — путь в путь с `ui-back.svg`, а не похожая", () => {
    // Та же мерка, что у всего набора (tests/tab-icons, tests/item-actions):
    // «похоже» в наборе не считается, а сдвинутый узел на 20 px не увидеть.
    const file = readFileSync(
      path.join("design", "package", "handoff", "icons", "ui-back.svg"),
      "utf8",
    );
    const shape = (svg: string) => [...svg.matchAll(/d="([^"]+)"/gu)].map((m) => m[1] as string);
    expect(shape(renderToStaticMarkup(createElement(IconBack)))).toEqual(shape(file));
    // Формат набора: сетка 24, контур 1.7; цвет у нас `currentColor` — вшитого
    // в файл #F2EDE4 быть не должно, знак горит цветом места.
    const svg = renderToStaticMarkup(createElement(IconBack));
    expect(svg).toContain('viewBox="0 0 24 24"');
    expect(svg).toContain('stroke-width="1.7"');
    expect(svg).toContain('stroke="currentColor"');
    expect(svg).not.toContain("#F2EDE4");
  });

  it("тень под знаками шапки доехала до рисунка, а не осталась у текста", () => {
    // `text-shadow` контур SVG не красит вовсе. Пока стрелка была глифом, тень
    // работала у неё одной; знаком она потеряла бы её совсем, а на карточке
    // БЕЗ фотографии (где подложки нет) тень — единственная защита знака.
    expect(css).toMatch(/\.headSign svg,\s*\n\.headActions svg \{[\s\S]*?filter: drop-shadow/u);
    // Правил с `text-shadow` не осталось. Сверяется КОД, а не комментарии: про
    // текстовую тень в файле написано много и написано правильно — это разбор,
    // а не разметка, и ловить его нельзя.
    expect(strip(css)).not.toContain("text-shadow");
    // ФИЛЬТР — НА САМОМ SVG. На обёртке он сделал бы её содержащим блоком для
    // `position: fixed`, а лист «⋯» на телефоне именно fixed.
    expect(css).not.toMatch(/\.headActions \{[^}]*filter:/u);
  });

  it("тень мала на светлой фотографии — под знаками ПОДЛОЖКА `.imm-corner-mark`", () => {
    // ЧИСЛА НЕ НАБИТЫ, А СКОПИРОВАНЫ, и проверяется именно это: приём взят
    // готовым из `globals.css` — знак сокровищницы, стоящий на кадре комнаты.
    // Случай тот же (знак на фотографии) и цели те же 44. Уедут числа в общем
    // файле — покраснеет здесь, а не на приёмке. Пакет 48 приём подтвердил
    // теми же числами и той же причиной: «принят потому, что он не новый».
    const mark = ruleBody(globalsCss, ".imm-corner-mark");
    const ground = rules(css).filter((rule) => /backdrop-filter/u.test(rule.body));
    expect(ground, "подложки под знаками нет вовсе").toHaveLength(1);
    const body = ground[0]?.body ?? "";
    expect(value(body, "background")).toBe(value(mark, "background"));
    expect(value(body, "backdrop-filter")).toBe(value(mark, "backdrop-filter"));
    // Те самые числа тикета — 44, .55, blur(8px), и они же в контракте 48.
    expect(value(mark, "background")).toBe("rgba(11, 8, 6, 0.55)");
    expect(value(mark, "backdrop-filter")).toBe("blur(8px)");
    expect(value(mark, "width")).toBe("var(--hit-target-min, 44px)");
    expect(signs.backing.fill).toBe("rgba(11,8,6,.55)");
    expect(signs.backing.blur).toBe("backdrop-filter: blur(8px)");
    expect(signs.backing.size).toBe(44);
    // Наведение — оттуда же: плашка ТЕМНЕЕТ, а не светлеет (комнаты бывают
    // светлые), и живёт это за общими воротами hover продукта.
    const markHover = ruleBody(globalsCss, ".imm-corner-mark:hover");
    const groundHover = rules(css).filter(
      (rule) => rule.selector.includes(":hover") && rule.selector.includes("headOnPhoto"),
    );
    expect(groundHover).toHaveLength(1);
    expect(value(groundHover[0]?.body ?? "", "background")).toBe(value(markHover, "background"));
    expect(css).toMatch(
      /@media \(hover: hover\) and \(pointer: fine\) \{\s*\n\s*\.headOnPhoto \.headSign:hover/u,
    );
  });

  it("ФОРМА ПОДЛОЖКИ КРУГЛАЯ — и это единственное число не из `.imm-corner-mark`", () => {
    // Условие 3 пакета 48 (тикет 221): «прямоугольная подложка в продукте
    // занята другим — ею помечены вещи и зоны». Мы взяли квадрат, скопировав
    // приём целиком, и ошиблись в другую сторону.
    expect(signs.backing.shape).toBe("круг");
    expect(condition(3).rule).toBe("форма круглая");
    const ground = rules(css).find((rule) => /backdrop-filter/u.test(rule.body));
    expect(value(ground?.body ?? "", "border-radius")).toBe("50%");

    // РАСХОЖДЕНИЕ НАЗВАНО ВСЛУХ, А НЕ ЗАМОЛЧАНО (границы тикета, письмо 53).
    // Контракт зовёт круг «родством» со знаком витрины на кадре комнаты, а
    // `.imm-corner-mark` у нас КВАДРАТ: `border-radius` в `globals.css` нет
    // вовсе. Родство сегодня работает в обратную сторону, и знак витрины мы не
    // трогаем — до ответа. Округлится он сам — покраснеет эта строка, и
    // расхождение придётся закрыть осознанно.
    expect(condition(3).why).toContain("родство со знаком витрины");
    expect(ruleBody(globalsCss, ".imm-corner-mark")).not.toContain("border-radius");
    // Разбор живёт у самого правила — иначе он потеряется первой же правкой.
    expect(css).toContain("round48/photo-signs.json");
    expect(css).toMatch(/КВАДРАТ/u);
  });

  it("ТЕНЬ СНЯТА РОВНО ТАМ, ГДЕ ПОДЛОЖКА: одна защита, не две", () => {
    // Условие 1 пакета 48: «вместе они дают серый ореол по краю круга — на
    // светлом кадре он читается как грязь». Проверяется не «тени нет в файле»,
    // а СОВПАДЕНИЕ АДРЕСОВ: где подложка — там `filter: none`, и наоборот.
    // Разъедутся селекторы — на светлом кадре вернётся ореол, и увидит это
    // только глаз.
    expect(condition(1).rule).toContain("drop-shadow(0 1px 6px rgba(11,8,6,.85)) снять");
    expect(condition(1).why).toContain("Одна защита, не две");

    const backing = rules(css).find((rule) => /backdrop-filter/u.test(rule.body));
    const off = rules(css).filter((rule) => /filter:\s*none/u.test(rule.body));
    expect(off, "тень не снята нигде или снята дважды").toHaveLength(1);
    const targets = (selector: string) => selector.split(",").map((one) => one.trim());
    expect(targets(off[0]?.selector ?? "")).toEqual(
      targets(backing?.selector ?? "").map((one) => `${one} svg`),
    );

    // Тень под знаком БЕЗ подложки жива — там она единственная защита, и
    // контракт снимает её только «там, где есть подложка».
    expect(condition(1).rule).toContain("снять");
    expect(css).toMatch(/\.headSign svg,\s*\n\.headActions svg \{[\s\S]*?filter: drop-shadow/u);
  });

  it("ТРЕТЬЕ УСЛОВИЕ БЕСПРЕДМЕТНО: шапка карточки не липкая — и записано это", () => {
    // Контракт снимает подложку, когда шапка залипает со своим фоном: «тёмный
    // круг на тёмной шапке — уже не защита, а второй прямоугольник». У нас
    // шапка `absolute` над фотографией и никуда не липнет, поэтому правило не
    // воплощается — но записано у самой подложки, чтобы нашлось, если липкость
    // однажды заведут.
    expect(condition(2).rule).toContain("при залипании шапки со своим фоном — снимается");
    expect(ruleBody(css, ".head")).toContain("position: absolute");
    expect(strip(css)).not.toContain("position: sticky");
    expect(css).toContain("Шапка");
    expect(css).toMatch(/не липкая/u);
  });

  it("подложка ОБОИМ знакам: «назад» и «⋯» читались парой и остались парой", () => {
    const ground = rules(css).find((rule) => /backdrop-filter/u.test(rule.body));
    const targets = (ground?.selector ?? "").split(",").map((one) => one.trim());
    expect(targets).toEqual([
      ".headOnPhoto .headSign",
      '.headOnPhoto .headActions button[aria-haspopup="menu"]',
    ]);
    // Знак «⋯» рисует лист действий, класса у его кнопки здесь нет — карточка
    // дотягивается до неё по роли, которую та обещает читалке. Крючок живой:
    expect(sheetSrc).toContain('aria-haspopup="menu"');
  });

  it("ЛОВУШКА 170: ни у одного предка листа нет свойства содержащего блока", () => {
    // `filter` делает элемент содержащим блоком для `position: fixed` внутри —
    // и `backdrop-filter` делает ТО ЖЕ САМОЕ (Filter Effects 2). Лист «⋯» на
    // телефоне именно fixed и центруется по экрану; повесь подложку на любую
    // обёртку — и он поедет к знаку в угол фотографии.
    const HOLDS_FIXED =
      /(?:^|[;\s])(?:backdrop-filter|filter|transform|perspective|contain|will-change):/u;
    const ANCESTORS = [".screen", ".column", ".photo", ".head", ".headActions"];
    for (const rule of rules(css)) {
      const targets = rule.selector.split(",").map((one) => one.trim());
      if (!targets.some((one) => ANCESTORS.includes(one))) continue;
      expect(rule.body, rule.selector).not.toMatch(HOLDS_FIXED);
    }
    // Подложка стоит на САМИХ знаках — последний простой селектор — знак.
    for (const rule of rules(css).filter((one) => /backdrop-filter/u.test(one.body))) {
      for (const target of rule.selector.split(",").map((one) => one.trim())) {
        expect(target, target).toMatch(/(?:\.headSign|button\[aria-haspopup="menu"\])$/u);
      }
    }
    // ПРИЧИНА ЖИВА с двух сторон. Лист на телефоне — fixed по центру экрана:
    expect(sheetCss).toMatch(
      /@media \(max-width: 639px\) \{[\s\S]*?position: fixed;[\s\S]*?transform: translateY\(-50%\);/u,
    );
    // …и он СОСЕД кнопки «⋯», а не её потомок, — иначе подложка на кнопке
    // ломала бы центровку ровно так же, как на обёртке.
    const hook = sheetSrc.indexOf('aria-haspopup="menu"');
    const closes = sheetSrc.indexOf("</button>", hook);
    expect(hook).toBeGreaterThan(-1);
    expect(closes).toBeLessThan(sheetSrc.indexOf("{open && ("));
  });

  it("БЕЗ ФОТОГРАФИИ подложки нет, А ТЕНЬ ЕСТЬ: она там единственная защита", () => {
    // Знаки на пустом месте стоят на собственной заливке .05 — подложка была
    // бы тёмным пятном на ровном фоне. Включает её карточка, и только когда
    // фотография есть.
    expect(card).toContain("className={item.photoUrl ? `${s.head} ${s.headOnPhoto}` : s.head}");
    // Ни одного правила подложки без `.headOnPhoto`: класс — единственный вход.
    for (const rule of rules(css).filter((one) => /backdrop-filter/u.test(one.body))) {
      expect(rule.selector, rule.selector).toContain(".headOnPhoto ");
    }
    // ТЕМ ЖЕ КЛАССОМ СНИМАЕТСЯ И ТЕНЬ, и это вторая половина условия 1: без
    // фотографии снимать её нечем — и незачем, подложки-то нет.
    for (const rule of rules(css).filter((one) => /filter:\s*none/u.test(one.body))) {
      expect(rule.selector, rule.selector).toContain(".headOnPhoto ");
    }
  });

  it("название 700 24/1.28 Onest, до двух строк (было 22)", () => {
    expect(reading.owner.order).toContain("название 700 24/1.28 (было 22)");
    expect(css).toContain("font: 700 24px/1.28 var(--font-ui)");
    expect(css).toMatch(/\.name \{[\s\S]*?-webkit-line-clamp: 2;/u);
  });

  it("цена 500 16 tabular-nums — И БЕЗ ОГОНЬКОВ: мета-строка снята (round49)", () => {
    // ПЕРЕВЁРНУТО (тикет 225). Огоньки стояли у цены с round39 («оба числа про
    // одно»), round45 записал это строкой порядка, а пакет 49 снял раскладку
    // целиком: «цель 44 в мета-строку не встаёт». Величина цены не менялась —
    // менялось только соседство, поэтому проверка не удалена, а разделена:
    // числа строки держатся, а сама строка теперь про одну цену.
    expect(reading.owner.order).toContain("строка: цена 500 16 · разделитель · огоньки · слово");
    expect(css).toContain("font: 500 16px/1.2 var(--font-ui)");
    expect(css).toContain("font-variant-numeric: tabular-nums");
    // Ступень .72 с тикета 174 пишется ИМЕНЕМ: значение её стоит в одном месте
    // (объявление токена), и равенство «пакет = токен» держит design-contract.
    expect(css).toMatch(/\.price \{[\s\S]*?color: var\(--color-text-body\);/u);
    // РАСХОЖДЕНИЕ С round45 НАЗВАНО ВСЛУХ: строку порядка отменил round49, и
    // отменил её словами про число, а не про вкус. Уедет он обратно —
    // покраснеет здесь.
    const v2 = JSON.parse(read("../design/package/handoff/round49/desire-scale-v2.json")) as {
      layout: { ownRow: string; why: string };
    };
    expect(v2.layout.why).toContain("«цена · огоньки · слово» из турна 54c отменяется");
    expect(v2.layout.ownRow).toContain("не в мета-строке при цене");
    // В самой строке цены не осталось ничего, кроме цены.
    const priceRow =
      /\{!item\.inHall && roomPrice !== null && \(\s*<div className=\{s\.priceRow\}>[\s\S]*?<\/div>\s*\)\}/u.exec(
        card,
      )?.[0] ?? "";
    expect(priceRow, "строка цены не найдена — раскладка уехала").toContain("s.price");
    expect(priceRow, "огоньки вернулись в строку цены").not.toContain("DesirePicker");
  });

  it("«цену видят все» — 11 при .5, и у NONE её нет вовсе", () => {
    expect(reading.owner.order).toContain("строка «цену видят все» 11/.5");
    expect(css).toMatch(/\.priceSeen \{[\s\S]*?font: 400 11px\/1\.3 var\(--font-ui\);/u);
    expect(css).toMatch(/\.priceSeen \{[\s\S]*?color: rgba\(255, 249, 242, 0\.5\);/u);
    // Строка про ГОСТЯ: у `NONE` адресата нет, и слова у дизайна тоже нет —
    // в дельте лежат ровно три ключа, ALL/FRIENDS/ME.
    expect(card).toContain('want?.priceVisibility !== "NONE"');
    for (const audience of ["ALL", "FRIENDS", "ME"] as const) {
      expect(ru.AddItem, audience).toHaveProperty(`cardPriceVis${audience}`);
    }
    expect(ru.AddItem).not.toHaveProperty("cardPriceVisNONE");
  });

  it("разделитель 1 px между «насколько нужно» и «где стоит»", () => {
    expect(reading.owner.order).toContain("разделитель 1 px");
    expect(css).toMatch(/\.divider \{[\s\S]*?height: 1px;/u);
    expect(card).toContain("<hr className={s.divider} />");
  });

  it("полка — МИНИАТЮРА КАДРА 76×48, а не строка со знаком", () => {
    expect(reading.owner.changedFrom47a).toContain("полка — миниатюра кадра вместо строки со знаком");
    expect(reading.owner.order).toContain("полка миниатюрой кадра 76×48 + «Полка целиком»");
    expect(thumb).toContain("export const SHELF_THUMB = { w: 76, h: 48 } as const;");
    expect(css).toMatch(/\.shelfFrame \{[\s\S]*?width: 76px;/u);
    expect(css).toMatch(/\.shelfFrame \{[\s\S]*?height: 48px;/u);
    // Знака зоны на этом месте больше нет — его заменил кадр.
    expect(card).not.toContain("ZONE_SIGN");
    expect(css).not.toContain(".zoneSign");
    // Цель добирается до 44, как у любой строки продукта.
    expect(css).toMatch(/\.shelfRow \{[\s\S]*?min-height: var\(--hit-target-min, 44px\);/u);
    // КООРДИНАТЫ ТОЛЬКО ИЗ rooms.json, в системе кадра 630×351 (ADR-0006):
    // своей карты у карточки нет и появиться не может.
    expect(thumb).toContain("export const FRAME = { w: 630, h: 351 } as const;");
    expect(thumb).not.toMatch(/\b(?:1120|430)\b/u);
    expect(page).toContain("zoneRect={preset.zones.find(");
  });

  it("заметка — СВОИМ БЛОКОМ С НАДСТРОЧНОЙ, 400 13.5/1.55", () => {
    expect(reading.owner.changedFrom47a).toContain("заметка — блок с надстрочной вместо абзаца");
    expect(css).toContain("font: 400 13.5px/1.55 var(--font-ui)");
    expect(css).toMatch(/\.note \{[\s\S]*?-webkit-line-clamp: 4;/u);
    expect(card).toContain('<span className={s.noteOverline}>{tField("cardNoteOverline")}</span>');
    expect(ru.AddItem.cardNoteOverline).toBe("Заметка");
  });

  it("«Где купить» — СТРОКОЙ с числом магазинов и «от {price}», раскрывается", () => {
    expect(reading.owner.changedFrom47a).toContain(
      "«Где купить» — число магазинов и «от {price}» вместо одного домена",
    );
    // Довод пакета взят целиком: 200 px ответа на вопрос, которого у хозяйки
    // нет — ссылки положила она сама.
    expect(reading.owner.storesCollapsed).toContain("200 px ответа на вопрос");
    expect(reading.owner.storesCollapsed).toContain("Раскрывается нажатием");
    expect(card).toContain('tField("cardStores", { count: storeCount })');
    expect(card).toContain('tField("cardStoresFrom", { price: roomPrice })');
    expect(card).toContain("aria-expanded={storesOpen}");
    // Внутри раскрытого — блок 8b БЕЗ ИЗМЕНЕНИЙ, тот же якорь продукта.
    expect(shopCss).toMatch(/\.card \{[\s\S]*?font: 500 13px\/1\.2 var\(--font-ui\);/u);
    expect(shopCss).toMatch(/\.card \.go \{[\s\S]*?font-size: 14px;/u);
    expect(card).toContain('place="card"');
    // Якорь один на весь продукт — своего карточка не заводит (тикет 37).
    expect(card).not.toMatch(/<a[\s>]/u);
  });

  it("«Стоит в комнате с 3 августа» — 11 при .48, последней строкой", () => {
    expect(reading.owner.order.at(-1)).toContain("«Стоит в комнате с 3 августа» 11/.48");
    expect(css).toMatch(/\.since \{[\s\S]*?font: 400 11px\/1\.3 var\(--font-ui\);/u);
    expect(css).toMatch(/\.since \{[\s\S]*?color: rgba\(255, 249, 242, 0\.48\);/u);
    expect(card).toContain('tField("cardAddedOn"');
  });

  it("порядок блоков — ровно `owner.order` контракта", () => {
    const at = (needle: string) => {
      const index = card.indexOf(needle);
      expect(index, needle).toBeGreaterThan(-1);
      return index;
    };
    const order = [
      at("<div\n          className={["), // фотография
      at("<h1 className={"), // название 24
      at("<div className={s.priceRow}>"), // цена одна (огоньки ушли, round49)
      at("<p className={s.priceSeen}>"), // «цену видят все»
      at("<DesirePicker"), // ШКАЛА СВОЕЙ СТРОКОЙ — пакет 49
      at("<hr className={s.divider} />"), // разделитель 1 px
      at("className={`pressable ${s.shelfRow}`}"), // полка миниатюрой кадра
      at("<div className={s.noteBlock}>"), // заметка блоком
      at("className={`pressable ${s.storesRow}`}"), // «Где купить» строкой
      at("className={`pressable ${s.mainAction}`}"), // «Изменить» полосой света
      at("<p className={s.since}>"), // «Стоит в комнате с»
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // СЧЁТ БЛОКОВ СОШЁЛСЯ, но арифметика у него теперь на два слагаемых
    // (тикет 225): у round45 одиннадцать строк, из них одна — надстрочная
    // бренда, которой у нас нет и взять неоткуда (раздел «чего не взяли»
    // ниже), а строка «цена · огоньки · слово» разошлась у нас на ДВЕ: пакет
    // 49 вывел шкалу своей строкой.
    const BRAND_OVERLINE = 1; // есть у контракта, нет у нас
    const SCALE_SPLIT = 1; // одна строка контракта — два блока у нас
    expect(reading.owner.order).toHaveLength(order.length - SCALE_SPLIT + BRAND_OVERLINE);
  });

  it("главное действие: «Изменить» полосой света, цель — вся строка от 44", () => {
    expect(contract.mainAction.label).toBe(ru.Settings.itemEdit);
    expect(card).toContain('t("itemEdit")');
    // Полоса света — рецепт tokens.json → button.primary: граница 2 px
    // акцентом, ореол, ЗАЛИВКИ НЕТ. Свой вид не изобретается (турн 22).
    expect(contract.mainAction.form).toContain("2 px");
    expect(contract.mainAction.form).toContain("без заливки");
    expect(css).toMatch(/\.mainAction \{[\s\S]*?border-bottom: 2px solid var\(--card-accent\);/u);
    expect(css).toMatch(/\.mainAction \{[\s\S]*?background: none;/u);
    expect(css).toMatch(/\.mainAction \{[\s\S]*?box-shadow: 0 4px 18px -3px var\(--card-glow-42\);/u);
    // «вся строка, минимум 44».
    expect(contract.mainAction.hit).toContain("44");
    expect(css).toMatch(/\.mainAction \{[\s\S]*?width: 100%;/u);
    expect(css).toMatch(/\.mainAction \{[\s\S]*?min-height: var\(--hit-target-min, 44px\);/u);
  });

  it("экран открывается ПОКАЗОМ, а не формой", () => {
    // Прежняя редакция открывалась в правке — вещь нельзя было посмотреть.
    expect(card).toContain("const [editing, setEditing] = useState(false);");
    expect(card).toContain("{editing && (");
  });
});

describe("лист «⋯»: состав по контракту, знаки round36", () => {
  it("в комнате — В сокровищницу · Перенести в зону · Спрятать · Удалить", () => {
    expect(sheetKeys(card)).toEqual(["return", "hide", "delete", "treasury", "move"]);
    // Порядок внутри ветки комнаты: она идёт второй в тернаре.
    const room = card.slice(card.indexOf('key: "treasury"'));
    expect(sheetKeys(room)).toEqual(["treasury", "move", "hide", "delete"]);
  });

  it("в сокровищнице — Вернуть в комнату · Скрыть от гостей · Удалить насовсем", () => {
    // ПОРЯДОК И СЛОВА — ИЗ КОНТРАКТА (тикет 179). Перечень строк листа витрины
    // выпал из round41 (абзац про адресата цены поглотил список) и вернулся
    // round42; до его возвращения этот порядок стоял здесь числом руками.
    const KEY_OF: Record<string, string> = {
      "Hall.remove": "return",
      "Hall.hideFromGuests": "hide",
      "Hall.delete": "delete",
    };
    const hall = card.slice(card.indexOf('key: "return"'), card.indexOf('key: "treasury"'));
    expect(sheetKeys(hall)).toEqual(
      contract.treasuryVariantSheet.rows.map((row) => KEY_OF[row.string]),
    );
    expect(sheetKeys(hall)).toEqual(["return", "hide", "delete"]);
    expect(hall).toContain('title: tHall("remove")');
    expect(hall).toContain("toggleHallAction(item.id, false)");
    // «Удалить насовсем» — СЛОВО СОКРОВИЩНИЦЫ, а не «Удалить» из ns Settings
    // (тикет 179). В комнате вещь ещё чужая мечта, в витрине она уже своя, и
    // «насовсем» здесь факт; тем же словом эта строка подписана на экране
    // витрины — одно действие не может зваться на двух экранах по-разному.
    expect(hall).toContain('title: tHall("delete")');
    expect(hall).toContain('hint: tHall("deleteHint")');
    expect(ru.Hall.delete).toBe("Удалить насовсем");
    expect(ru.Hall.delete).toBe(
      contract.treasuryVariantSheet.rows.find((row) => row.string === "Hall.delete")?.label,
    );
    // ВОПРОС — РОВНО У ОДНОЙ СТРОКИ, и контракт называет её поимённо:
    // «единственное действие с вопросом». Две другие обратимы, и лишний вопрос
    // стоил бы им дороги назад. Тот же счёт держит экран витрины
    // (tests/item-actions) — лист один, и вопрос в нём один на обоих.
    expect(
      contract.treasuryVariantSheet.rows.filter((row) => row.note?.includes("вопрос")),
    ).toHaveLength(1);
    expect([...hall.matchAll(/setConfirming\(/gu)]).toHaveLength(1);
    expect([...hall.matchAll(/danger: true/gu)]).toHaveLength(1);
    expect(hall).toContain('onSelect: () => setConfirming("delete")');
    const reversible = hall.slice(0, hall.indexOf('key: "delete"'));
    expect(reversible).toContain("toggleHallAction(item.id, false)");
    expect(reversible).toContain("setHallHiddenAction(item.id, !hall?.hiddenFromObservers)");
    expect(reversible).not.toContain("setConfirming");
  });

  it("главное действие витрины в лист НЕ дублируется", () => {
    // Контракт → `treasuryVariantSheet.mainAction`: «Записать заметку» — полоса
    // света, и знака заметки в листе нет. Дизайн отдельно отказался возвращать
    // `action-note.svg` в ряд листа: он повторял бы главное действие в двух
    // шагах от него.
    expect(contract.treasuryVariantSheet.mainAction).toContain("Записать заметку");
    expect(contract.treasuryVariantSheet.mainAction).toContain("полоса света");
    expect(contract.treasuryVariantSheet.rows.map((row) => row.icon)).not.toContain(
      "action-note.svg",
    );
    // У карточки перо не рисуется вовсе: главное действие здесь — строка
    // «полосой света» со словом, а знак заметки живёт на плитке витрины.
    expect(card).not.toContain("IconActionNote");
    expect(card).toContain('? tHall("noteAdd")');
  });

  it("знаки — те самые из набора round36, а не нарисованные заново", () => {
    // Контракт зовёт знаки по именам файлов; у нас на каждый есть компонент,
    // сверенный путь в путь в `tests/item-actions.test.ts`.
    //
    // СПИСОК ЗАКРЫТ ЦЕЛИКОМ (тикет 170). Прежде здесь была ветка «знака нет —
    // проверь, не `action-gallery` ли это»: строку «Кадры вещи» контракт
    // называл, а мы её не рисовали. Раунд 41 строку СНЯЛ, и ветка убрана —
    // теперь любой незнакомый знак контракта красный сразу, без исключения,
    // которое однажды прикрыло бы собой второй такой случай.
    const OURS: Record<string, string> = {
      "action-treasury.svg": "IconActionTreasury",
      "action-move.svg": "IconMove",
      "action-hide.svg": "IconEyeOff",
      "action-delete.svg": "IconActionDelete",
    };
    for (const row of contract.sheet.rows) {
      const ours = OURS[row.icon];
      expect(ours, `${row.label}: новый знак контракта (${row.icon}) — у нас его нет`).toBeDefined();
      expect(card, row.label).toContain(`<${ours} size={SIGN_SIZE} />`);
    }
    // Размер знака берётся у листа, а не подбирается тут заново.
    expect(card).toContain('import { ItemActions, SIGN_SIZE, type ItemActionRow }');
  });

  it("слова строк — из словаря, а не написанные в разметке", () => {
    expect(card).toContain('title: t("itemHallAdd")');
    expect(card).toContain('title: t("itemMove")');
    expect(card).toContain('title: item.hidden ? t("itemShow") : t("itemHide")');
    expect(card).toContain('title: t("itemDelete")');
    for (const key of ["itemMove", "itemMoveHint", "itemHallAddNo"] as const) {
      expect(ru.Settings, key).toHaveProperty(key);
      expect(en.Settings, key).toHaveProperty(key);
    }
  });

  it("«Удалить» ходит только через сервис deleteItem и спрашивает", () => {
    expect(card).toContain("deleteItemAction(item.id)");
    expect(card).toContain("danger: true");
    expect(card).toContain('onSelect: () => setConfirming("delete")');
  });
});

describe("вариант сокровищницы (contract → treasuryVariant)", () => {
  it("шкалы желания нет: желание исполнено", () => {
    // Round41 сказал это адреснее прежнего: «Шкалы нет НИ У КОГО» — то есть и
    // хозяйке тоже, в отличие от цены, у которой адресат появился разный.
    expect(contract.treasuryVariant).toContain("Шкалы нет ни у кого");
    // Шкала рисуется только у вещи КОМНАТЫ — тем же условием, что и цена, хотя
    // строки у них с пакета 49 разные (тикет 225): условие одно на оба блока.
    expect(card).toMatch(/\{!item\.inHall && roomPrice !== null && \(\s*<div className=\{s\.priceRow\}>/u);
    expect(card).toMatch(/\{!item\.inHall && \(\s*<DesirePicker/u);
  });

  it("подпись под названием — «Подарок {год} года · от {кто}», из словаря", () => {
    expect(contract.treasuryVariant).toContain("Подарок 2026 года · от Кати");
    expect(ru.Hall.captionYearGiver).toBe("Подарок {year} года · от {giver}");
    expect(card).toContain('tHall("captionYearGiver", { year: sinceYear, giver: love.giverName })');
    // Имени нет — остаётся год: «Подарок 2026 года».
    expect(card).toContain('tHall("captionYear", { year: sinceYear })');
  });

  it("главное действие — «Записать заметку»", () => {
    expect(contract.treasuryVariant).toContain("Записать заметку");
    expect(reading.cases.treasury.mainAction).toContain("Записать заметку");
    expect(ru.Hall.noteAdd).toBe("Записать заметку");
    // Развилка теперь ТРОЙНАЯ (round45 → cases.noPhoto.ownerAction): у вещи
    // комнаты БЕЗ фотографии полосу света занимает «Добавить фотографию» —
    // «единственный случай, когда „Изменить" уступает главное действие».
    // Витрины это не касается: её полоса — «Записать заметку» (round41).
    expect(card).toContain("const needsPhoto = !item.inHall && !item.photoUrl;");
    expect(card).toMatch(
      /const mainActionLabel = needsPhoto\s*\n\s*\? tField\("cardAddPhoto"\)\s*\n\s*: item\.inHall\s*\n\s*\? tHall\("noteAdd"\)\s*\n\s*: t\("itemEdit"\);/u,
    );
  });

  it("«Добавить фотографию» ведёт туда, где фотография правда появляется", () => {
    // Полоса света, ведущая в форму без поля фотографии, была бы враньём
    // громче, чем её отсутствие. Дорога та же, что в карточке добавления:
    // presign → PUT браузером → экшен получает только ключ.
    expect(reading.cases.noPhoto.ownerAction).toContain("Добавить фотографию");
    expect(card).toContain("presignItemPhotoAction({ contentType: file.type, size: file.size })");
    expect(card).toContain("setItemPhotoAction(item.id, presigned.key)");
    // Сервис проверяет ключ тем же разбором и ту же принадлежность комнате.
    const service = read("../src/server/services/items.ts");
    expect(service).toContain("export async function setItemPhoto(");
    expect(service).toContain("const key = photoKeySchema.parse(photoKey);");
    expect(service).toContain("!key.startsWith(`items/${item.roomId}/`)");
    // И `updateItem` фотографии по-прежнему НЕ пишет: правка степени желания
    // ходит тем же `buildInput`, и лишний ключ трогал бы ещё и фотографию
    // (та же болезнь, что поймана в тикете 97 с полями впечатления).
    const update = /export async function updateItem\([\s\S]*?\n\}/u.exec(service)?.[0] ?? "";
    expect(update).not.toContain("photoKey");
  });

  it("гостю на месте пустой фотографии не предлагается НИЧЕГО", () => {
    // Contract → cases.noPhoto.guestAction: «ничего: у гостя бирка,
    // фотографии он не добавляет».
    expect(reading.cases.noPhoto.guestAction).toContain("ничего");
    expect(read("../src/app/r/[slug]/i/[id]/guest-item-view.tsx")).not.toContain("cardAddPhoto");
  });

  it("У ЦЕНЫ В ВИТРИНЕ ПОЯВИЛСЯ АДРЕСАТ — контракт догнал инвариант №8", () => {
    // ПЕРЕВЁРНУТО (тикет 170). Round39 писал у витрины просто «цены нет», и мы
    // держали цену вопреки строке контракта: его правило про ГОСТЯ (для гостя
    // оно выполнено жёстче некуда — ключей price/currency нет в гостевом DTO
    // вовсе), а инвариант №8 второй половиной говорит «хозяйке её собственные
    // цены видны ВСЕГДА, включая её собственную витрину».
    //
    // Раунд 41 признал формулировку своей ошибкой дословно: «без адресата…
    // однажды по ней спрятали бы цену и от хозяйки». Расхождения больше нет —
    // есть совпадение, и оно под тестом с обеих сторон.
    expect(contract.treasuryVariant).toContain("ГОСТЮ цена не показывается");
    expect(contract.treasuryVariant).toContain("ХОЗЯЙКЕ её собственные цены видны всегда");
    expect(card).toContain("hall?.price != null");
    expect(card).toContain("<PriceSeenBadge audience={hall.priceAudience} />");
  });
});

describe("чего мы из контракта НЕ взяли — ПЯТЬ ПРИЧИН ОТПАЛИ (round41)", () => {
  // ЗАЧЕМ РАЗДЕЛ ОСТАЛСЯ, ЕСЛИ РАСХОЖДЕНИЙ НЕТ. Каждое из пяти мест — то, где
  // контракт и код УЖЕ РАЗОШЛИСЬ ОДНАЖДЫ. Такие места и расходятся повторно:
  // пришлёт дизайн следующий раунд с прежними числами — мы должны узнать об
  // этом здесь, а не на приёмке. Поэтому проверки не удалены, а перевёрнуты:
  // вчера они держали НАШУ причину не брать, сегодня — СОВПАДЕНИЕ сторон.
  //
  // Отдельно проверяется, что закрытие названо самим дизайном: у контракта
  // есть блок `changedFrom` со списком правок, и мы сверяем его с базой,
  // от которой считали (round39). Молчаливая правка чужого файла — такая же
  // болезнь, как молчаливое расхождение нашего кода.

  it("НАДСТРОЧНОЙ БРЕНДА НЕТ — И ВЗЯТЬ ЕЁ НЕОТКУДА (round45, новое)", () => {
    // Единственное расхождение с контрактом round45, и оно не про вкус: обе
    // половины экрана просят «надстрочную бренда 9/.18em», а у вещи ПОЛЯ
    // БРЕНДА НЕТ — ни в модели, ни в парсере, ни в форме добавления. Марка
    // живёт у каталожного товара (`CatalogProduct.brand`), а каталог — за
    // флагом `CATALOG_ENABLED` и до карточки не доезжает.
    //
    // Рисовать надстрочную из домена магазина («GOLDAPPLE.RU») мы не станем:
    // это не марка вещи, а место покупки, и оно уже сказано в «Где купить».
    // Появится поле у вещи — покраснеет здесь, и строку надо будет вернуть
    // первой в обоих порядках. Дизайну сказано письмом 49.
    expect(reading.owner.order[1]).toContain("надстрочная бренда");
    expect(reading.guest.order[1]).toContain("надстрочная бренда");
    const schema = read("../prisma/schema.prisma");
    const model = /model Item \{[\s\S]*?\n\}/u.exec(schema)?.[0] ?? "";
    expect(model).not.toMatch(/\bbrand\b/u);
    // Марка есть у КАТАЛОЖНОГО товара — и это другая сущность, за флагом.
    expect(schema).toMatch(/model CatalogProduct \{[\s\S]*?\n {2}brand/u);
    expect(card).not.toContain("brand");
    expect(read("../src/app/r/[slug]/i/[id]/guest-item-view.tsx")).not.toContain("brand");
  });

  it("дизайн назвал базу и список правок — считаем от того же места", () => {
    expect(contract.changedFrom.baseline).toContain("round39");
    expect(contract.changedFrom.changed.length).toBeGreaterThanOrEqual(6);
  });

  it("СЕДЬМАЯ ПРАВКА ОБЪЯВЛЕНА: `head.more` стоит в списке, а не только в файле", () => {
    // Правку мы нашли сами сверкой файла с предыдущим (тикет 170): «⋯ 20»
    // глифом стало `action-more.svg` 19, а в `changedFrom` её не было — список
    // собирался пересказом письма. Раунд 42 объявил её задним числом и назвал
    // правило себе: список собирается сверкой файлов. Перенесено сюда точечно.
    // Молчаливая правка чужого файла — та же болезнь, что молчаливое
    // расхождение нашего кода, и ловится она только полным списком.
    const more = contract.changedFrom.changed.filter((line) => line.startsWith("head.more"));
    expect(more).toHaveLength(1);
    expect(more[0]).toContain("action-more.svg");
    expect(more[0]).toContain("19");
  });

  it("1. «Кадры вещи» СНЯТЫ дизайном — галереи в продукте нет", () => {
    const schema = read("../prisma/schema.prisma");
    const model = /model Item \{[\s\S]*?\n\}/u.exec(schema)?.[0] ?? "";
    // У вещи ОДНА фотография — одна колонка и ни одного отношения к кадрам.
    expect(model).toContain("photoKey");
    expect(model).not.toMatch(/photos|ItemPhoto|gallery/iu);
    // Знак галереи в ЛИСТЕ ДЕЙСТВИЙ — вот чего быть не должно: строка «Кадры
    // вещи» снята дизайном. Сам компонент знака с тикета 196 в карточке есть —
    // им подписан выбор ОДНОЙ фотографии в форме правки, тот же знак и то же
    // слово, что в карточке добавления. Это не галерея: фотография у вещи
    // по-прежнему одна, и модель это держит строкой выше.
    expect(sheetSource(card)).not.toContain("IconGallery");
    expect(card).not.toMatch(/rows=\{[\s\S]{0,200}gallery/iu);
    // Строки в контракте больше нет, и снятие объяснено отдельным ключом:
    // «одна фотография это не бедность, а решение».
    expect(contract.sheet.rows.map((row) => row.label)).not.toContain("Кадры вещи");
    expect(contract.sheet.galleryDropped).toContain("СНЯТА");
    // Появится галерея у НАС — покраснеет здесь, и строку надо будет вернуть
    // вместе с ответом дизайна («вернёмся, если попросит хозяйка»).
    expect(read("../src/components/icons.tsx")).toContain("export function IconGallery");
  });

  it("2. ВВОД подтверждён, а числа 6/5 сам же дизайн и снял (round49)", () => {
    // Было: round39 просил 5 px с шагом 4, а это числа СТРОКИ ЗОНЫ (наш
    // контракт 36d, тикет 125). Стало: «числа 5/4 из нашего файла были числами
    // СТРОКИ ЗОНЫ, вы поймали верно» — и ввод тапом подтверждён отдельно.
    //
    // ДОПИСАНО ТИКЕТОМ 225. Половина про ввод жива и сегодня, а половина про
    // числа кончилась: пакет 49 снял и 6/5, и 5/4 — «одно число на карточку»,
    // точка 14 на цели 44 с шагом 10 (`desire-picker.module.css`, свои тесты).
    expect(contract.body.wish).toContain("6 px с шагом 5");
    expect(contract.body.wish).toContain("ВВОД, а не показ");
    const v2 = JSON.parse(read("../design/package/handoff/round49/desire-scale-v2.json")) as {
      withdrawn: Record<string, string>;
    };
    expect(Object.keys(v2.withdrawn)).toContain("6/5");
    // 6 px ОСТАЛИСЬ У ПОКАЗА — гостевой шкалы контракт 49 не касается вовсе
    // (открытый хвост тикета 225). Здесь это записано затем, чтобы «прибраться
    // заодно» в чужой половине никто не пришёл молча.
    const scaleCss = read("../src/components/item/desire-scale.module.css");
    expect(scaleCss).toMatch(/\.flame \{[\s\S]*?width: 6px;/u);
    expect(read("../src/app/r/[slug]/i/[id]/guest-item-view.tsx")).toContain("<DesireScale");
    // В карточке стоит ввод, а не показ, — второго места ввода на экране нет.
    expect(card).toContain("<DesirePicker");
    expect(card).not.toContain("DesireScale");
    // «Не задана — шкала не рисуется»: пустое не равно нулевому.
    expect(contract.body.wish).toContain("не рисуется");
  });

  it("3. лист 52 и подпись 500/13.5 — дизайн свёл два своих числа к одному", () => {
    // Было: round39 писал строки 56 и подпись 600/14, ссылаясь при этом на
    // знаки round36, где строка 52 и титул 500/13.5. Стало: «два числа одного
    // листа в двух наших файлах, вы взяли верное».
    expect(contract.sheet.form).toContain("строки 52");
    expect(contract.sheet.form).toContain("подпись 500 13.5");
    expect(contract.sheet.form).toContain("знак 19 в цели 44");
    expect(sheetCss).toContain("min-height: 52px");
    expect(sheetCss).toContain("font: 500 13.5px/1 var(--font-ui)");
    // Лист рисует свой модуль — второй его копии карточка не заводит.
    expect(css).not.toContain("56px");
  });

  it("4. стрелка «назад» — знак приехал, и текст глифом ушёл", () => {
    // Было: контракт звал знак, которого в наборе не лежало; по правилу тикета
    // 150 мы сказали письмом и оставили «←» текстом. Стало: `ui-back.svg` в
    // пакете, и дизайн назвал нашу же причину — глифов в интерфейсе не бывает.
    const icons = read("../src/components/icons.tsx");
    expect(icons).toContain("export function IconBack");
    expect(contract.head.back).toContain("ui-back.svg");
    expect(contract.head.back).toContain("глифов в интерфейсе не бывает");
    expect(card).toContain("<IconBack size={BACK_SIGN} />");
    // Глифа в шапке не осталось ни одного — ни стрелки, ни «⋯» текстом.
    expect(strip(card)).not.toMatch(/[←⋯]/u);
  });

  it("5. «открыто» объяснено: это ЗНАЧЕНИЕ цены, а не замена пустой", () => {
    // Было: «"открыто" вместо суммы, если цены нет» — чем слово отвечает на
    // отсутствие цены, контракт не объяснял, и мы вели себя как в сокровищнице
    // (тикет 35): сказать нечего — строки нет. Стало: «два разных случая
    // слиплись в одну фразу, извините», и наше правило принято дословно.
    expect(contract.body.price).toContain("НЕТ ЦЕНЫ — НЕТ СТРОКИ (ваше правило, принимаем)");
    expect(contract.body.price).toContain("ЗНАЧЕНИЕ цены у денежной вещи");
    // «НЕТ ЦЕНЫ — НЕТ СТРОКИ» стало буквальным с тикета 225: прежде без цены
    // оставался пустой блок строки — в нём стояли огоньки, — и место под неё
    // всё равно занималось. Огоньки ушли своей строкой, и условие поднялось на
    // весь блок: цены нет — строки нет вовсе.
    expect(card).toMatch(
      /\{!item\.inHall && roomPrice !== null && \(\s*<div className=\{s\.priceRow\}>\s*<span className=\{s\.price\}>\{roomPrice\}<\/span>\s*<\/div>\s*\)\}/u,
    );
    // Слова «открыто» в продукте по-прежнему нет: денежная вещь — это зона
    // `money` с копилкой (инвариант №9), а не строка цены в карточке.
    expect(ru.Settings).not.toHaveProperty("itemPriceOpen");
  });
});
