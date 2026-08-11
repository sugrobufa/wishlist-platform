// Строка впечатления — дорога в карточку вещи (тикет 194).
//
// ЗАЧЕМ ТЕСТ. Та же дыра, что закрыл тикет 186, только не у плитки, а у
// строки. Зона «Впечатления» рисуется строками, а не сеткой (тикет 115: у
// впечатления свои поля, и сетка вещей им не подходит), и граница тикета 186 —
// плитка — была выдержана правильно. Но `<li>` строки не нажималась вовсе:
// вещь есть, карточка вещи есть, входа с неё нет. Поломка такого рода молчит
// везде: ни typecheck, ни lint, ни тесты карточки её не видят — экран-то жив,
// к нему просто нет дороги из одной зоны из двадцати.
//
// ПОЧЕМУ РЕНДЕРОМ, А НЕ ЧТЕНИЕМ ИСХОДНИКА. Главное требование тикета —
// «вложенных `<a>` в строке нет». Вложенный якорь это не стилистика: браузер
// такую разметку чинит сам, разрывая внешнюю ссылку, и строка перестаёт
// нажиматься ровно там, где в слоте действия живёт ссылка, — то есть у гостя,
// у которого дорога в карточку как раз этой ссылкой и стоит. Увидеть это можно
// только в разметке, и только собрав строку целиком.
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// Словарь настоящий: «Срок вышел …» у просроченной строки — часть проверки.
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
  };
});

const { ExperienceRows } = await import("../src/components/zone/experience-rows");
type RowItem = Parameters<typeof ExperienceRows>[0]["items"][number];

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const rows = read("../src/components/zone/experience-rows.tsx");
const rowsCss = read("../src/components/zone/experience-rows.module.css");
const zoneGrid = read("../src/components/zone/ZoneGrid.tsx");
const ownerRoom = read("../src/app/room/page.tsx");
const guestGrid = read("../src/app/r/[slug]/booking/guest-zone-grid.tsx");

const ITEM: RowItem = {
  id: "itm_1",
  title: "Гончарная мастерская",
  photoUrl: "https://cdn.example/clay.jpg",
  isDemo: false,
  eventWhen: "Выходные",
  eventWhere: "Суздаль",
  validUntil: "2026-09-14",
  expired: false,
};

/** Строка так, как её увидит браузер. */
const draw = (item: Partial<RowItem>, base?: string, action?: string) =>
  renderToStaticMarkup(
    createElement(ExperienceRows, {
      items: [{ ...ITEM, ...item }],
      itemHrefBase: base,
      // Слот действия гостя: в нём живёт СВОЯ ссылка на карточку — из-за неё
      // весь разговор о вложенности.
      renderItemAction: action
        ? () => createElement("a", { href: action }, "Подробнее")
        : undefined,
    }),
  );

/** Адрес карточки у хозяйки: зона впечатлений — `events`. */
const BASE = "/room/zone/events/i/";
const HREF = `${BASE}itm_1`;
/** Адрес карточки у гостя — тот же, что собирает гостевая сетка. */
const GUEST_HREF = "/r/mila/i/itm_1";

/** Якорей в разметке. */
const anchors = (markup: string) => (markup.match(/<a[\s>]/gu) ?? []).length;

/**
 * Есть ли якорь ВНУТРИ якоря. От `<a…>` идём вперёд, пока не встретим `</a>`;
 * если раньше закрытия попался второй `<a` — разметка вложенная.
 */
const nested = (markup: string) => /<a[\s>](?:(?!<\/a>)[\s\S])*?<a[\s>]/u.test(markup);

