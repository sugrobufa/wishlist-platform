// ЭКРАН «ПОЛКИ» — список полок комнаты (тикет 239, турн 57a, контракт
// `design/package/handoff/round51/zone-list.json`).
//
// ЗАЧЕМ ТЕСТ. Решением владельца 14.08.2026 семь полок из 134 живут без места
// на кадре (`zonesWithoutRect`, тикет 235): метки нет, камера не едет. Список
// полок из удобства стал ЕДИНСТВЕННОЙ дорогой к ним — и ломается он молча:
// достаточно вернуть один `filter`, и полка исчезнет из продукта целиком, не
// уронив ни типов, ни сборки.
//
// ДВА ПРАВИЛА, КОТОРЫЕ ЗДЕСЬ СТОРОЖАТСЯ:
//
//   1. В СПИСКЕ ВСЕ ПОЛКИ — включая пустые и включая те, у кого нет места на
//      кадре. Пустая полка без места прежде не была видна НИГДЕ (дыра, найденная
//      тикетом 235): в кадре её нет, а список отбрасывал группы без вещей.
//
//   2. НИ ОДНА ПОЛКА НИЧЕМ НЕ ПОМЕЧЕНА. Дизайн отклонил подпись «на кадре её
//      нет» своим же доводом, которым снимал «писать некуда»: это сообщение об
//      отсутствии. «Новое состояние не потребовало ни одного нового знака —
//      потребовало бы, значит завели второй сорт полок, а не закрыли дырку».
//      Поэтому строка полки без места сравнивается с соседней СКЕЛЕТОМ разметки,
//      а не глазами: совпасть обязаны и узлы, и классы, и атрибуты.
//
// Единственное приглушение в списке — пустая полка, и оно про ВЕЩИ: пустая с
// местом и пустая без места выглядят одинаково, полная с местом и полная без
// места — тоже. Это тест и проверяет.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-intl", async () => {
  const dict = (await import("../messages/ru.json")).default as unknown as Record<
    string,
    Record<string, string>
  >;
  // Ключей раздела `ZoneList` из пакета 51 в словаре ещё нет — их заводит
  // ведущий (правило проекта: новые строки не пишет агент). Мок отдаёт вместо
  // отсутствующей строки её ключ, и тест на слова не опирается ни разу.
  return {
    useTranslations: (ns: string) => (key: string) => dict[ns]?.[key] ?? key,
    useLocale: () => "ru",
  };
});

const { ZoneListView } = await import("../src/components/room-list/zone-list-view");
const { RoomListView } = await import("../src/components/room-list/room-list-view");
const { rooms, MONEY_ZONE_KEY, zonesWithoutRect, zoneInfo } = await import("../src/config/design");
const { visibleZones } = await import("../src/components/scene/zones");

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const view = read("../src/components/room-list/zone-list-view.tsx");
const css = read("../src/components/room-list/zone-list.module.css");
const ownerScreen = read("../src/app/room/list/zones/page.tsx");
const guestScreen = read("../src/app/r/[slug]/list/zones/page.tsx");
const ownerList = read("../src/app/room/list/page.tsx");
const guestList = read("../src/app/r/[slug]/list/page.tsx");
const listView = read("../src/components/room-list/room-list-view.tsx");

/** Комната, в которой заведомо есть полка без места на кадре. */
const ROOM = "emerald";
/** Её полка без места: столешница занята парфюмом, делить её нельзя (пакет 50). */
const WITHOUT_RECT = "beauty";
/** Обычная соседка с местом на кадре — с ней и сравниваются строки. */
const NEIGHBOUR = "fashion";

/**
 * Исходник без комментариев. Проверки «экран не знает про место на кадре»
 * смотрят на КОД: сами эти файлы объясняют в шапке, почему они про место не
 * знают, и на слове из объяснения сторож спотыкался бы.
 */
const code = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^[ \t]*\/\/.*$/gmu, "");

const preset = rooms.find((room) => room.id === ROOM)!;
const zones = visibleZones(preset.zones, []);

/**
 * Строки экрана ровно так, как их собирает страница: ВСЕ полки комнаты, число
 * вещей приходит числом. Полки перечисляются одним правилом — ни `withoutRect`,
 * ни числа вещей в отборе нет.
 */
const rowsOf = (counts: Record<string, number> = {}) =>
  zones.map((zone) => ({
    key: zone.key,
    label: zoneInfo(zone.key)?.label ?? zone.label,
    href: `/room/zone/${zone.key}`,
    total: counts[zone.key] ?? 0,
  }));

const draw = (props: Parameters<typeof ZoneListView>[0]) =>
  renderToStaticMarkup(createElement(ZoneListView, props));

/** Строки списка как куски разметки. */
const items = (markup: string) =>
  markup
    .split("<li")
    .slice(1)
    .map((chunk) => `<li${chunk}`);

/**
 * СКЕЛЕТ строки: разметка без единого своего слова и адреса. Остаются узлы,
 * классы и прочие атрибуты — то есть ровно то, чем одну полку можно было бы
 * отличить от другой. Совпали скелеты — значит пометки нет.
 */
