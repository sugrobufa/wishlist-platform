// КАРТОЧКА ВЕЩИ — ЭКРАН ЧТЕНИЯ (тикет 196, доски 51a/51b/51c; контракт
// `design/package/handoff/round45/item-card.json`).
//
// ЗАЧЕМ ТЕСТ. Числа хозяйкиной половины держит `tests/item-card-owner.test.ts`
// — он читает исходник. Здесь проверяется то, чего исходником не проверить:
//
// 1. ГОСТЕВАЯ ПОЛОВИНА ЦЕЛИКОМ. У неё свой вопрос («дарить ли это») и свой
//    порядок: цена 29 и магазины крупно, полки нет вовсе, главное действие
//    ровно одно — бирка. Полосы света на этом экране НЕТ НИ ОДНОЙ, и это не
//    вкусовщина, а правило контракта: «иначе главных действий два».
//
// 2. ТРИ ЛОМАЮЩИХ СЛУЧАЯ — ВЫЗОВОМ, А НЕ ПРОКЛИКИВАНИЕМ (условие тикета).
//    Вещь без фотографии, вещь сокровищницы, вещь без цены и без магазина.
//    Каждый из трёх меняет не одну строку, а состав экрана, и ломается он
//    молча: типы целы, линт зелёный, экран жив — просто пуст или врёт.
//
// 3. ИМЯ ДАРИТЕЛЯ НЕ УХОДИТ ГОСТЮ НИ В ОДНОМ ИЗ ТРЁХ (инвариант №2) — и это
//    проверяется на DTO, а не на разметке: ключа в гостевой форме нет вовсе.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { Prisma, type Item } from "@prisma/client";

// Словарь настоящий: слова экрана — это и есть то, что ищет глаз.
vi.mock("next-intl", async () => {
  const dict = (await import("../messages/ru.json")).default as unknown as Record<
    string,
    Record<string, string>
  >;
  const fill = (template: string, values?: Record<string, unknown>) =>
    values === undefined
      ? template
      : template.replace(/\{(\w+)\}/gu, (_, key: string) => String(values[key] ?? ""));
  return {
    useTranslations:
      (ns: string) =>
      (key: string, values?: Record<string, unknown>) =>
        fill(dict[ns]?.[key] ?? key, values),
    useLocale: () => "ru",
    useFormatter: () => ({
      dateTime: (date: Date, options?: Intl.DateTimeFormatOptions) =>
        new Intl.DateTimeFormat("ru", options).format(date),
    }),
  };
});

// Карточка хозяйки живёт в маршрутизаторе (правка переносит вещь на другую
// полку и меняет адрес). Здесь она рисуется вызовом, роутера под ней нет.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
}));

/** Канал «занято» (тикет 08) — свой тест; здесь он пуст, если не сказано иначе. */
const booked = { taken: new Set<string>(), mine: new Set<string>() };
vi.mock("../src/app/r/[slug]/booking/booking-context", () => ({
  useGuestBooking: () => ({
    taken: booked.taken,
    mine: booked.mine,
    myBookingsCount: 0,
    signedIn: false,
    hallOpen: false,
    bookedNow: 0,
    markBooked: () => {},
    markTaken: () => {},
  }),
}));

const { itemForGuest } = await import("../src/server/dto/guest-items");
const { itemForOwner } = await import("../src/server/dto/items");
const { GuestItemView } = await import("../src/app/r/[slug]/i/[id]/guest-item-view");
const { ItemCard } = await import("../src/app/room/zone/[zone]/i/[id]/item-card");

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const contract = JSON.parse(read("../design/package/handoff/round45/item-card.json")) as {
  guest: {
    photo: { w: number; h: number };
    order: readonly string[];
    notShown: readonly string[];
    tag: { w: number; h: number; tilt: string; rule: string };
    privacy: string;
    pool: { collapsed: string; invariant: string };
    taken: { photo: string; tag: string; instead: string };
  };
  cases: {
    noPhoto: { h: number; guestAction: string };
    treasury: { gone: readonly string[]; instead: string; guest: string };
    noPriceNoStore: { holdsIt: string; alsoChanges: readonly string[]; noPlaceholders: string };
  };
  a11y: { targets: string };
};

