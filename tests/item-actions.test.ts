// Действия с вещью: два знака на виду, остальное под «⋯» (тикет 123, турн 36b).
//
// ЗАЧЕМ ТЕСТ. Правило дизайна короткое — «на виду максимум ДВА знака» — и
// ломается оно не переписыванием компонента, а одной добавленной кнопкой:
// «ну ещё же „Скрыть цену" тут нужна». Ровно так экран и зарос в прошлый раз:
// четыре текстовых действия под каждой вещью в зоне, четыре плюс поясняющий
// абзац на витрине. Владелец назвал это «нагромождением текста» на приёмке
// 09.08. Поэтому число знаков проверяется рендером, а состав листа — списком
// ключей: и то и другое обязано падать при первой же лишней строке.
//
// Знаки сверяются с файлами дизайна путь в путь — той же меркой, что набор
// таб-бара (tests/tab-icons): «похоже» в наборе не считается, а разницу в
// полпикселя на 19 px глазами не увидеть.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  IconActionDelete,
  IconActionEdit,
  IconActionMore,
  IconActionNote,
  IconActionReturn,
  IconActionTreasury,
  IconEyeOff,
} from "../src/components/icons";
import { ItemActions, SIGN_SIZE } from "../src/components/item/item-actions";
import ru from "../messages/ru.json";
import en from "../messages/en.json";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const component = read("../src/components/item/item-actions.tsx");
const css = read("../src/components/item/item-actions.module.css");
const zoneRows = read("../src/app/room/zone/[zone]/owner-zone-grid.tsx");
const showcase = read("../src/app/room/hall/hall-showcase.tsx");

/**
 * Ключи строк листа в порядке появления, без повторов. Повтор бывает
 * законным: у строки «В сокровищницу» две ветки (положить / вернуть), и это
 * одна и та же строка листа, а не две.
 */
function sheetKeys(source: string): string[] {
  const keys = [...source.matchAll(/key:\s*"([a-z]+)"/gu)].map((match) => match[1] as string);
  return [...new Set(keys)];
}

const row = (title: string, hint: string) => ({
  key: title,
  icon: null,
  title,
  hint,
  onSelect: () => {},
});

describe("на виду ровно два знака (36b)", () => {
  it("главный знак ссылкой и «⋯» — и больше ничего", () => {
    const markup = renderToStaticMarkup(
      createElement(ItemActions, {
        primary: { icon: null, label: "Изменить", href: "/room/zone/jewelry/i/1" },
        rows: [row("В сокровищницу", "уже твоя"), row("Спрятать", "видишь только ты")],
        moreLabel: "Ещё",
      }),
    );
    // Ссылка — главный знак, кнопка — «⋯». Лист закрыт, его строк в разметке
    // нет: третий знак может появиться только третьим элементом здесь.
    expect(markup.match(/<a[\s>]/gu) ?? []).toHaveLength(1);
    expect(markup.match(/<button[\s>]/gu) ?? []).toHaveLength(1);
    expect(markup).not.toContain("В сокровищницу");
  });

  it("главный знак кнопкой — те же два", () => {
    const markup = renderToStaticMarkup(
      createElement(ItemActions, {
        primary: { icon: null, label: "Записать заметку", onSelect: () => {} },
        rows: [row("Удалить", "спросим ещё раз")],
        moreLabel: "Ещё",
      }),
    );
    expect(markup.match(/<a[\s>]/gu) ?? []).toHaveLength(0);
    expect(markup.match(/<button[\s>]/gu) ?? []).toHaveLength(2);
  });

  it("знак 19 на цели 44 — числа доски, а не подобранные заново", () => {
    expect(SIGN_SIZE).toBe(19);
    expect(css).toContain("width: var(--hit-target-min, 44px)");
    expect(css).toContain("height: var(--hit-target-min, 44px)");
    // Строка листа: знак + титул + подстрока, 52 в высоту (36b).
    expect(css).toContain("min-height: 52px");
    expect(css).toContain("font: 500 13.5px/1 var(--font-ui)");
    expect(css).toContain("font: 400 11px/1.4 var(--font-ui)");
  });

  it("подстрока есть у КАЖДОЙ строки листа: она заменила поясняющий абзац", () => {
    // `hint` в типе обязателен — необязательное поле однажды перестанут
    // заполнять, и абзац придётся возвращать.
    expect(component).toMatch(/\/\*\* Подстрока[^*]*\*\/\s*\n\s*hint: string;/u);
    expect(component).not.toContain("hint?:");
  });
});