const skeleton = (item: string) =>
  item.replace(/href="[^"]*"/gu, 'href="…"').replace(/>[^<>]+</gu, ">…<");

describe("в списке ВСЕ полки комнаты", () => {
  it("проверять есть что: у комнаты есть полка без места на кадре", () => {
    // Иначе весь файл позеленел бы, ничего не проверив.
    expect(zonesWithoutRect).toContain(`${ROOM}/${WITHOUT_RECT}`);
    expect(zones.map((zone) => zone.key)).toContain(WITHOUT_RECT);
  });

  it("строк столько же, сколько полок — ни одна не потерялась", () => {
    const markup = draw({ rows: rowsOf({ [NEIGHBOUR]: 3 }), moneyKey: MONEY_ZONE_KEY });
    expect(items(markup)).toHaveLength(zones.length);
  });

  it("пустая полка в списке есть, и полка без места на кадре — тоже", () => {
    // Обе в одном прогоне и с нулём вещей: это и есть та дыра, ради которой
    // тикет заводился, — пустая полка без места не видна ни в кадре, ни в списке.
    const markup = draw({ rows: rowsOf(), moneyKey: MONEY_ZONE_KEY });
    for (const zone of zones) {
      expect(markup, `${ROOM}/${zone.key}: полка пропала из списка`).toContain(
        zoneInfo(zone.key)?.label ?? zone.label,
      );
    }
  });

  it("дорога ведёт в саму полку: строка — ссылка на её экран", () => {
    const markup = draw({ rows: rowsOf(), moneyKey: MONEY_ZONE_KEY });
    expect(markup).toContain(`href="/room/zone/${WITHOUT_RECT}"`);
    // Целиком строка, а не подпись внутри неё (контракт → row.target).
    expect(css).toMatch(/\.row \{[^}]*height: 56px;/u);
  });

  it("копилка стоит последней: вещей в ней не бывает", () => {
    const markup = draw({ rows: rowsOf({ [NEIGHBOUR]: 2 }), moneyKey: MONEY_ZONE_KEY });
    const keys = zones.map((zone) => zone.key);
    expect(keys, "в комнате нет копилки — проверка бессмысленна").toContain(MONEY_ZONE_KEY);
    const last = items(markup).at(-1)!;
    expect(last).toContain(zoneInfo(MONEY_ZONE_KEY)?.label);
  });

  it("порядок остальных — комнатный, а не по числу вещей", () => {
    // Иначе номер строки перестал бы совпадать с номером полки в комнате, и
    // полки «переезжали» бы при каждом добавлении вещи.
    const markup = draw({ rows: rowsOf({ [NEIGHBOUR]: 9 }), moneyKey: MONEY_ZONE_KEY });
    const order = items(markup).map((item) => {
      const zone = zones.find((candidate) => item.includes(zoneInfo(candidate.key)?.label ?? ""));
      return zone?.key;
    });
    const expected = [
      ...zones.filter((zone) => zone.key !== MONEY_ZONE_KEY).map((zone) => zone.key),
      MONEY_ZONE_KEY,
    ];
    expect(order).toEqual(expected);
  });
});

