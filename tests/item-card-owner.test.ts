// Карточка вещи глазами хозяйки, редакция v2 (тикет 159, доска 47a).
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
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import ru from "../messages/ru.json";
import en from "../messages/en.json";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const card = read("../src/app/room/zone/[zone]/i/[id]/item-card.tsx");
const page = read("../src/app/room/zone/[zone]/i/[id]/page.tsx");
const css = read("../src/components/item/owner-card.module.css");
const shopCss = read("../src/components/zone/shop-link.module.css");
const dto = read("../src/server/dto/items.ts");

/** Контракт карточки — источник чисел (раунд 39). */
const contract = JSON.parse(
  read("../design/package/handoff/round39/item-card-owner.json"),
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
  sheet: { form: string; rows: ReadonlyArray<{ label: string; icon: string }>; confirm: string };
  absent: Record<string, string>;
  treasuryVariant: string;
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

  it("знаки над фото: «⋯» 20 в цели 44", () => {
    expect(card).toContain(`const MORE_GLYPH = ${firstNumber(contract.head.more)}`);
    expect(card).toContain("glyph={MORE_GLYPH}");
    expect(contract.head.more).toContain("44");
    expect(contract.head.back).toContain("44");
    expect(css).toMatch(/\.headSign \{[\s\S]*?width: var\(--hit-target-min, 44px\);/u);
    expect(css).toMatch(/\.headSign \{[\s\S]*?font-size: 20px;/u);
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
    expect(css).toMatch(/\.price \{[\s\S]*?color: rgba\(255, 249, 242, 0\.72\);/u);
  });

  it("полка — строка-ссылка: знак 16 при .55, подпись 13 при .72", () => {
    expect(card).toContain(`const ZONE_SIGN = ${firstNumber(contract.body.zone)}`);
    expect(css).toMatch(/\.zoneSign \{[\s\S]*?color: rgba\(255, 249, 242, 0\.55\);/u);
    expect(css).toMatch(/\.zoneLabel \{[\s\S]*?font: 400 13px\/1\.2 var\(--font-ui\);/u);
    expect(css).toMatch(/\.zoneLabel \{[\s\S]*?color: rgba\(255, 249, 242, 0\.72\);/u);
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
    expect(shopCss).toMatch(/\.card \{[\s\S]*?color: rgba\(255, 249, 242, 0\.72\);/u);
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

  it("в сокровищнице — Вернуть в комнату · Скрыть от гостей · Удалить", () => {
    const hall = card.slice(card.indexOf('key: "return"'), card.indexOf('key: "treasury"'));
    expect(sheetKeys(hall)).toEqual(["return", "hide", "delete"]);
    expect(hall).toContain('title: tHall("remove")');
    expect(hall).toContain("toggleHallAction(item.id, false)");
  });

  it("знаки — те самые из набора round36, а не нарисованные заново", () => {
    // Контракт зовёт знаки по именам файлов; у нас на каждый есть компонент,
    // сверенный путь в путь в `tests/item-actions.test.ts`.
    const OURS: Record<string, string> = {
      "action-treasury.svg": "IconActionTreasury",
      "action-move.svg": "IconMove",
      "action-hide.svg": "IconEyeOff",
      "action-delete.svg": "IconActionDelete",
    };
    for (const row of contract.sheet.rows) {
      const ours = OURS[row.icon];
      // «Кадры вещи» — единственная строка без нашего знака на экране: её нет
      // целиком (см. раздел «чего мы не взяли»).
      if (!ours) {
        expect(row.icon, "новый знак контракта — проверь, есть ли он у нас").toBe(
          "action-gallery.svg",
        );
        continue;
      }
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
    expect(contract.treasuryVariant).toContain("шкалы нет");
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

  it("ЦЕНА ОСТАЁТСЯ — инвариант №8 сильнее этой строки контракта", () => {
    // Контракт пишет у витрины «цены нет». Его правило — про ГОСТЯ, и для
    // гостя оно выполнено жёстче некуда: ключей price/currency нет в гостевом
    // DTO вовсе. А инвариант №8 второй половиной говорит: «хозяйке её
    // собственные цены видны ВСЕГДА, включая её собственную витрину».
    // Исполнить контракт буквально значило бы нарушить инвариант.
    expect(contract.treasuryVariant).toContain("цены нет");
    expect(card).toContain("hall?.price != null");
    expect(card).toContain("<PriceSeenBadge audience={hall.priceAudience} />");
  });
});

describe("чего мы из контракта НЕ взяли — и почему", () => {
  it("«Кадры вещи»: галереи в продукте нет, строка вела бы в пустоту", () => {
    const schema = read("../prisma/schema.prisma");
    const model = /model Item \{[\s\S]*?\n\}/u.exec(schema)?.[0] ?? "";
    // У вещи ОДНА фотография — одна колонка и ни одного отношения к кадрам.
    expect(model).toContain("photoKey");
    expect(model).not.toMatch(/photos|ItemPhoto|gallery/iu);
    expect(card).not.toContain("IconGallery");
    // Появится галерея — эта проверка покраснеет, и строку надо будет завести.
    expect(contract.sheet.rows.map((row) => row.label)).toContain("Кадры вещи");
  });

  it("огоньки 5 px: контракт даёт числа СТРОКИ ЗОНЫ, а не карточки", () => {
    // Наш принятый контракт 36d (тикет 125): 6 px с шагом 5 в карточке, 5 px
    // с шагом 4 в строке зоны. round39 просит в карточке 5/4 — это числа
    // другого места. Плюс раунд 29 требует здесь не показ, а ВВОД тапом
    // (task31.json → addFormScale.editInPlace), и он под тестом.
    expect(contract.body.wish).toContain("5 px");
    expect(contract.body.wish).toContain("gap 4");
    const scaleCss = read("../src/components/item/desire-scale.module.css");
    expect(scaleCss).toMatch(/\.card \.flame \{[\s\S]*?width: 6px;/u);
    // В карточке стоит ввод, а не показ, — второго места ввода на экране нет.
    expect(card).toContain("<DesirePicker");
    expect(card).not.toContain("DesireScale");
  });

  it("строка листа 56 и подпись 600/14: контракт спорит со своей же ссылкой", () => {
    // Он сам говорит «лист на знаках round36», а у round36 строка 52 и титул
    // 500/13.5 (тикет 123, под тестом `item-actions`). Лист рисует свой
    // модуль — второй его копии карточка не заводит.
    expect(contract.sheet.form).toContain("строки 56");
    expect(contract.sheet.form).toContain("знак 19 в цели 44");
    const sheetCss = read("../src/components/item/item-actions.module.css");
    expect(sheetCss).toContain("min-height: 52px");
    expect(css).not.toContain("56px");
  });

  it("стрелка «назад»: знака 20 в наборе дизайна нет — своего не рисуем", () => {
    // Правило тикета 150: контракт зовёт знак, которого у нас нет, — говорим,
    // а не изобретаем. Назад ведёт «←» текстом, как и раньше, но на цели 44.
    const icons = read("../src/components/icons.tsx");
    expect(icons).not.toMatch(/IconBack|IconArrowLeft/u);
    expect(contract.head.back).toContain("стрелка 20");
    expect(card).toMatch(/className=\{`pressable \$\{s\.headSign\}`\}>\s*←/u);
  });

  it("«открыто» вместо суммы: нет цены — нет строки", () => {
    // Чем слово «открыто» отвечает на «цены нет», контракт не объясняет.
    // Ведём себя как в сокровищнице (тикет 35): сказать нечего — строки нет.
    expect(contract.body.price).toContain("«открыто» вместо суммы, если цены нет");
    expect(card).toContain("{roomPrice !== null && <span className={s.price}>{roomPrice}</span>}");
    expect(ru.Settings).not.toHaveProperty("itemPriceOpen");
  });
});