describe("строка впечатления ведёт в карточку вещи", () => {
  it("нажимается ССЫЛКОЙ, а не обработчиком", () => {
    // Долгое нажатие, «открыть в новой вкладке», средняя кнопка — всё это
    // работает только у настоящего якоря.
    const markup = draw({}, BASE);
    expect(markup).toContain(`href="${HREF}"`);
    expect(markup).not.toContain("onclick");
  });

  it("адрес ведёт на существующий экран, а не в 404", () => {
    expect(
      existsSync(
        fileURLToPath(new URL("../src/app/room/zone/[zone]/i/[id]/page.tsx", import.meta.url)),
      ),
    ).toBe(true);
  });

  it("цель нажатия — миниатюра и обе подписи, а не одно название", () => {
    // Внутрь ссылки должны попасть и образ, и заголовок, и строка «когда ·
    // где · до» — иначе нажимается полоска текста, а человек целится в картинку.
    const markup = draw({}, BASE);
    const inside = /<a[\s>][\s\S]*?<\/a>/u.exec(markup)?.[0] ?? "";
    expect(inside).toMatch(/_thumb_/u);
    expect(inside).toMatch(/_title_/u);
    expect(inside).toMatch(/_meta_/u);
    expect(inside).toContain("Гончарная мастерская");
    expect(inside).toContain("Выходные · Суздаль");
  });

  it("цель не ниже 44 — правилом, а не сегодняшней раскладкой", () => {
    // Строка сегодня 92 px, но держит её `.row`, а не ссылка: раскладка
    // изменится — правило останется.
    expect(rowsCss).toMatch(/\.open \{[\s\S]*?min-height: var\(--hit-target-min, 44px\);/u);
    // Ссылка сама флекс-контейнер с тем же зазором: иначе миниатюра и подписи
    // легли бы друг под друга.
    expect(rowsCss).toMatch(/\.open \{[\s\S]*?display: flex;/u);
    expect(rowsCss).toMatch(/\.open \{[\s\S]*?gap: 13px;/u);
    // Любой нажимаемый элемент проседает scale(.97) — общий класс (CLAUDE.md).
    expect(rows).toContain("className={`pressable ${s.open}`}");
  });

  it("просроченное впечатление ведёт туда же: срок вышел — не значит, что вещи нет", () => {
    const markup = draw({ expired: true }, BASE);
    expect(markup).toContain(`href="${HREF}"`);
    // И сама строка про срок никуда не делась.
    expect(markup).toContain("Срок вышел 2026-09-14");
  });

  it("без адреса строка не ведёт никуда", () => {
    // Так живёт гостевая сетка: у неё вход в карточку стоит отдельной ссылкой
    // в слоте действия (решение тикета 186), и второго ей не нужно.
    expect(anchors(draw({}))).toBe(0);
    // Содержимое при этом на месте — строка не пропала вместе со ссылкой.
    expect(draw({})).toContain("Гончарная мастерская");
  });

  it("СТРОКА-ПРИЗРАК не ведёт никуда даже с адресом: за ней нет вещи", () => {
    const markup = draw({ isDemo: true }, BASE);
    expect(anchors(markup)).toBe(0);
    expect(markup).not.toContain(BASE);
  });
});

describe("ВЛОЖЕННЫХ <a> В СТРОКЕ НЕТ", () => {
  it("строка со ссылкой в слоте действия: два якоря, и они рядом, а не один в другом", () => {
    const markup = draw({}, BASE, GUEST_HREF);
    expect(anchors(markup)).toBe(2);
    expect(nested(markup)).toBe(false);
  });

  it("слот действия стоит ПОСЛЕ ссылки строки, а не внутри неё", () => {
    const markup = draw({}, BASE, GUEST_HREF);
    expect(markup.indexOf("</a>")).toBeLessThan(markup.indexOf(GUEST_HREF));
  });

  it("проверка вложенности умеет её находить — иначе она ничего не стоит", () => {
    expect(nested('<a href="/a"><a href="/b">x</a></a>')).toBe(true);
    expect(nested('<a href="/a">x</a><a href="/b">y</a>')).toBe(false);
  });

  it("оборачивается СОДЕРЖАТЕЛЬНАЯ часть, а не вся <li>", () => {
    // Обёртка вокруг `<li>` целиком проглотила бы слот действия — с ним внутрь
    // уехали бы и бирка гостя, и его же ссылка на карточку.
    const markup = draw({}, BASE, GUEST_HREF);
    expect(markup.indexOf("<li")).toBeLessThan(markup.indexOf("<a"));
  });
});

describe("адрес собирается один раз и в одном месте", () => {
  it("сетка отдаёт строке ту же базу, что и плитке", () => {
    // Форму списка выбирает зона, но дорога в вещь одна на обе формы —
    // иначе «Впечатления» снова отстанут от остальных девятнадцати зон.
    expect(zoneGrid).toContain("itemHrefBase={itemHrefBase}");
    expect(zoneGrid).toContain("<ExperienceRows");
  });

  it("строка адрес НЕ собирает: у хозяйки и гостя он разный", () => {
    expect(rows).toContain("`${itemHrefBase}${item.id}`");
    expect(rows).not.toContain("/room/zone/");
    expect(rows).not.toContain("/r/");
  });

  it("комната хозяйки отдаёт базу СТРОКОЙ: функции границу RSC не переходят", () => {
    expect(ownerRoom).toContain("itemHrefBase={`/room/zone/${zone.key}/i/`}");
    expect(rows).toMatch(/itemHrefBase\?: string;/u);
    expect(rows).not.toMatch(/itemHrefBase\?: \(/u);
  });
});

describe("ссылка хозяйки не протекает гостю", () => {
  it("гостевая сетка адреса хозяйки не знает вовсе", () => {
    expect(guestGrid).not.toContain("itemHrefBase");
    expect(guestGrid).not.toContain("/room/zone/");
  });

  it("у гостя дорога в карточку своя — /r/{slug}/i/{id}", () => {
    // Она уже есть и стоит в слоте действия (тикет 91, решение тикета 186);
    // строка её показывает, а не подменяет.
    expect(guestGrid).toContain("href={`/r/${roomSlug}/i/${item.id}`}");
    expect(
      existsSync(fileURLToPath(new URL("../src/app/r/[slug]/i/[id]/page.tsx", import.meta.url))),
    ).toBe(true);
  });

  it("строка, собранная по-гостевому, адреса хозяйки не несёт ни разу", () => {
    // Гость базы не передаёт — значит и `/room/…` в его разметке взяться
    // неоткуда. Тест проверяет результат, а не намерение.
    const markup = draw({}, undefined, GUEST_HREF);
    expect(markup).not.toContain("/room/");
    expect(markup).toContain(`href="${GUEST_HREF}"`);
    expect(anchors(markup)).toBe(1);
  });
});