describe("лист «⋯» комнаты: В сокровищницу · Спрятать · Удалить", () => {
  it("состав и порядок — ровно три строки", () => {
    expect(sheetKeys(zoneRows)).toEqual(["treasury", "hide", "delete"]);
  });

  it("слова строк — из словаря, а не написанные в разметке", () => {
    expect(zoneRows).toContain('title: t("itemHallAdd")');
    expect(zoneRows).toContain('title: t("itemHallRemove")');
    expect(zoneRows).toContain('title: item.hidden ? t("itemShow") : t("itemHide")');
    expect(zoneRows).toContain('title: t("itemDelete")');
    expect(zoneRows).toContain('hint: t("itemHallAddHint")');
    expect(zoneRows).toContain('hint: t("itemDeleteHint")');
  });

  it("текстовой стены под вещью больше нет", () => {
    // Прежние четыре подписи в строку. Ключи «уже моё» живы — они ушли в
    // ВОПРОС перед необратимым переходом, — а вот кнопки-слова нет.
    expect(zoneRows).not.toContain('{t("itemAlreadyMine")}');
    expect(zoneRows).not.toContain('{t("itemHide")}');
    expect(zoneRows).not.toContain('{t("itemDelete")}');
    expect(zoneRows).not.toContain('{t("itemEdit")}');
    expect(zoneRows).toContain("<ItemActions");
  });

  it("«Удалить» ходит только через сервис deleteItem — своего удаления нет", () => {
    expect(zoneRows).toContain("deleteItemAction(item.id)");
    expect(zoneRows).toContain('danger: true');
    // Опасное — тихой строкой и с вопросом: сразу из листа вещь не исчезает.
    expect(zoneRows).toContain('setConfirming({ id: item.id, kind: "delete" })');
  });
});

describe("лист «⋯» витрины: Скрыть от гостей · Вернуть в комнату · Удалить", () => {
  it("состав и порядок — ровно три строки", () => {
    expect(sheetKeys(showcase)).toEqual(["hide", "return", "delete"]);
  });

  it("слова строк — из словаря витрины", () => {
    expect(showcase).toContain('title: hidden ? t("show") : t("hide")');
    expect(showcase).toContain('title: t("remove")');
    expect(showcase).toContain('title: t("delete")');
    expect(showcase).toContain('hint: t("deleteHint")');
  });

  it("главный знак витрины — перо-заметка, оно же дорога в карточку вещи", () => {
    expect(showcase).toContain("<IconActionNote");
    expect(showcase).toContain('href: `/room/zone/${item.zone}/i/${item.id}`');
  });

  it("«Удалить» ходит через тот же сервис, что и в зоне", () => {
    expect(showcase).toContain("deleteItemAction(item.id)");
    expect(showcase).toContain("setConfirmingId(item.id)");
  });
});