/**
 * Контракт «цена скрыта, а магазин есть» — round46, ответ на письмо 49. Это
 * состояние появилось у продукта тикетом 195 и у дизайна описано не было; он
 * же нашёл в нашей починке дыру (см. раздел ниже).
 */
const hiddenPrice = JSON.parse(
  read("../design/package/handoff/round46/item-card-hidden-price.json"),
) as {
  anchor: { answer: string; why: string; notNote: string; notName: string };
  storeBlock: {
    heading: { was: string; now: string; why: string };
    primaryRow: { name: string; action: string; price: string };
    primaryChoice: readonly string[];
    hintLine: string;
  };
  leak: { rule: string; disappears: readonly string[]; stays: readonly string[]; howToTest: string };
  ownerString: { key: string; value: string; where: string; when: string };
  unparsedLink: { row: string; asPrimary: string };
};

const guestCss = read("../src/components/item/guest-card.module.css");
const shopCss = read("../src/components/zone/shop-link.module.css");
const guestSource = read("../src/app/r/[slug]/i/[id]/guest-item-view.tsx");
const ownerCss = read("../src/components/item/owner-card.module.css");
const tagCss = read("../src/app/r/[slug]/booking/gift-tag.module.css");

/** Полный Item, как из БД; поля перекрываются точечно. */
function dbItem(overrides: Partial<Item> = {}): Item {
  return {
    id: "item_1",
    roomId: "room_1",
    zone: "jewelry",
    inHall: false,
    title: "Серьги-капли",
    note: null,
    photoKey: "items/room_1/abc.jpg",
    url: "https://www.goldapple.ru/19000175823",
    canonicalUrl: "https://www.goldapple.ru/19000175823",
    domain: "goldapple.ru",
    price: new Prisma.Decimal("14900"),
    currency: "RUB",
    priceVisibility: "ALL",
    size: null,
    color: null,
    desire: 3,
    eventWhen: null,
    eventWhere: null,
    validUntil: null,
    giverName: null,
    receivedAt: null,
    hiddenFromHall: false,
    hidden: false,
    source: "URL",
    catalogProductId: null,
    priceCheckedAt: null,
    createdAt: new Date("2026-08-03T10:00:00.000Z"),
    updatedAt: new Date("2026-08-03T10:00:00.000Z"),
    ...overrides,
  };
}

/** Гостевая карточка так, как её увидит браузер. */
const guest = (item: Item) =>
  renderToStaticMarkup(
    createElement(GuestItemView, {
      item: itemForGuest(item),
      zoneLabel: "Украшения",
      pool: "jewelry",
      ownerName: "Мила",
      accent: "#E7C9A9",
      roomHref: "/r/mila",
    }),
  );

/** Карточка хозяйки так же — вызовом, а не прокликиванием. */
const owner = (item: Item, hall: Parameters<typeof ItemCard>[0]["hall"] = null) =>
  renderToStaticMarkup(
    createElement(ItemCard, {
      item: itemForOwner(item),
      hall,
      zones: [{ key: "jewelry", label: "Украшения" }],
      zoneLabel: "Украшения",
      zonePool: "jewelry",
      zoneRect: { x: 100, y: 50, w: 120, h: 90 },
      frameUrl: "/rooms/v4-cream.jpg",
      accent: "#E7C9A9",
      ink: "#2A1806",
    }),
  );

