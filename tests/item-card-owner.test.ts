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
const shopCss = read("../src/components/zone/shop-link.module.css");
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

/** Первое число контрактной строки — «знак зоны 16 при .55», «⋯ 20 в цели 44». */
const firstNumber = (text: string): number => Number(/(\d+(?:\.\d+)?)/u.exec(text)?.[1]);

/**
 * Размер знака пула на пустом фото. Своим разбором, а не `firstNumber`:
 * строка контракта начинается с цвета заливки («rgba(255,255,255,.05)»), и
 * первое число в ней — 255, а не размер знака.
 */
const poolSignSize = (text: string): number => Number(/знак пула (\d+)/u.exec(text)?.[1]);

/**
 * Исходник без комментариев. Про бронь в комментариях написано много и
 * написано правильно — это объяснение, а не разметка, и ловить его нельзя.
 */
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");

/**
 * Ключи строк листа в порядке появления, без повторов, — та же мерка, что в
 * `tests/item-actions.test.ts`: состав листа обязан падать при первой же
 * лишней или потерянной строке.
 */
function sheetKeys(source: string): string[] {
  const keys = [...source.matchAll(/key:\s*"([a-z]+)"/gu)].map((match) => match[1] as string);
  return [...new Set(keys)];
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
    // ПОКАЗ ни разу не спрашивает про видимость. Проверяется именно показ —
    // всё до формы правки: в самой форме `priceVisibility` законно живёт
    // переключателем «кто видит цену», и это про гостя.
    const view = card.slice(card.indexOf("<main className={s.screen}"), card.indexOf("{editing && ("));
    expect(view).not.toContain("priceVisibility");
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

describe("числа контракта round39 — из контракта, а не набитые", () => {
  it("фото: высота, cover и заливка с знаком пула на пустом", () => {
    expect(css).toContain(`height: ${contract.screen.photo.h}px`);
    expect(contract.screen.photo.fit).toBe("cover");
    expect(css).toContain("background-size: cover");
    // Пустое: заливка .05 и знак 34 при .35.
    expect(contract.screen.photo.empty).toContain("rgba(255,255,255,.05)");
    expect(css).toContain("background-color: rgba(255, 255, 255, 0.05)");
    expect(card).toContain(`const EMPTY_PHOTO_SIGN = ${poolSignSize(contract.screen.photo.empty)}`);
    expect(css).toContain("color: rgba(255, 249, 242, 0.35)");
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
    expect(css).not.toMatch(/\.headSign \{[\s\S]*?font-size:/u);
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
    // работала у неё одной; знаком она потеряла бы её совсем, а на светлых
    // комнатах знак .92 по мрамору без тени не читается.
    expect(css).toMatch(/\.headSign svg,\s*\n\.headActions svg \{[\s\S]*?filter: drop-shadow/u);
    // Правил с `text-shadow` не осталось. Сверяется КОД, а не комментарии: про
    // текстовую тень в файле написано много и написано правильно — это разбор,
    // а не разметка, и ловить его нельзя.
    expect(strip(css)).not.toContain("text-shadow");
    // ФИЛЬТР — НА САМОМ SVG. На обёртке он сделал бы её содержащим блоком для
    // `position: fixed`, а лист «⋯» на телефоне именно fixed.
    expect(css).not.toMatch(/\.headActions \{[^}]*filter:/u);
  });

  it("название 700 22/1.25 Onest, до двух строк", () => {
    expect(contract.body.name).toContain("700 22/1.25");
    expect(css).toContain("font: 700 22px/1.25 var(--font-ui)");
    expect(css).toMatch(/\.name \{[\s\S]*?-webkit-line-clamp: 2;/u);
  });

  it("цена 500 15 при .72, tabular-nums", () => {
    expect(contract.body.price).toContain("500 15");
    expect(contract.body.price).toContain("tabular-nums");
    expect(css).toContain("font: 500 15px/1.2 var(--font-ui)");
    expect(css).toContain("font-variant-numeric: tabular-nums");
    // Ступень .72 с тикета 174 пишется ИМЕНЕМ: значение её стоит в одном месте
    // (объявление токена), и равенство «пакет = токен» держит design-contract.
    expect(css).toMatch(/\.price \{[\s\S]*?color: var\(--color-text-body\);/u);
  });

  it("полка — строка-ссылка: знак 16 при .55, подпись 13 при .72", () => {
    expect(card).toContain(`const ZONE_SIGN = ${firstNumber(contract.body.zone)}`);
    expect(css).toMatch(/\.zoneSign \{[\s\S]*?color: rgba\(255, 249, 242, 0\.55\);/u);
    expect(css).toMatch(/\.zoneLabel \{[\s\S]*?font: 400 13px\/1\.2 var\(--font-ui\);/u);
    expect(css).toMatch(/\.zoneLabel \{[\s\S]*?color: var\(--color-text-body\);/u);
    // «тап ведёт в зону» — и цель добирается до 44, как у любой строки.
    expect(contract.body.zone).toContain("тап ведёт в зону");
    expect(css).toMatch(/\.zoneRow \{[\s\S]*?min-height: var\(--hit-target-min, 44px\);/u);
  });

  it("заметка 400 13.5/1.55 при .72, до четырёх строк", () => {
    expect(contract.body.note).toContain("400 13.5/1.55");
    expect(css).toContain("font: 400 13.5px/1.55 var(--font-ui)");
    expect(css).toMatch(/\.note \{[\s\S]*?-webkit-line-clamp: 4;/u);
  });

  it("«где купить» — домен 13 при .72 со стрелкой 14, ведёт наружу", () => {
    expect(contract.body.link).toContain("13");
    expect(shopCss).toMatch(/\.card \{[\s\S]*?font: 500 13px\/1\.2 var\(--font-ui\);/u);
    expect(shopCss).toMatch(/\.card \{[\s\S]*?color: var\(--color-text-body\);/u);
    expect(shopCss).toMatch(/\.card \.go \{[\s\S]*?font-size: 14px;/u);
    expect(card).toContain('place="card"');
    // Якорь один на весь продукт — своего карточка не заводит (тикет 37).
    expect(card).not.toMatch(/<a[\s>]/u);
  });

  it("порядок тела: название → цена и огоньки → полка → заметка → где купить", () => {
    expect(contract.body.order).toBe("название → цена и огоньки → полка → заметка → где купить");
    const at = (needle: string) => {
      const index = card.indexOf(needle);
      expect(index, needle).toBeGreaterThan(-1);
      return index;
    };
    const order = [
      at("<h1 className={s.name}>"),
      at("<div className={s.priceRow}>"),
      at("className={`pressable ${s.zoneRow}`}"),
      at("<p className={s.note}>{item.note}</p>"),
      at("<ShopLink"),
    ];
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Огоньки стоят У ЦЕНЫ — в той же строке, а не отдельным блоком.
    expect(card).toMatch(/<div className=\{s\.priceRow\}>[\s\S]{0,400}?<DesirePicker/u);
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
    expect(card).toContain('item.inHall ? tHall("noteAdd") : t("itemEdit")');
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
    // Шкала рисуется только у вещи КОМНАТЫ — тем же условием, что и цена.
    expect(card).toMatch(/\{!item\.inHall && \(\s*<div className=\{s\.priceRow\}>/u);
    expect(card).toContain("<DesirePicker");
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
    expect(ru.Hall.noteAdd).toBe("Записать заметку");
    expect(card).toContain('item.inHall ? tHall("noteAdd") : t("itemEdit")');
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
    expect(card).not.toContain("IconGallery");
    // Строки в контракте больше нет, и снятие объяснено отдельным ключом:
    // «одна фотография это не бедность, а решение».
    expect(contract.sheet.rows.map((row) => row.label)).not.toContain("Кадры вещи");
    expect(contract.sheet.galleryDropped).toContain("СНЯТА");
    // Появится галерея у НАС — покраснеет здесь, и строку надо будет вернуть
    // вместе с ответом дизайна («вернёмся, если попросит хозяйка»).
    expect(read("../src/components/icons.tsx")).toContain("export function IconGallery");
  });

  it("2. огоньки 6/5 и ВВОД — дизайн подтвердил наши числа", () => {
    // Было: round39 просил 5 px с шагом 4, а это числа СТРОКИ ЗОНЫ (наш
    // контракт 36d, тикет 125). Стало: «числа 5/4 из нашего файла были числами
    // СТРОКИ ЗОНЫ, вы поймали верно» — и ввод тапом подтверждён отдельно.
    expect(contract.body.wish).toContain("6 px с шагом 5");
    expect(contract.body.wish).toContain("ВВОД, а не показ");
    const scaleCss = read("../src/components/item/desire-scale.module.css");
    expect(scaleCss).toMatch(/\.flame \{[\s\S]*?width: 6px;/u);
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
    const sheetCss = read("../src/components/item/item-actions.module.css");
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
    expect(card).toContain("{roomPrice !== null && <span className={s.price}>{roomPrice}</span>}");
    // Слова «открыто» в продукте по-прежнему нет: денежная вещь — это зона
    // `money` с копилкой (инвариант №9), а не строка цены в карточке.
    expect(ru.Settings).not.toHaveProperty("itemPriceOpen");
  });
});
