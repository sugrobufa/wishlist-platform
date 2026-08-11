// Действия с вещью: два знака на виду, остальное под «⋯» (тикет 123, турн 36b).
// В строке списка зоны знак ОДИН — «⋯»: главный там сама строка (тикет 152).
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
  IconDate,
  IconEdit,
  IconEyeOff,
  IconGallery,
  IconMove,
  IconPool,
  IconTrash,
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

/** Только сборка строк листа витрины — без служебных `setConfirmingId(null)`. */
const sheetSource = showcase.slice(
  showcase.indexOf("const sheetRows ="),
  showcase.indexOf("\n  return ("),
);

/**
 * Перечень строк листа сокровищницы — ИЗ КОНТРАКТА (round42 вернул его в
 * `round41/item-card-owner.json` → `treasuryVariantSheet`, тикет 179). Тот же
 * лист собирают два экрана — витрина и карточка вещи, — и порядок строк у них
 * обязан быть один; раньше он держался в двух местах руками и разошёлся.
 */
const treasurySheet = (
  JSON.parse(read("../design/package/handoff/round41/item-card-owner.json")) as {
    treasuryVariantSheet: {
      rows: ReadonlyArray<{ label: string; icon: string; string: string; note?: string }>;
      mainAction: string;
    };
  }
).treasuryVariantSheet;

/** Ключ словаря контракта → наш ключ строки листа. */
const KEY_OF: Record<string, string> = {
  "Hall.remove": "return",
  "Hall.hideFromGuests": "hide",
  "Hall.delete": "delete",
};

const SHEET_KEYS = treasurySheet.rows.map((row) => KEY_OF[row.string] ?? row.string);

const contractRow = (key: string) => {
  const row = treasurySheet.rows.find((candidate) => candidate.string === key);
  if (!row) throw new Error(`строки ${key} в контракте нет`);
  return row;
};

/**
 * Исходник без комментариев. В этих файлах разбор занимает больше места, чем
 * код, и про снятые вещи в нём написано поимённо — ловить объяснение вместо
 * разметки значит запретить объяснять.
 */
const strip = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");

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

