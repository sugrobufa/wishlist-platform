// Плитка вещи в комнате ХОЗЯЙКИ — дорога в карточку вещи (тикет 186).
//
// ЗАЧЕМ ТЕСТ. Приёмка владельца 11.08.2026: «почему при нажатии на вещь нет
// крупного представления с деталями». Экран был собран и покрыт тестами
// (`tests/item-card-owner.test.ts`), но ПЛИТКА НЕ НАЖИМАЛАСЬ ВОВСЕ: `<li>` без
// ссылки, без onClick и без роли — кликабельной внутри неё была одна маленькая
// «Где купить». У гостя точно так же устроенная сетка ссылку имела. Поломка
// такого рода молчит везде: ни typecheck, ни lint, ни рендер-тесты карточки её
// не видят — экран-то жив, к нему просто нет дороги.
//
// ПОЧЕМУ РЕНДЕРОМ, А НЕ ЧТЕНИЕМ ИСХОДНИКА. Главное требование тикета —
// «вложенных `<a>` в плитке нет — проверить разметкой, не глазами». Вложенный
// якорь это не стилистика: браузер такую разметку чинит сам, разрывая внешнюю
// ссылку, и плитка перестаёт нажиматься ровно там, где у вещи есть магазин, —
// то есть у самых интересных вещей. Увидеть это можно только в разметке, и
// только собрав плитку целиком со ссылкой И с «Где купить».
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Словарь настоящий: подписи плитки («пример» у призрака) — часть проверки.
vi.mock("next-intl", async () => {
  const dict = (await import("../messages/ru.json")).default as unknown as Record<
    string,
    Record<string, string>
  >;
  return {
    useTranslations: (ns: string) => (key: string) => dict[ns]?.[key] ?? key,
    useLocale: () => "ru",
  };
});

const { ItemTile } = await import("../src/components/zone/ItemTile");
type TileItem = Parameters<typeof ItemTile>[0]["item"];

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const zoneGrid = read("../src/components/zone/ZoneGrid.tsx");
const tile = read("../src/components/zone/ItemTile.tsx");
const gridCss = read("../src/components/zone/zone-grid.module.css");
const ownerRoom = read("../src/app/room/page.tsx");
const guestGrid = read("../src/app/r/[slug]/booking/guest-zone-grid.tsx");
const card = read("../src/app/room/zone/[zone]/i/[id]/item-card.tsx");

const ITEM: TileItem = {
  id: "itm_1",
  title: "Чайник",
  photoUrl: "https://cdn.example/kettle.jpg",
  isDemo: false,
};

/** Плитка так, как её увидит браузер. */
const draw = (item: Partial<TileItem>, href?: string) =>
  renderToStaticMarkup(
    createElement(ItemTile, { item: { ...ITEM, ...item }, staggerIndex: 0, href }),
  );

/** Адрес карточки у хозяйки: /room/zone/{зона}/i/{id}. */
const HREF = "/room/zone/books/i/itm_1";

/** Магазин — вторая ссылка внутри плитки, из-за неё весь разговор о вложенности. */
const SHOP = { url: "https://ozon.ru/product/1", domain: "ozon.ru" };

/** Якорей в разметке. */
const anchors = (markup: string) => (markup.match(/<a[\s>]/gu) ?? []).length;

/**
 * Есть ли якорь ВНУТРИ якоря. От `<a…>` идём вперёд, пока не встретим `</a>`;
 * если раньше закрытия попался второй `<a` — разметка вложенная.
 */
const nested = (markup: string) => /<a[\s>](?:(?!<\/a>)[\s\S])*?<a[\s>]/u.test(markup);