describe("ни одна полка ничем не помечена", () => {
  it("строка полки без места совпадает с соседней СКЕЛЕТОМ разметки", () => {
    // У обеих по три вещи. Отличаться им нечем: ни классом, ни атрибутом, ни
    // лишним узлом.
    const markup = draw({
      rows: rowsOf({ [WITHOUT_RECT]: 3, [NEIGHBOUR]: 3 }),
      moneyKey: MONEY_ZONE_KEY,
    });
    const all = items(markup);
    const mine = all.find((item) => item.includes(zoneInfo(WITHOUT_RECT)!.label))!;
    const neighbour = all.find((item) => item.includes(zoneInfo(NEIGHBOUR)!.label))!;
    expect(skeleton(mine)).toBe(skeleton(neighbour));
  });

  it("и пустая — с пустой соседней", () => {
    const markup = draw({ rows: rowsOf(), moneyKey: MONEY_ZONE_KEY });
    const all = items(markup).filter((item) => !item.includes(zoneInfo(MONEY_ZONE_KEY)!.label));
    const mine = all.find((item) => item.includes(zoneInfo(WITHOUT_RECT)!.label))!;
    for (const other of all) {
      expect(skeleton(other)).toBe(skeleton(mine));
    }
  });

  it("разница «пусто / есть вещи» — единственная, и она про ВЕЩИ", () => {
    // Приглушение пустой полки контракт разрешает прямо: «полка есть, но тише».
    // Важно, что оно ходит за числом вещей, а не за местом на кадре: полная
    // полка без места читается как полная, пустая с местом — как пустая.
    const markup = draw({ rows: rowsOf({ [WITHOUT_RECT]: 3 }), moneyKey: MONEY_ZONE_KEY });
    const all = items(markup);
    const full = all.find((item) => item.includes(zoneInfo(WITHOUT_RECT)!.label))!;
    const emptyOne = all.find((item) => item.includes(zoneInfo(NEIGHBOUR)!.label))!;
    expect(skeleton(full)).not.toBe(skeleton(emptyOne));

    // А стоит первая вещь на полку — и разницы не остаётся: строка становится
    // такой же, как у любой полной соседки («комната → список → пустая полка
    // без места → первая вещь → она видна»).
    const after = draw({
      rows: rowsOf({ [WITHOUT_RECT]: 3, [NEIGHBOUR]: 3 }),
      moneyKey: MONEY_ZONE_KEY,
    });
    const filled = items(after).find((item) => item.includes(zoneInfo(NEIGHBOUR)!.label))!;
    expect(skeleton(filled)).toBe(skeleton(full));
  });

  it("экран не знает про место на кадре вовсе — знать его неоткуда", () => {
    // Самая надёжная защита от пометки: у компонента нет данных, по которым её
    // можно было бы поставить. Появится чтение — тест скажет об этом раньше,
    // чем знак доедет до экрана.
    for (const word of ["withoutRect", "zoneWithoutRect", "zoneNotOnFrame"]) {
      expect(
        code(view),
        `экран заглянул в «${word}» — отсюда до второго сорта полок один шаг`,
      ).not.toContain(word);
      expect(code(css), `в стилях появилось правило про место на кадре («${word}»)`).not.toContain(
        word,
      );
    }
    // Отдельным словом — по границам: в CSS «rect» живёт внутри
    // `flex-direction`, и голая подстрока сторожила бы не то.
    expect(code(view), "экран взял прямоугольник зоны").not.toMatch(/\brect\b/u);
  });

  it("страницы отдают полки одним правилом, без своего отбора", () => {
    for (const [name, page] of [
      ["хозяйка", ownerScreen],
      ["гость", guestScreen],
    ] as const) {
      expect(page, `${name}: полки берутся не общим правилом`).toContain(
        "visibleZones(preset.zones, room.zonesOff)",
      );
      expect(code(page), `${name}: у страницы завёлся свой отбор полок`).not.toContain(
        "withoutRect",
      );
      expect(code(page), `${name}: страница считает метки кадра, а не полки`).not.toContain(
        "sceneZones",
      );
    }
  });
});

describe("«комната списком» больше не прячет пустую полку", () => {
  const groups = [
    { key: "clothes", label: "Одежда", items: [] },
    {
      key: WITHOUT_RECT,
      label: zoneInfo(WITHOUT_RECT)!.label,
      items: [{ id: "i1", title: "Духи", photoUrl: null }],
    },
  ] as unknown as Parameters<typeof RoomListView>[0]["groups"];

  const drawList = () =>
    renderToStaticMarkup(
      createElement(RoomListView, { groups, accent: "#E7C9A9", zoneHrefBase: "/room/zone/" }),
    );

  it("полка без вещей осталась в перечне", () => {
    // Здесь стоял `filter((group) => group.items.length > 0)`. Пока у каждой
    // полки была метка, потеря была незаметной: пустую полку человек видел в
    // комнате. У полки без места на кадре комнаты нет.
    expect(drawList()).toContain("Одежда");
    // Отбор по числу вещей остался ровно один — внутри фильтра «только
    // свободные», и он про брони. Безусловного отбора нет: список выходит из
    // `useMemo` целиком, пока фильтр выключен.
    expect(code(listView)).toContain("if (!freeOnly || !takenIds) return groups;");
    expect([...code(listView).matchAll(/group\.items\.length > 0/gu)]).toHaveLength(1);
  });

  it("пустая комната остаётся пустой комнатой, а не таблицей из тринадцати «пусто»", () => {
    // Тот же довод, которым тикет 131 убрал перечень пустых полок из полосы:
    // «тринадцать „Пока пусто" — это таблица, а не комната». Полок в списке
    // столько же, но когда вещей нет ВООБЩЕ, экран говорит одну строку.
    const markup = renderToStaticMarkup(
      createElement(RoomListView, {
        groups: [{ key: "clothes", label: "Одежда", items: [] }] as never,
        accent: "#E7C9A9",
      }),
    );
    expect(markup).not.toContain("Одежда");
  });

  it("у полки есть якорь — по нему в неё приходят из списка полок", () => {
    // У гостя своего экрана полки нет, и это его дорога к вещам полки без места.
    expect(drawList()).toContain(`id="zone-${WITHOUT_RECT}"`);
    expect(guestScreen).toContain("/list#zone-");
  });

  it("страницы списка тоже перестали отбрасывать пустые полки", () => {
    for (const [name, page] of [
      ["хозяйка", ownerList],
      ["гость", guestList],
    ] as const) {
      expect(page, `${name}: пустая полка снова выпадает из списка`).not.toContain("continue;");
      expect(page).toContain("visibleZones(preset.zones, room.zonesOff)");
    }
  });
});