describe("на виду максимум два знака (36b)", () => {
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

  it("главного знака может не быть вовсе — тогда «⋯» остаётся один", () => {
    // ЭТО НЕ ПОСЛАБЛЕНИЕ ПРАВИЛА, А ВТОРОЙ ЕГО СЛУЧАЙ. Правило говорит «на
    // виду МАКСИМУМ два знака: главный и ⋯». В списке зоны главный не
    // рисуется: его роль играет сама строка — она ссылка в карточку вещи
    // (контракт handoff/zone-row.json: «знак в конце ОДИН»). Три цели по 44
    // — это 132 px из 335, половина строки на то, что нужно раз в месяц.
    const markup = renderToStaticMarkup(
      createElement(ItemActions, {
        rows: [row("Спрятать", "видишь только ты")],
        moreLabel: "Ещё",
      }),
    );
    expect(markup.match(/<a[\s>]/gu) ?? []).toHaveLength(0);
    expect(markup.match(/<button[\s>]/gu) ?? []).toHaveLength(1);
    // Кегль у строки зоны ОБЩИЙ — 19. Прежде она просила свой, 20, и это была
    // описка пакета: дизайн поправил контракт («глиф ⋯ — 19, как весь набор»,
    // письмо 42, тикет 163). Разницу в пиксель с соседним экраном ловил глаз.
    expect(markup).toContain(`width="${SIGN_SIZE}"`);
  });

  it("КЕГЛЬ У «⋯» ОДИН НА ВСЕ МЕСТА — своего попросить больше нечем", () => {
    // ПЕРЕВЁРНУТО (тикет 170). Сутки здесь стояло обратное: «свой кегль ещё
    // можно попросить — им живёт карточка вещи», и проп `glyph` держался
    // единственным потребителем — знаком над фотографией, который просил 20.
    //
    // Раунд 41 привёл и его к общему числу («action-more.svg 19 в цели 44»),
    // потребителей не осталось, и проп удалён. Оба места, когда-либо просившие
    // своё число, просили одно и то же 20 — и оба раза это была описка пакета,
    // которую дизайн признал сам (письмо 42 по строке зоны, раунд 41 по
    // карточке). Второго размера у знака в продукте нет.
    // Сверяется КОД, а не комментарии: про умерший проп в обоих файлах
    // написано и написано правильно — это разбор, а не разметка.
    expect(strip(component)).not.toContain("glyph");
    const card = read("../src/app/room/zone/[zone]/i/[id]/item-card.tsx");
    expect(strip(card), "карточка снова задаёт кегль знака руками").not.toContain("glyph");
    // И знак рисуется общим числом, а не набитым в разметке.
    expect(component).toContain("<IconActionMore size={SIGN_SIZE} />");
  });

  it("знак 19 на цели 44 — числа доски, а не подобранные заново", () => {
    expect(SIGN_SIZE).toBe(19);
    expect(css).toContain("width: var(--hit-target-min, 44px)");
    expect(css).toContain("height: var(--hit-target-min, 44px)");
    // Коробка знака и ЦЕЛЬ разведены (тикет 152): по умолчанию совпадают,
    // а строка зоны отдаёт знаку 32 и добирает цель псевдоэлементом — по 6
    // с каждой стороны, ровно до 44.
    expect(css).toContain("width: var(--sign-box, var(--hit-target-min, 44px));");
    expect(css).toMatch(/\.sign::after \{[^}]*transform: translate\(-50%, -50%\);/u);
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

describe("лист «⋯» витрины: Вернуть в комнату · Скрыть от гостей · Удалить насовсем", () => {
  // ПОРЯДОК СЧИТАН ИЗ КОНТРАКТА, А НЕ НАБИТ СЮДА (тикет 179). Перечень строк
  // выпал из round41 — абзац про адресата цены поглотил список, — и вернулся
  // round42 (`treasuryVariantSheet`). Пока его не было, у нас держался свой
  // порядок: «Скрыть» первой, «Вернуть» второй. Тот же лист у карточки вещи всё
  // это время шёл контрактным порядком — то есть два экрана одного листа
  // читались по-разному, и заметить это было нечем. Теперь список один и
  // читается отсюда: уедет он в контракте — покраснеет здесь.
  it("состав и порядок — ровно три строки контракта", () => {
    expect(sheetKeys(showcase)).toEqual(SHEET_KEYS);
    expect(SHEET_KEYS).toEqual(["return", "hide", "delete"]);
  });

  it("слова строк — из словаря витрины, теми ключами, что назвал контракт", () => {
    expect(showcase).toContain('title: hidden ? t("show") : t("hide")');
    expect(showcase).toContain('title: t("remove")');
    expect(showcase).toContain('title: t("delete")');
    expect(showcase).toContain('hint: t("deleteHint")');
    // Контракт зовёт строки по ключам словаря — и они совпадают с нашими до
    // одного переименования: `Hall.hideFromGuests` у нас зовётся `Hall.hide`
    // (расхождение записано в tests/messages-tone.test.ts → PACKAGE_ONLY,
    // причина 2 — «ключ у нас зовётся иначе, строка та же»). Сами СЛОВА обязаны
    // совпадать дословно, и это проверяется здесь.
    const label = (key: string) => contractRow(key).label;
    expect(ru.Hall.remove).toBe(label("Hall.remove"));
    expect(ru.Hall.hide).toBe(label("Hall.hideFromGuests"));
    expect(ru.Hall.delete).toBe(label("Hall.delete"));
    expect(ru.Hall.delete).toBe("Удалить насовсем");
  });

  it("знаки строк — те, что назвал контракт", () => {
    const OURS: Record<string, string> = {
      "action-return.svg": "IconActionReturn",
      "action-hide.svg": "IconEyeOff",
      "action-delete.svg": "IconActionDelete",
    };
    for (const row of treasurySheet.rows) {
      const ours = OURS[row.icon];
      expect(ours, `${row.label}: новый знак контракта (${row.icon})`).toBeDefined();
      expect(showcase, row.label).toContain(`<${ours} size={SIGN_SIZE} />`);
    }
    // Перечёркнутый глаз — знак действия «скрыть»; открытый стоит обратной
    // строкой у уже скрытой вещи, и это не лишний знак листа, а та же строка.
    expect(showcase).toContain("hidden ? <IconEye size={SIGN_SIZE} /> : <IconEyeOff");
  });

  it("подстроки — те объяснения, что дал контракт", () => {
    // Примечание контракта есть у двух строк из трёх, и наша подстрока обязана
    // нести его смысл. Сверяется ПО ЧАСТЯМ ПРИМЕЧАНИЯ, а не своим текстом:
    // уедет примечание в контракте — покраснеет здесь, а не разойдётся молча.
    const returnNote = contractRow("Hall.remove").note;
    expect(returnNote, "примечание строки «Вернуть в комнату» пропало из контракта").toBeTruthy();
    for (const part of (returnNote ?? "").split(", ")) {
      expect(ru.Hall.removeHint, part).toContain(part);
    }
    // Наша подстрока вдобавок называет зону по имени — «убрать» и «удалить»
    // перестают быть похожими на слух.
    expect(showcase).toContain('hint: t("removeHint", { zone: zoneLabel(item.zone) })');
    // «Единственное действие с вопросом» — подстрока обещает именно вопрос, а
    // не удаление; что вопрос и правда один, проверяет тест ниже.
    expect(contractRow("Hall.delete").note).toContain("вопрос");
    expect(ru.Hall.deleteHint).toBe("спросим ещё раз");
    // У «Скрыть от гостей» примечания в контракте нет, а подстрока у нас есть,
    // и это не самодеятельность: лист 36b собирается из «знак + титул +
    // подстрока», и она говорит то, чего контракт не сказал, — вещь у хозяйки
    // остаётся на месте, скрыта она только от гостей.
    expect(contractRow("Hall.hideFromGuests").note).toBeUndefined();
    expect(ru.Hall.hideHint).toBe("останется у тебя на витрине");
    expect(showcase).toContain('hint: hidden ? t("showHint") : t("hideHint")');
    // Пустых строк в листе нет — подстрока у всех трёх.
    expect([...sheetSource.matchAll(/hint:/gu)]).toHaveLength(3);
  });

  it("вопрос — ровно у одной строки, и это «Удалить насовсем»", () => {
    // Контракт: «единственное действие с вопросом». Две другие строки делают
    // своё сразу — обе обратимы, и лишний вопрос стоил бы им дороги назад.
    expect([...sheetSource.matchAll(/setConfirmingId\(/gu)]).toHaveLength(1);
    expect([...sheetSource.matchAll(/danger: true/gu)]).toHaveLength(1);
    const del = sheetSource.slice(sheetSource.indexOf('key: "delete"'));
    expect(del).toContain("danger: true");
    expect(del).toContain("setConfirmingId(item.id)");
    // Обратимые две ходят сразу в сервис, без промежуточного вопроса.
    const reversible = sheetSource.slice(0, sheetSource.indexOf('key: "delete"'));
    expect(reversible).toContain("toggleHallAction(item.id, false)");
    expect(reversible).toContain("setHallHiddenAction(item.id, !hidden)");
    expect(reversible).not.toContain("setConfirmingId");
  });

  it("главный знак витрины — перо-заметка, оно же дорога в карточку вещи", () => {
    expect(showcase).toContain("<IconActionNote");
    expect(showcase).toContain('href: `/room/zone/${item.zone}/i/${item.id}`');
    // И В ЛИСТЕ ОНО НЕ ПОВТОРЯЕТСЯ (контракт → `mainAction`): знак заметки
    // стоит ровно один раз, у главного действия. Дизайн отдельно отказался
    // возвращать `action-note.svg` в ряд листа — он дублировал бы главное
    // действие в двух шагах от него.
    expect([...showcase.matchAll(/<IconActionNote/gu)]).toHaveLength(1);
    expect(treasurySheet.mainAction).toContain("не дублируется");
    expect(treasurySheet.rows.map((row) => row.icon)).not.toContain("action-note.svg");
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

/**
 * Геометрия знака: пути, круги и ПРЯМОУГОЛЬНИКИ — без цвета и размеров.
 *
 * ПОЧЕМУ ДОБАВИЛСЯ `rect`. Прежде сверялись только `d="…"` и `<circle>`, и
 * это работало ровно до раунда 36: у знаков набора прямоугольников не было
 * вовсе. Теперь есть — рамка кадров, лист календаря, конверт денег, — и
 * сверка, которая их не видит, объявляла бы «путь в путь» знаку, у которого
 * оболочка разошлась с файлом целиком. Худший род зелёного теста: он не
 * молчит, он врёт.
 */
function shapeOf(svg: string): string[] {
  const paths = [...svg.matchAll(/d="([^"]+)"/gu)].map((m) => `path:${m[1]}`);
  const circles = [
    ...svg.matchAll(/<circle[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"[^>]*r="([\d.]+)"/gu),
  ].map((m) => `circle:${m[1]},${m[2]},${m[3]}`);
  const rects = [
    ...svg.matchAll(
      /<rect[^>]*x="([\d.]+)"[^>]*y="([\d.]+)"[^>]*width="([\d.]+)"[^>]*height="([\d.]+)"(?:[^>]*rx="([\d.]+)")?/gu,
    ),
  ].map((m) => `rect:${m[1]},${m[2]},${m[3]},${m[4]},${m[5] ?? "0"}`);
  return [...paths, ...circles, ...rects].sort();
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
    // У карандаша и корзины в наборе действий другая геометрия, чем у знаков
    // того же смысла в каноне: наклон грифеля другой, крышка корзины на
    // полпикселя выше. Совпади они однажды — значит кто-то переписал канон
    // под лист действий или наоборот.
    expect(fromOurs(IconActionEdit)).not.toEqual(fromOurs(IconEdit));
    expect(fromOurs(IconActionDelete)).not.toEqual(fromOurs(IconTrash));
  });

  it("витрина — ИСКЛЮЧЕНИЕ: её знак один на все три места (тикет 146)", () => {
    // ПЕРЕПИСАНО. Прежде здесь стояло обратное ожидание — `action-treasury`
    // не равен `tab-treasury`: в наборе шкатулка действия и арка бара были
    // разными предметами. Раунд 35 свёл их в один знак, и правило теперь
    // другое: у витрины во всём продукте ОДИН рисунок и три размера
    // (22 угол · 19 лист · 22 таб). Разойдись файлы — на одном экране
    // окажутся два разных знака одного места (в комнате угол сцены и таб-бар
    // видны одновременно), а в листе действий вещь уезжала бы «не туда», куда
    // ведёт знак угла.
    const sign = fromPackage("action-treasury");
    expect(fromPackage("tab-treasury"), "таб-бар разошёлся с листом действий").toEqual(sign);
    expect(fromPackage("ui-treasury"), "угол сцены разошёлся с листом действий").toEqual(sign);
    expect(fromOurs(IconActionTreasury)).toEqual(sign);
  });
});

describe("четыре знака раунда 36 — путь в путь (тикет 150)", () => {
  // ЧЕТЫРЕ ФАЙЛА, КОТОРЫХ У НАС НЕ БЫЛО. Аудит ряда (письмо 39) назвал две
  // пары в наших рядах, и дизайн прислал по файлу на каждую сторону: складчина
  // с датой в карточке гостя, «перенести» с рамкой кадров в листе комнаты.
  // Знаки живут в каноне (`IconPool` и соседи), а не в группе `IconAction*`:
  // группа заведена для строки вещи, а эти четверо в неё не входят.
  const pairs: ReadonlyArray<readonly [string, Parameters<typeof createElement>[0]]> = [
    ["action-pool", IconPool],
    ["action-date", IconDate],
    ["action-move", IconMove],
    ["action-gallery", IconGallery],
  ];

  for (const [file, icon] of pairs) {
    it(`${file}.svg`, () => {
      expect(fromOurs(icon)).toEqual(fromPackage(file));
    });
  }

  it("складчина больше НЕ круглая с делениями, а дата — не круглая вовсе", () => {
    // Смысл пары, ради которой правка и делалась: в ряду карточки гостя эти
    // двое стоят рядом, и на 19 px различать их обязана ОБОЛОЧКА. Ловим не
    // «поменялись ли пути» (это сверка выше), а само правило: круг в ряду
    // один, и он у складчины; у даты прямоугольник.
    const pool = renderToStaticMarkup(createElement(IconPool));
    const date = renderToStaticMarkup(createElement(IconDate));
    expect(pool, "у складчины снова появился замкнутый круг — это опять часы").not.toContain(
      "<circle",
    );
    expect(date, "дата потеряла прямоугольник — различать её на 19 px нечем").toContain("<rect");
    expect(pool).not.toContain("<rect");
  });

  it("точка дня — заливка `currentColor`, а не вшитый в файл цвет", () => {
    // Единственная законная заливка набора (tokens.json → icons.exception):
    // в файле дизайна она #F2EDE4, у нас обязана гореть цветом места.
    const svg = renderToStaticMarkup(createElement(IconDate));
    expect(svg).toContain('fill="currentColor"');
    expect(svg).not.toContain("#F2EDE4");
    expect(readFileSync(path.join(PACKAGE_ICONS, "action-date.svg"), "utf8")).toContain("#F2EDE4");
  });

  it("формат набора у четверых тот же: сетка 24, контур 1.7", () => {
    for (const [file] of pairs) {
      const svg = readFileSync(path.join(PACKAGE_ICONS, `${file}.svg`), "utf8");
      expect(svg, file).toContain('viewBox="0 0 24 24"');
      expect(svg, file).toContain('stroke-width="1.7"');
    }
  });
});