describe("гость: вопрос «дарить ли это» — цена и магазины крупно", () => {
  it("цена 700 29 акцентом, а название МЕЛЬЧЕ на 3 (21 против 24)", () => {
    expect(contract.guest.order).toContain(
      "название 700 21 (мельче на 3 — гость знает, за чем пришёл)",
    );
    expect(guestCss).toContain("font: 700 21px/1.28 var(--font-ui)");
    expect(guestCss).toContain("font: 700 29px/1.1 var(--font-ui)");
    // У хозяйки ровно наоборот: название крупнее, цена мельче.
    expect(ownerCss).toContain("font: 700 24px/1.28 var(--font-ui)");
    expect(ownerCss).toContain("font: 500 16px/1.2 var(--font-ui)");
  });

  it("фотография 430×312 пропорцией — правило переноса то же", () => {
    expect([contract.guest.photo.w, contract.guest.photo.h]).toEqual([430, 312]);
    expect(guestCss).toContain(
      `aspect-ratio: ${contract.guest.photo.w} / ${contract.guest.photo.h}`,
    );
    // 312 × 0.872 = 272, ровно как обещает контракт.
    expect(Math.round(contract.guest.photo.h * (375 / 430))).toBe(272);
  });

  it("магазины РАСКРЫТЫ сразу, а не строкой как у хозяйки", () => {
    const markup = guest(dbItem());
    expect(markup).toContain('href="https://www.goldapple.ru/19000175823"');
    expect(markup).toContain("goldapple.ru");
    // Свёрнутой строки «Где купить · N магазинов» у гостя нет: она хозяйкина.
    expect(markup).not.toContain("Где купить ·");
  });

  it("ПОЛОСЫ СВЕТА НА ГОСТЕВОЙ КАРТОЧКЕ НЕТ НИ ОДНОЙ", () => {
    // Правило контракта дословно: «иначе главных действий два». Проверяется и
    // рецептом (граница 2 px акцентом + ореол — tokens.json → button.primary),
    // и именем класса, которым полоса зовётся в продукте.
    expect(contract.guest.tag.rule).toContain("полосы света на гостевой карточке НЕТ");
    expect(guestCss).not.toMatch(/border-bottom:\s*2px/u);
    expect(guestCss).not.toMatch(/box-shadow:\s*0 4px 18px/u);
    expect(guestCss).not.toContain("mainAction");
    expect(guestSource).not.toContain("mainAction");
    expect(guestSource).not.toContain("lightBar");
    // Хозяйкина полоса при этом на месте — иначе тест проверял бы пустоту.
    expect(ownerCss).toMatch(/\.mainAction \{[\s\S]*?border-bottom: 2px solid var\(--card-accent\);/u);
  });

  it("бирка на нити 218×66 и тихая строка справа от неё", () => {
    expect([contract.guest.tag.w, contract.guest.tag.h]).toEqual([218, 66]);
    // Бирка — АБСОЛЮТНАЯ (contract → scaling): переносу на 375 не подлежит.
    expect(tagCss).toMatch(/\.sheet \.body \{[\s\S]*?width: 218px;/u);
    expect(tagCss).toMatch(/\.sheet \.body \{[\s\S]*?height: 66px;/u);
    expect(tagCss).toContain("transform: rotate(-3deg)");
    expect(tagCss).toContain("transform: rotate(2deg) translateY(3px)");

    const markup = guest(dbItem());
    expect(markup).toContain("Подарить");
    expect(contract.guest.privacy).toContain("справа от бирки");
    expect(markup).toContain("никто не узнает до праздника");
  });

  it("полки и даты добавления у гостя нет вовсе (contract → notShown)", () => {
    expect(contract.guest.notShown.join(" ")).toContain("полка и «Полка целиком»");
    const markup = guest(dbItem());
    expect(markup).not.toContain("Стоит в комнате с");
    expect(markup).not.toContain("Стоит в «Украшения»");
    // И «кто видит цену» — тоже: это разговор хозяйки с собой.
    expect(markup).not.toContain("цену видят все");
  });

  it("складчина СТРОКОЙ, пока участников нет", () => {
    expect(contract.guest.pool.collapsed).toContain("Дорого одному — скинуться с другими");
    expect(guest(dbItem())).toContain("Дорого одному — скинуться с другими");
    // ХОЗЯЙКЕ НЕ ВИДНО НИ СТРОКИ, НИ БЛОКА, НИ ПРИ КАКОМ ЧИСЛЕ УЧАСТНИКОВ
    // (инвариант №1, ADR-0008) — держит сам шов: строка живёт в гостевом
    // модуле, и карточка хозяйки его не импортирует.
    expect(contract.guest.pool.invariant).toContain("хозяйке не видно");
    expect(owner(dbItem())).not.toContain("скинуться");
    expect(read("../src/app/room/zone/[zone]/i/[id]/item-card.tsx")).not.toContain("cardPoolNote");
  });

  it("занятая вещь: фотография .55, бирки нет, дорога к свободным", () => {
    booked.taken = new Set(["item_1"]);
    try {
      const markup = guest(dbItem());
      expect(contract.guest.taken.photo).toBe(".55");
      expect(guestCss).toMatch(/\.photoTaken \{[\s\S]*?opacity: 0\.55;/u);
      expect(markup).toContain("уже дарят");
      expect(markup).toContain("в комнате есть свободные");
      // Бирки нет — и её нет ЦЕЛИКОМ, а не спрятана стилем.
      expect(contract.guest.taken.tag).toBe("нет");
      expect(markup).not.toContain("Подарить");
    } finally {
      booked.taken = new Set<string>();
    }
  });
});

describe("три случая — вызовом, а не прокликиванием", () => {
  it("БЕЗ ФОТОГРАФИИ: место занято смыслом, и оно ниже (236, не 352)", () => {
    const markup = owner(dbItem({ photoKey: null }));
    // Знак пула зоны и подпись полки — вместо чёрной дыры.
    expect(markup).toContain("Украшения");
    expect(contract.cases.noPhoto.h).toBe(236);
    // Полосу света занимает «Добавить фотографию» — единственный случай,
    // когда «Изменить» уступает главное действие.
    expect(markup).toContain("Добавить фотографию");
    expect(markup).not.toContain(">Изменить<");
    // ГОСТЮ на этом месте не предлагается ничего (contract → guestAction).
    const guestMarkup = guest(dbItem({ photoKey: null }));
    expect(guestMarkup).not.toContain("Добавить фотографию");
    expect(guestMarkup).toContain("Подарить");
  });

  it("ВЕЩЬ СОКРОВИЩНИЦЫ: четыре блока ушли, осталась строка о подарке", () => {
    const item = dbItem({
      inHall: true,
      // Имя стоит в родительном: строка словаря — «… · от {giver}», и падеж
      // ей задаёт предлог, а не токен (та же ловушка, что у писем).
      giverName: "мамы",
      receivedAt: new Date("2019-05-05T10:00:00.000Z"),
    });
    const markup = owner(item, {
      price: null,
      currency: null,
      rounded: false,
      priceAudience: "ITEM",
      hiddenFromObservers: false,
    });

    expect(contract.cases.treasury.gone).toEqual(["цена", "степень желания", "где купить", "бирка"]);
    // Цены нет, шкалы нет, «где купить» нет — покупать и бронировать нечего.
    expect(markup).not.toContain("14 900");
    expect(markup).not.toContain("goldapple.ru");
    expect(markup).not.toContain("Где купить");
    // Осталась одна строка акцентом — и ИМЯ В НЕЙ ТОЛЬКО ХОЗЯЙКЕ.
    expect(markup).toContain("Подарок 2019 года · от мамы");
    expect(markup).toContain("Записать заметку");

    // ГОСТЮ — то же без имени и без единого действия.
    const guestMarkup = guest(item);
    expect(contract.cases.treasury.guest).toContain("действий нет вовсе");
    expect(guestMarkup).toContain("Подарок 2019 года");
    expect(guestMarkup).not.toContain("мам");
    expect(guestMarkup).not.toContain("Подарить");
  });

  it("ИМЯ ДАРИТЕЛЯ НЕ УХОДИТ ГОСТЮ НИ В ОДНОМ СЛУЧАЕ — на DTO, не на разметке", () => {
    // Инвариант №2: имя раскрывается ровно один раз и ровно хозяйке. У
    // гостевой формы ключа нет вовсе — обойти нечем.
    for (const item of [
      dbItem({ inHall: true, giverName: "мамы", receivedAt: new Date("2019-05-05T00:00:00Z") }),
      dbItem({ giverName: "мамы" }),
      dbItem({ giverName: "мамы", photoKey: null, price: null, canonicalUrl: null }),
    ]) {
      const dto = itemForGuest(item);
      expect("giverName" in dto, item.inHall ? "витрина" : "комната").toBe(false);
      expect(JSON.stringify(dto)).not.toContain("мам");
    }
  });

  it("БЕЗ ЦЕНЫ И БЕЗ МАГАЗИНА: заметка становится телом, заглушек нет", () => {
    const item = dbItem({
      price: null,
      priceVisibility: "NONE",
      url: null,
      canonicalUrl: null,
      domain: null,
      source: "MANUAL",
      note: "Ждала её два года",
    });

    // Правило контракта: строк «цена не указана» и «магазины не добавлены» НЕТ.
    expect(contract.cases.noPriceNoStore.noPlaceholders).toContain("НЕТ");
    for (const markup of [owner(item), guest(item)]) {
      expect(markup).toContain("Ждала её два года");
      expect(markup).not.toContain("цена не указана");
      expect(markup).not.toContain("магазины не добавлены");
      expect(markup).not.toContain("Где купить");
    }
    // Заметка ТЕЛОМ карточки: 14.5 вместо 12.5 и .78 вместо .62.
    expect(contract.cases.noPriceNoStore.holdsIt).toContain("14.5");
    for (const css of [ownerCss, guestCss]) {
      expect(css).toMatch(/\.noteBody \{[\s\S]*?font-size: 14\.5px;/u);
      expect(css).toMatch(/\.noteBody \{[\s\S]*?color: rgba\(255, 249, 242, 0\.78\);/u);
    }
    // И два соседа этого случая: название +3, фотография ниже на 44.
    expect(contract.cases.noPriceNoStore.alsoChanges).toEqual([
      "название +3 px",
      "фотография ниже на 44",
    ]);
    expect(ownerCss).toMatch(/\.nameBig \{[\s\S]*?font-size: 27px;/u); // 24 + 3
    expect(guestCss).toMatch(/\.nameBig \{[\s\S]*?font-size: 24px;/u); // 21 + 3
    expect(ownerCss).toMatch(/\.photoShort \{[\s\S]*?aspect-ratio: 430 \/ 308;/u); // 352 − 44
  });
});

/**
 * ПРИ СКРЫТОЙ ЦЕНЕ ПРОДУКТ НЕ ПЕЧАТАЕТ НИ ОДНОГО ЧИСЛА ДЕНЕГ — правило пакета
 * 46 (`item-card-hidden-price.json` → leak), найденное дизайном в НАШЕЙ же
 * починке тикета 195.
 *
 * Как это протекало. Формула «скрытая цена прячет число, а не путь» верна, но
 * в его спеке 51b строки магазинов несут разобранные цены (14 900, 15 400,
 * 16 200) — путь тащит число с собой, и гость читает его строкой ниже того
 * места, где число спрятали.
 *
 * ПРОВЕРЯЕТСЯ КАК ИНВАРИАНТ ТИШИНЫ, А НЕ КАК ВИД (условие контракта дословно):
 * в гостевом ответе при скрытой цене не должно быть денежного поля ни в
 * разметке, ни В ДАННЫХ — тем же приёмом, что «карточка хозяйки не читает
 * booking». «Не показали» обходится вёрсткой, «не отдали» — нечем.
 */
const hidden = ["ME", "NONE"] as const;

describe("цена скрыта, а магазин есть (contract round46)", () => {
  it.each(hidden)("priceVisibility=%s: в ДАННЫХ гостя нет ни одного денежного поля", (visibility) => {
    const dto = itemForGuest(dbItem({ priceVisibility: visibility }));
    // Ключей нет вовсе — не `null`, не пустая строка, а именно нет.
    for (const key of ["price", "currency"]) expect(key in dto, key).toBe(false);
    // И ни в одном вложенном объекте: у магазина цены не бывает по построению
    // (`shopOf` отдаёт адрес и домен), но проверяется весь ответ целиком —
    // приедет когда-нибудь разобранная цена, покраснеет здесь.
    const flat = JSON.stringify(dto);
    expect(flat).not.toMatch(/price|currency|amount|цена|₽|RUB|USD|EUR/iu);
    expect(flat).not.toContain("14900");
    // Путь при этом на месте — иначе тест проверял бы пустоту (тикет 195).
    expect(flat).toContain("goldapple.ru");
  });

  it.each(hidden)("priceVisibility=%s: и в РАЗМЕТКЕ гостя — ни одного числа денег", (visibility) => {
    const markup = guest(dbItem({ priceVisibility: visibility }));
    expect(markup).not.toMatch(/₽|14\s?900|от\s+\d/u);
    // «дешевле всего здесь» и сортировки по цене нет и не заводилось.
    expect(markup).not.toContain("дешевле");
  });

  it("якорем становится ПУТЬ, а не заметка: заголовок 13, дверь 17 в рамке", () => {
    expect(hiddenPrice.anchor.answer).toContain("якорем становится ПУТЬ");
    const markup = guest(dbItem({ priceVisibility: "NONE", note: "Ждала её два года" }));
    expect(markup).toContain("Где купить");
    expect(markup).toContain("Открыть");
    expect(markup).toContain("Цену покажет магазин");
    // Заголовок якоря не может быть тише самого якоря: 500 13 обычным цветом.
    expect(hiddenPrice.storeBlock.heading.now).toBe("строка 500 13 #FFF9F2");
    expect(guestCss).toMatch(/\.storeHeading \{[\s\S]*?font: 500 13px\/1\.2 var\(--font-ui\);/u);
    // Главная дверь: рамка, заливка, имя 700 17, «Открыть» 600 12.5 акцентом.
    expect(hiddenPrice.storeBlock.primaryRow.name).toBe("700 17 #FFF9F2");
    expect(hiddenPrice.storeBlock.primaryRow.price).toBe("НЕТ");
    expect(shopCss).toMatch(/\.door \{[\s\S]*?font: 700 17px\/1\.2 var\(--font-ui\);/u);
    expect(shopCss).toMatch(/\.door \.go \{[\s\S]*?font: 600 12\.5px\/1 var\(--font-ui\);/u);
    // Подсказка 11.5 при .5 — и это НЕ заглушка «цена скрыта».
    expect(guestCss).toMatch(/\.storeHint \{[\s\S]*?font: 400 11\.5px\/1\.35 var\(--font-ui\);/u);
    expect(markup).not.toContain("цена скрыта");
    // ЗАМЕТКА И НАЗВАНИЕ НЕ РАСТУТ: «иначе на одном экране два якоря».
    expect(hiddenPrice.anchor.notNote).toContain("12.5");
    expect(hiddenPrice.anchor.notName).toContain("21");
    expect(markup).toContain("Ждала её два года");
    expect(guestSource).toContain("const priceHidden = isWant && sum === null && shop != null;");
    // Тело заметки включается ТОЛЬКО когда магазина тоже нет (noPriceNoStore).
    expect(guestSource).toContain("const noteHoldsCard = isWant && sum === null && !shop;");
  });

  it("дверь — ТА ЖЕ ссылка продукта, а не вторая: якорь по-прежнему один", () => {
    // Второй `<a>` унёс бы с собой `rel="noopener noreferrer"`, запись
    // перехода и разбор домена — три обязательства, которые тикет 37 свёл в
    // один компонент ровно затем, чтобы их нельзя было потерять поодиночке.
    expect(guestSource).not.toMatch(/<a[\s>]/u);
    const markup = guest(dbItem({ priceVisibility: "NONE" }));
    // Считаются ссылки НАРУЖУ: `Link` внутри комнаты тоже рисует `<a>`, но
    // обязательств тикета 37 на нём нет и быть не должно.
    expect([...markup.matchAll(/target="_blank"/gu)]).toHaveLength(1);
    expect(markup).toContain('rel="noopener noreferrer"');
  });

  it("«от {price}» у ХОЗЯЙКИ следует за гостем, а её собственная цена — нет", () => {
    // Правило пакета называет эту строку поимённо: «„от {price}" в свёрнутой
    // строке» исчезает при скрытой цене. Строка свёрнутых магазинов — зеркало
    // того, что получит гость, и числа в ней быть не должно.
    expect(hiddenPrice.leak.disappears).toContain("«от {price}» в свёрнутой строке");
    // «Только я» — там, где у скрытия есть адресат и строка про него.
    const markup = owner(dbItem({ priceVisibility: "ME" }));
    expect(markup).not.toContain("от 14");
    // А САМА ЦЕНА У ХОЗЯЙКИ ОСТАЁТСЯ — инвариант №8 второй половиной:
    // «хозяйке её собственные цены видны ВСЕГДА». Спрятать её здесь значило бы
    // исполнить одно правило, нарушив другое (прецедент round41: «без адресата
    // однажды по ней спрятали бы цену и от хозяйки»).
    expect(markup).toMatch(/14\s?900/u);
    expect(markup).toContain("цену видишь только ты");
    // И ей сказано, что дорога к вещи при этом остаётся.
    expect(hiddenPrice.ownerString.key).toBe("AddItem.priceHiddenPathHint");
    expect(markup).not.toContain(hiddenPrice.ownerString.value); // строка в ФОРМЕ правки
    expect(read("../src/app/room/zone/[zone]/i/[id]/item-card.tsx")).toContain(
      'tField("priceHiddenPathHint")',
    );
  });

  it("строка хозяйке стоит только там, где обещание можно понять неверно", () => {
    // При «Все» прятать нечего, и оговорка была бы шумом.
    expect(hiddenPrice.ownerString.when).toContain("только при visFRIENDS, visME, visNONE");
    expect(read("../src/app/room/zone/[zone]/i/[id]/item-card.tsx")).toContain(
      "{!guestSeesPrice(priceVisibility) && (",
    );
  });

  it("магазин, о котором известен только адрес, — тоже дверь", () => {
    // Вторая, тихая дыра тикета 195: ссылка сохраняется, даже когда разбор не
    // удался. У НАС ЭТО ЕДИНСТВЕННЫЙ ВИД МАГАЗИНА — `shopOf` отдаёт адрес и
    // домен, наличия и цены не знает ни у одного. Значит и строка одна:
    // домен и «Открыть», без наличия и без числа.
    expect(hiddenPrice.unparsedLink.row).toContain("без строки наличия и без числа");
    const dto = itemForGuest(dbItem({ priceVisibility: "NONE" }));
    if (dto.inHall) throw new Error("unreachable");
    expect(Object.keys(dto.shop ?? {}).sort()).toEqual(["domain", "url"]);
    // «Становится главной дверью, если других нет» — у вещи ссылка ровно одна,
    // и выбирать не из чего. Появится вторая (каталог за CATALOG_ENABLED) —
    // выбор двери придётся написать, и напомнит об этом эта строка.
    expect(hiddenPrice.storeBlock.primaryChoice).toHaveLength(3);
  });
});

describe("цели нажатия — все ≥ 44 (contract → a11y.targets)", () => {
  it("ни одной цели меньше 44 в обоих модулях карточки", () => {
    expect(contract.a11y.targets).toContain("все цели ≥ 44");
    // Каждое `min-height`/`height` у нажимаемых правил либо переменная цели,
    // либо число ≥ 44. Ловится по значению, а не по имени класса: правило
    // называет ЦЕЛЬ, и придумать ей своё число нельзя.
    for (const css of [ownerCss, guestCss]) {
      const targets = [...css.matchAll(/min-height:\s*([^;]+);/gu)]
        .map((m) => m[1] as string)
        // `100vh` — не цель нажатия, а высота экрана: она у карточки одна и
        // держит поверхность до низа (`.screen`, `.column`).
        .filter((value) => !value.includes("vh"));
      expect(targets.length).toBeGreaterThan(0);
      for (const value of targets) {
        const number = Number(/(\d+(?:\.\d+)?)px/u.exec(value)?.[1] ?? NaN);
        expect(
          value.includes("--hit-target-min") || number >= 44,
          `цель «${value}» меньше 44`,
        ).toBe(true);
      }
    }
  });
});