describe("плитка хозяйки ведёт в карточку вещи", () => {
  it("нажимается ССЫЛКОЙ, а не onClick", () => {
    // Долгое нажатие, «открыть в новой вкладке», средняя кнопка — всё это
    // работает только у настоящего якоря, и у гостя уже работает.
    const markup = draw({}, HREF);
    expect(markup).toContain(`<a `);
    expect(markup).toContain(`href="${HREF}"`);
    expect(markup).not.toContain("onclick");
  });

  it("адрес ведёт на существующий экран, а не в 404", () => {
    // Дорога проверяется до конца: маршрут карточки хозяйки лежит на месте.
    expect(
      existsSync(fileURLToPath(new URL("../src/app/room/zone/[zone]/i/[id]/page.tsx", import.meta.url))),
    ).toBe(true);
  });

  it("цель нажатия — вся площадь фото и подписей", () => {
    // Внутри ссылки должны оказаться и образ, и название, и подпись — иначе
    // нажимается полоска текста, а человек целится в картинку.
    const markup = draw({ price: "14900", currency: "RUB" }, HREF);
    const inside = /<a[\s>][\s\S]*?<\/a>/u.exec(markup)?.[0] ?? "";
    expect(inside).toMatch(/_media_/u);
    expect(inside).toMatch(/_title_/u);
    expect(inside).toMatch(/_meta_/u);
    expect(inside).toContain("Чайник");
  });

  it("цель не ниже 44 — правилом, а не сегодняшней раскладкой", () => {
    expect(gridCss).toMatch(/\.open \{[\s\S]*?min-height: var\(--hit-target-min, 44px\);/u);
    // Блочная: внутри блочные дети, инлайновая ссылка сложила бы плитку.
    expect(gridCss).toMatch(/\.open \{[\s\S]*?display: block;/u);
    // Любой нажимаемый элемент проседает scale(.97) — общий класс (CLAUDE.md).
    expect(tile).toContain("className={`pressable ${s.open}`}");
  });

  it("без адреса плитка не ведёт никуда", () => {
    // Гостевая сетка адреса не передаёт: у неё вход в карточку стоит отдельной
    // ссылкой в слоте действия, и второго ей не нужно.
    expect(anchors(draw({}))).toBe(0);
  });
});

describe("ПЛИТКА-ПРИЗРАК НЕ ВЕДЁТ НИКУДА", () => {
  it("даже когда адрес передан: за призраком нет вещи", () => {
    // id демо-вещи не значит ничего вне рендера — в БД её нет.
    const markup = draw({ isDemo: true }, HREF);
    expect(anchors(markup)).toBe(0);
    expect(markup).not.toContain(HREF);
    // Сам призрак при этом на месте — бейдж «пример» никуда не делся.
    expect(markup).toContain("пример");
  });

  it("решает это сама плитка, а не вызывающая сторона", () => {
    // У вызывающей стороны про призраков знают не все, а `look.ghost` здесь
    // уже посчитан. Одно место — один ответ.
    expect(tile).toContain("const openHref = look.ghost ? undefined : href;");
  });
});

describe("ВЛОЖЕННЫХ <a> В ПЛИТКЕ НЕТ", () => {
  it("вещь со ссылкой на магазин: два якоря, и они рядом, а не один в другом", () => {
    const markup = draw({ shop: SHOP }, HREF);
    expect(anchors(markup)).toBe(2);
    expect(nested(markup)).toBe(false);
    // Оба на месте: дорога внутрь и дорога наружу.
    expect(markup).toContain(`href="${HREF}"`);
    expect(markup).toContain(`href="${SHOP.url}"`);
  });

  it("«Где купить» стоит ПОСЛЕ ссылки плитки, а не внутри неё", () => {
    const markup = draw({ shop: SHOP }, HREF);
    expect(markup.indexOf("</a>")).toBeLessThan(markup.indexOf(SHOP.url));
  });

  it("проверка вложенности умеет её находить — иначе она ничего не стоит", () => {
    // Сторож самого сторожа: на заведомо вложенной разметке `nested` красная.
    expect(nested('<a href="/a"><a href="/b">x</a></a>')).toBe(true);
    expect(nested('<a href="/a">x</a><a href="/b">y</a>')).toBe(false);
  });

  it("оборачивается ТЕЛО плитки, а не вся <li>", () => {
    // Обёртка вокруг `<li>` целиком проглотила бы «Где купить» и слот
    // действия — с ними внутрь уехали бы и бирка гостя, и лист «⋯».
    const markup = draw({ shop: SHOP }, HREF);
    expect(markup.startsWith("<li")).toBe(true);
    expect(markup.indexOf("<a")).toBeGreaterThan(markup.indexOf("<li"));
  });
});

describe("адрес собирается один раз и в одном месте", () => {
  it("сетка добавляет к базе id вещи", () => {
    expect(zoneGrid).toContain("href={itemHrefBase ? `${itemHrefBase}${item.id}` : undefined}");
  });

  it("комната хозяйки отдаёт базу СТРОКОЙ: функции границу RSC не переходят", () => {
    // Тот же довод, что у `zoneHrefBase` в RoomListView (tests/rsc-boundary):
    // функция в пропе серверного JSX — это 500 на живом экране.
    expect(ownerRoom).toContain("itemHrefBase={`/room/zone/${zone.key}/i/`}");
    expect(zoneGrid).toMatch(/itemHrefBase\?: string;/u);
    expect(zoneGrid).not.toMatch(/itemHrefBase\?: \(/u);
  });

  it("плитка адрес НЕ собирает: у хозяйки и гостя он разный", () => {
    expect(tile).not.toContain("/room/zone/");
  });

  it("гостевая сетка не тронута — там уже правильно", () => {
    expect(guestGrid).toContain("href={`/r/${roomSlug}/i/${item.id}`}");
    expect(guestGrid).not.toContain("itemHrefBase");
  });
});

describe("возврат с карточки — в зону комнаты, а не в корень", () => {
  it("и стрелка, и строка полки ведут в ту же зону, откуда пришли", () => {
    expect(card).toContain("const zoneHref = `/room/zone/${item.zone}`;");
    expect(card).toContain("<Link href={zoneHref}");
    expect(card).not.toContain('href="/room"');
  });
});