describe("«Вернуть в комнату» (решение владельца 09.08)", () => {
  it("слово сменилось: вещь возвращается, а не убирается вторым удалением", () => {
    expect(ru.Hall.remove).toBe("Вернуть в комнату");
    expect(en.Hall.remove).toBe("Back to the room");
  });

  it("подсказка называет зону по имени и напоминает про цену", () => {
    expect(ru.Hall.removeHint).toBe("встанет в свою зону — в «{zone}», цена снова видна");
    expect(en.Hall.removeHint).toContain("{zone}");
    // Зона подставляется человеческим ярлыком из zones.json, а не ключом.
    expect(showcase).toContain('hint: t("removeHint", { zone: zoneLabel(item.zone) })');
  });

  it("возвращает вещь в зону тем же сервисом, что и раньше (тикет 89)", () => {
    // Механика не менялась — менялись слово и подача: inHall=false, и вещь
    // встаёт в свою зону. Своего «возврата» здесь не заводится.
    expect(showcase).toContain("toggleHallAction(item.id, false)");
  });
});

describe("поясняющий абзац умер", () => {
  it("со экрана витрины", () => {
    expect(showcase).not.toContain("actionsHint");
  });

  it("и из обоих словарей — мёртвая строка едет в разметку каждой страницы", () => {
    expect(ru.Hall).not.toHaveProperty("actionsHint");
    expect(en.Hall).not.toHaveProperty("actionsHint");
  });
});

/**
 * Файлы набора лежат В РЕПОЗИТОРИИ, а не в папке входящих пакетов: та живёт
 * на машине владельца, и тест, читающий оттуда, зелёный только у него — в CI
 * такой проверки просто нет.
 */
const PACKAGE_ICONS = path.join("design", "package", "handoff", "icons");

/** Геометрия знака: пути и круги по порядку — без цвета и размеров. */
function shapeOf(svg: string): string[] {
  const paths = [...svg.matchAll(/d="([^"]+)"/gu)].map((m) => `path:${m[1]}`);
  const circles = [
    ...svg.matchAll(/<circle[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"[^>]*r="([\d.]+)"/gu),
  ].map((m) => `circle:${m[1]},${m[2]},${m[3]}`);
  return [...paths, ...circles].sort();
}

const fromPackage = (file: string) =>
  shapeOf(readFileSync(path.join(PACKAGE_ICONS, `${file}.svg`), "utf8"));

const fromOurs = (component: Parameters<typeof createElement>[0]) =>
  shapeOf(renderToStaticMarkup(createElement(component)));

describe("семь знаков действий — путь в путь с файлами дизайна", () => {
  const pairs: ReadonlyArray<readonly [string, Parameters<typeof createElement>[0]]> = [
    ["action-edit", IconActionEdit],
    ["action-note", IconActionNote],
    ["action-delete", IconActionDelete],
    ["action-return", IconActionReturn],
    ["action-treasury", IconActionTreasury],
    ["action-more", IconActionMore],
  ];

  for (const [file, icon] of pairs) {
    it(`${file}.svg`, () => {
      expect(fromOurs(icon)).toEqual(fromPackage(file));
    });
  }

  it("седьмой знак — наш перечёркнутый глаз: совпал с файлом целиком", () => {
    // Отдельный компонент-двойник был бы способом однажды их разъединить.
    expect(fromOurs(IconEyeOff)).toEqual(fromPackage("action-hide"));
  });

  it("формат набора: сетка 24, контур 1.7, currentColor в сборке", () => {
    for (const [file] of pairs) {
      const svg = readFileSync(path.join(PACKAGE_ICONS, `${file}.svg`), "utf8");
      expect(svg, file).toContain('viewBox="0 0 24 24"');
      expect(svg, file).toContain('stroke-width="1.7"');
    }
    const markup = renderToStaticMarkup(createElement(IconActionMore, { size: SIGN_SIZE }));
    expect(markup).toContain('stroke="currentColor"');
    expect(markup).toContain(`width="${SIGN_SIZE}"`);
  });

  it("знаки действий НЕ подменили собой канон 25a", () => {
    // У карандаша, корзины и шкатулки в наборе действий другая геометрия, чем
    // у знаков того же смысла в таб-баре и углу сцены. Совпади они однажды —
    // значит кто-то переписал канон под лист действий или наоборот.
    expect(fromPackage("action-treasury")).not.toEqual(fromPackage("tab-treasury"));
  });
});
