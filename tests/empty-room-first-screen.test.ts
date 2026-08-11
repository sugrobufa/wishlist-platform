// Первый экран пустой комнаты (тикет 137, макет 41a раунда 33).
//
// ЗАЧЕМ ТЕСТ. Экран второй, что человек видит в продукте, — сразу после
// онбординга, — и до этой правки он собирался сам собой из трёх независимых
// тикетов: сцена гаснет (104), «начни с готового» (100), плашка про пять
// вещей (104), перечень зон (66) и знак «Списком» (129). Каждый по
// отдельности прав, вместе получилась таблица из тринадцати «Пока пусто» и
// предложение отдать ссылку на комнату, в которой нечего смотреть.
//
// ПРАВИЛО, КОТОРОЕ ЗДЕСЬ ЗАЩИЩАЕТСЯ, одно и записано в код комментарием:
// **пустая комната показывает только то, что РОЖДАЕТ первую вещь; всё, что
// живёт после вещей, появляется вместе с ними.** Ломается оно молча — новый
// блок «в пустой комнате пусть будет видно» проедет любым код-ревью, — потому
// и проверяется машиной.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  EMPTY_ROOM_FILTER,
  EMPTY_ROOM_VEIL,
  EMPTY_ZONE_FILTER,
  sceneFilter,
  sceneLayers,
} from "../src/components/scene/grading";

// Подменяются РОВНО ДВА хука — остальное берётся у настоящего пакета
// (`importOriginal`). Нужен `createTranslator`: надстрочная «комната
// обставляется · N мест» склоняется ICU-плюралом, и проверять её надо
// настоящим форматтером, а не глазами по строке словаря (тикет 199).
vi.mock("next-intl", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next-intl")>();
  const dict = (await import("../messages/ru.json")).default as unknown as Record<
    string,
    Record<string, string>
  >;
  return {
    ...actual,
    useTranslations: (ns: string) => (key: string) => dict[ns]?.[key] ?? key,
    useLocale: () => "ru",
  };
});

const { createTranslator } = await import("next-intl");
const { ZoneRail } = await import("../src/components/scene/zone-rail");
const { visibleZones } = await import("../src/components/scene/zones");
const { rooms } = await import("../src/config/design");

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const ownerPage = read("../src/app/room/page.tsx");
const rail = read("../src/components/scene/zone-rail.tsx");
const globalsCss = read("../src/app/globals.css");
const ru = JSON.parse(read("../messages/ru.json")) as Record<string, Record<string, string>>;

const ZONES = [
  { key: "clothes", label: "Одежда" },
  { key: "beauty", label: "Красота и уход" },
] as unknown as Parameters<typeof ZoneRail>[0]["zones"];

/**
 * Полоса так, как её рисует комната: с плоским списком, слотом `below` и
 * признаком пустоты.
 */
const drawRail = (empty: boolean) =>
  renderToStaticMarkup(
    createElement(
      ZoneRail,
      {
        zones: ZONES,
        viewer: "owner",
        accent: "#E7C9A9",
        roomList: createElement("p", null, "все вещи комнаты"),
        below: createElement("p", null, "блок первого шага"),
        empty,
      } as never,
      null,
    ),
  );

/**
 * Ветка слота `below` для ПУСТОЙ комнаты — блок первого шага целиком, как он
 * написан в комнате. Резать исходник приходится потому, что страница —
 * серверный компонент с базой за спиной: отрисовать её в юните нечем, а
 * порядок строк блока (тикет 199) обязан стеречь кто-то, кроме глаз.
 */
const firstStepBlock = () => {
  const from = ownerPage.indexOf("emptyRoom ? (");
  const to = ownerPage.indexOf(") : itemCount < SHARE_READY_ITEMS");
  expect(from, "ветки пустой комнаты в слоте `below` нет — проверь разметку").toBeGreaterThan(0);
  expect(to, "ветка пустой комнаты не кончается плашкой про пять вещей").toBeGreaterThan(from);
  return ownerPage.slice(from, to);
};

describe("что на пустой комнате ВИДНО (41a, сверху вниз)", () => {
  it("сцена гаснет тем же .42 и подписью-обещанием", () => {
    // Первый блок макета: тёмная сцена с пунктирными местами и строкой «свет
    // включится, когда появятся вещи». Показывает её SceneStage по признаку
    // `empty` — здесь проверяем, что комната этот признак ей отдаёт, и что
    // число затемнения по-прежнему из спецификации.
    expect(EMPTY_ROOM_FILTER).toBe("brightness(.42) saturate(.72)");
    expect(ownerPage).toMatch(/<SceneStage[\s\S]*?empty=\{emptyRoom\}/u);
    expect(ru.Scene?.emptyRoom).toBe("свет включится, когда появятся вещи");
  });

  it("надстрочная «комната обставляется · N мест» стоит ПЕРВОЙ строкой блока", () => {
    // ТИКЕТ 199, `round44/empty-room.json` → order: кадр → надстрочная →
    // заголовок → строка → полоса света. Порядок ловим индексами в исходнике:
    // строка, уехавшая под заголовок, — это уже другой экран.
    const slot = firstStepBlock();
    const at = (needle: string) => {
      const index = slot.indexOf(needle);
      expect(index, `${needle} — в блоке пустой комнаты не найдено`).toBeGreaterThan(-1);
      return index;
    };
    expect(at('t("emptyPlaces"')).toBeLessThan(at('t("emptyTitle")'));
    expect(at('t("emptyTitle")')).toBeLessThan(at('t("emptyBody")'));
    expect(at('t("emptyBody")')).toBeLessThan(at('t("emptyAdd")'));
  });

  it("число мест ЖИВОЕ — из зон комнаты, а не 13 константой", () => {
    // Пакет нарисовал «13 мест» по своему снимку rooms.json. Выключенная полка
    // исчезает вместе с мебелью (инвариант №5), и у комнаты с выключенными
    // зонами мест меньше — 13 в разметке соврало бы ей в лицо.
    expect(ownerPage).toContain(
      "const emptyPlaces = preset ? visibleZones(preset.zones, room.zonesOff).length : 0;",
    );
    expect(firstStepBlock()).toContain('t("emptyPlaces", { count: emptyPlaces })');
    // Ни в разметке рядом с надстрочной, ни в самой строке словаря числа нет.
    expect(ru.Room?.emptyPlaces).toBeTruthy();
    expect(ru.Room?.emptyPlaces).not.toMatch(/\d/u);
    expect(ru.Room?.emptyPlaces).toContain("{count, plural,");
  });

  it("на комнате с ДРУГИМ набором зон число другое — считает visibleZones", () => {
    // Тот же счёт, что у указателя зон и у «полка 02 из 13»: второго правила
    // видимости в продукте нет и заводить его нельзя.
    expect(rooms.length, "в справочнике нет ни одной комнаты").toBeGreaterThan(0);
    const preset = rooms[0]!;
    expect(visibleZones(preset.zones, [])).toHaveLength(13);
    const off = [preset.zones[0]!.key, preset.zones[1]!.key];
    expect(visibleZones(preset.zones, off)).toHaveLength(11);
  });

  it("склонение живого числа — настоящим форматтером, а не на глаз", () => {
    const t = createTranslator({
      locale: "ru",
      messages: ru,
      namespace: "Room",
    });
    expect(t("emptyPlaces", { count: 13 })).toBe("Комната обставляется · 13 мест");
    expect(t("emptyPlaces", { count: 11 })).toBe("Комната обставляется · 11 мест");
    expect(t("emptyPlaces", { count: 4 })).toBe("Комната обставляется · 4 места");
    expect(t("emptyPlaces", { count: 1 })).toBe("Комната обставляется · 1 место");
  });

  it("заголовок и подпись — слова макета, дословно", () => {
    expect(ru.Room?.emptyTitle).toBe("Комната твоя. Пока в ней темно");
    expect(ru.Room?.emptyBody).toBe("Каждая вещь зажигает свою полку. Первая — самая заметная");
    expect(ownerPage).toContain('{t("emptyTitle")}');
    expect(ownerPage).toContain('{t("emptyBody")}');
  });

  it("полоса света ОДНА: «Добавить вещь» из строки действий в пустой комнате нет", () => {
    // «Одно действие, не два» — обе кнопки вели в /room/add, и две главные
    // подряд читаются как выбор, которого не существует.
    expect(ownerPage).toMatch(/<Link\s+href="\/room\/add"[\s\S]{0,200}imm-empty-cta/u);
    expect(ownerPage).toMatch(/\{!emptyRoom && \(\s*<Link\s+href="\/room\/add"/u);
  });

  it("первое действие новичка — «Добавить первую вещь», а не поход в магазин", () => {
    // РЕШЕНИЕ ВЛАДЕЛЬЦА 11.08.2026 (тикет 190): «на самом первом экране
    // вставить ссылку из магазина — лишняя активность, там нужна просто кнопка
    // добавить свою первую вещь… простое и понятное действие, которое онбордит
    // клиента». Прежняя редакция требовала от человека с пустой комнатой и
    // пустым буфером трёх шагов чужими руками: уйти в магазин, найти вещь,
    // скопировать адрес.
    expect(ru.Room?.emptyAdd).toBe("Добавить первую вещь");
    // Ловим не только новое слово, но и НЕВОЗВРАТ старого — включая любую
    // редакцию, которая снова пошлёт человека за ссылкой первым действием.
    expect(ru.Room?.emptyAdd).not.toMatch(/ссылк|магазин/iu);

    // ПАРСЕР НЕ СПРЯТАН, А ПЕРЕСТАЛ БЫТЬ ВХОДНЫМ БИЛЕТОМ: поле ссылки стоит в
    // форме добавления первым, рядом с названием, фото и зоной.
    const addFlow = read("../src/app/room/add/add-item-flow.tsx");
    expect(addFlow, "поле ссылки исчезло из формы добавления").toMatch(/t\("urlLabel"\)/u);
    expect(ru.AddItem?.urlLabel, "AddItem.urlLabel").toBeTruthy();
  });

  it("второго способа родить вещь НЕ БЫВАЕТ: «начни с готового» снято", () => {
    // ЗДЕСЬ БЫЛА ПРОВЕРКА, ЧТО НАБОР НА МЕСТЕ. Владелец снял его 11.08.2026
    // (тикет 191): «для любой женщины это оскорбление, ведь она сама должна
    // наполнить пространство». Правило экрана от этого не изменилось — пустая
    // комната показывает только то, что РОЖДАЕТ первую вещь, — изменилось
    // число способов: он один, и он ведёт в форму добавления.
    //
    // Полный сторож невозвращения — tests/no-bulk-fill.test.ts; здесь ловится
    // ровно этот экран.
    const belowAt = ownerPage.indexOf("below={");
    expect(belowAt, "слот below исчез — проверь разметку страницы").toBeGreaterThan(0);
    const slot = ownerPage.slice(
      ownerPage.indexOf("emptyRoom ? ("),
      ownerPage.indexOf(") : itemCount < SHARE_READY_ITEMS"),
    );
    expect(slot).toContain("imm-empty-cta");
    expect([...slot.matchAll(/href="([^"]+)"/gu)].map((match) => match[1])).toEqual(["/room/add"]);
  });
});

describe("чего на пустой комнате НЕ ВИДНО — три правила невидимости", () => {
  it("плашки про пять вещей нет: она живёт от ПЕРВОЙ вещи до пятой", () => {
    // Отдавать ссылку пока нечего. Ловим порядок веток слота, а не факт
    // существования строки: сама плашка никуда не делась.
    expect(ownerPage).toMatch(
      /emptyRoom \? \([\s\S]*?\) : itemCount < SHARE_READY_ITEMS \? \([\s\S]*?imm-share-plaque/u,
    );
    const emptyBranch = ownerPage.slice(
      ownerPage.indexOf("emptyRoom ? ("),
      ownerPage.indexOf(") : itemCount < SHARE_READY_ITEMS"),
    );
    expect(emptyBranch).not.toContain("imm-share-plaque");
    expect(emptyBranch).not.toContain("sharePlaque");
  });

  it("перечня пустых полок нет: тринадцать «Пока пусто» это таблица, а не комната", () => {
    const full = drawRail(false);
    expect(full).toContain("Одежда");
    expect(full).toContain("Красота и уход");

    const empty = drawRail(true);
    expect(empty).not.toContain("Одежда");
    expect(empty).not.toContain("Красота и уход");
    expect(empty).not.toContain(ru.Scene?.summaryEmpty ?? "Пока пусто");
  });

  it("знака списка в полосе нет: пустой список — бессмыслица", () => {
    expect(drawRail(false)).toContain('aria-label="Списком"');
    expect(drawRail(true)).not.toContain('aria-label="Списком"');
    // Плоский список не смонтирован вовсе — не «скрыт стилем».
    expect(drawRail(true)).not.toContain("все вещи комнаты");
  });

  it("шер уходит вместе с ними: он живёт ПОСЛЕ вещей, а не до них", () => {
    // Доска 41a называет его в том же ряду: «всё, что живёт ПОСЛЕ вещей (шер,
    // список, счётчики), появляется вместе с ними». Дорога к адресу комнаты
    // при этом не заперта — он в настройках, рядом с ником (тикет 24).
    expect(ownerPage).toMatch(/\{!emptyRoom && <ShareButton/u);
  });
});

describe("полоса остаётся местом действий, а не исчезает", () => {
  it("знак прячется ТАМ, где рисуется, — переключатель целиком не выключен", () => {
    // Условие тикета: второе положение (строки зон) в пустой комнате тоже
    // бессмысленно, но сама полоса нужна — в ней стоит блок первого шага.
    expect(rail).toContain("const canToggle = !empty && roomList != null;");
    expect(rail).toContain("const showList = canToggle && asList;");
    expect(ownerPage).toContain("empty={emptyRoom}");
    // Список всё ещё приезжает с сервера: убыль — по признаку пустоты, а не
    // тем, что комната перестала его отдавать.
    expect(ownerPage).toMatch(/roomList=\{\s*<RoomListView/u);
  });

  it("блок первого шага стоит В ПОТОКЕ полосы, а не слоем поверх неё", () => {
    // Тикет 131: порядок блоков задаёт одна колонка. Новый `fixed`-слой
    // повторил бы ровно ту поломку, которую он чинил.
    const body = /\.imm-empty-start \{([^}]*)\}/u.exec(globalsCss)?.[1] ?? "";
    expect(body).not.toBe("");
    expect(body).not.toMatch(/position:\s*fixed/u);
    expect(body).not.toMatch(/--imm-tab-bar/u);
    const slot = ownerPage.slice(ownerPage.indexOf("<ZoneRail"), ownerPage.indexOf("</ZoneRail>"));
    expect(slot).toContain("imm-empty-start");
  });

  it("разделителя над блоком нет: отделять его не от чего", () => {
    // Волосяная линия слота `below` отделяет его от ОГЛАВЛЕНИЯ. Оглавления в
    // пустой комнате нет, и линия стала бы чертой поперёк экрана сразу под
    // кадром — в макете 41a её нет.
    const railCss = read("../src/components/scene/zone-index.module.css");
    expect(railCss).toMatch(/\.belowBare \{[\s\S]*?border-top: 0;/u);
    expect(rail).toContain("empty ? `${s.below} ${s.belowBare}` : s.below");
    expect(drawRail(true)).toContain("belowBare");
    expect(drawRail(false)).not.toContain("belowBare");
  });

  it("полоса света тянется на всю ширину: вес селектора бьёт `.imm-rail a`", () => {
    // Без второго класса `display: inline-flex` из `.imm-rail a` победил бы,
    // и линия обрезалась бы по длине слова.
    expect(globalsCss).toMatch(/\.imm-rail \.imm-empty-cta \{[\s\S]*?display: flex;/u);
    expect(globalsCss).toMatch(/\.imm-rail \.imm-empty-cta \{[\s\S]*?border-bottom: 2px solid;/u);
  });
});

// ---------- Тикет 199: приглашение делает СЦЕНА, а не кнопка ----------
//
// Пакет 44 (`empty-room.json`, турн 51d) отвечал на наш вопрос «одна кнопка
// посреди пустой полосы читается заглушкой». Ответ: лечится не второй кнопкой,
// а переносом веса наверх — кадру отдаётся всё, а кнопке остаётся быть концом
// фразы. Отсюда два правила, которые здесь и стерегутся: НАДСТРОЧНАЯ открывает
// блок, и ПОСЛЕ КНОПКИ НЕ СТОИТ НИЧЕГО.
describe("после полосы света не стоит ничего", () => {
  it("полоса света — последний узел блока", () => {
    // Довод пакета дословно: «заглушкой кнопка читается, когда под ней остаётся
    // пустое место. Здесь она последняя — пустого „после" не существует».
    // Ловим не отсутствие конкретного блока, а отсутствие ЛЮБОГО следующего:
    // именно так сюда и приезжает лишнее — новым узлом «пусть будет видно».
    const slot = firstStepBlock();
    const closed = slot.lastIndexOf("</Link>");
    expect(closed, "полосы света в блоке нет вовсе").toBeGreaterThan(0);
    const after = slot.slice(closed + "</Link>".length);
    expect(after, `после полосы света в блоке появился узел: ${after.trim()}`).not.toMatch(
      /<[A-Za-z]/u,
    );
  });

  it("действие в блоке ровно одно, и оно ведёт в форму добавления", () => {
    const slot = firstStepBlock();
    expect([...slot.matchAll(/href="([^"]+)"/gu)].map((match) => match[1])).toEqual(["/room/add"]);
  });
});

describe("блок помещается: числа замера, а не эскиза", () => {
  // ЗАПАС ОКАЗАЛСЯ НЕ ТАМ, ГДЕ ЕГО СЧИТАЛ ПАКЕТ. Он мерил блок от кромки кадра
  // с отступом 22, у нас над блоком стоят 72: отступ стопки 10 + строка
  // действий 44 + шаг 4 + отступ слота 14. Замер на 390×664 (телефон приёмки)
  // с новой надстрочной: слоту оставалось 190.8 px при 197.4 нужных — срезались
  // ровно те 2 px, которыми полоса света и светит.
  //
  // ЧИНИТЬ БЛОК БЫЛО НЕЛЬЗЯ (граница тикета 188 — «не уменьшением шрифта или
  // отступов»), да и незачем: место нашлось там, где пусто.
  it("надстрочная ростом 9, как в контракте, а не 13.5 от высоты строки страницы", () => {
    // `.overline` задаёт кегль 9, а высоту строки берёт у страницы (1.5).
    // `fit.breakdown` пакета считает надстрочную девяткой — приводим к ней.
    const body = /\.imm-empty-places \{([^}]*)\}/u.exec(globalsCss)?.[1] ?? "";
    expect(body, "правила .imm-empty-places нет").not.toBe("");
    expect(body).toMatch(/line-height:\s*1;/u);
    // Кегль по-прежнему приезжает из общего `.overline`, а не набит здесь:
    // 9 живёт в одном месте (tokens.json → type.overline).
    expect(body).not.toMatch(/font-size/u);
  });

  it("пустая строка действий не резервирует цель нажатия, которой в ней нет", () => {
    // В пустой комнате в строке нет ни одного нажимаемого узла: «Добавить вещь»
    // только на десктопе, «поделиться» живёт после вещей, знака «Списком» нет.
    // Высота там нужна ровно под пилюлю-обещание, а не под палец.
    expect(rail).toContain('empty ? "imm-row imm-row-bare" : "imm-row"');
    const bare = /\.imm-rail-bottom \.imm-row-bare \{([^}]*)\}/u.exec(globalsCss)?.[1] ?? "";
    expect(bare, "правила .imm-row-bare нет").not.toBe("");
    expect(bare).toMatch(/min-height:\s*25px;/u);
    // ТОЛЬКО ТЕЛЕФОН: правило обязано лежать внутри той же ветки, что и
    // `min-height: 44px`, — на десктопе строка и так схлопнута в ноль, а
    // резерв под палец там честный (в комнате с вещами в строке стоят кнопки).
    const phoneBranch = globalsCss.slice(
      globalsCss.indexOf("@media not all and (min-width: 1024px)"),
      // Ровно `.imm-row {` с начала строки: без якоря `indexOf` находит хвост
      // селектора `.imm-rail-bottom .imm-row {` внутри самой же ветки.
      globalsCss.indexOf("\n.imm-row {"),
    );
    expect(phoneBranch).toContain(".imm-rail-bottom .imm-row-bare");
    expect(phoneBranch).toContain("min-height: 44px");
  });

  it("комната С ВЕЩАМИ метки не получает — указатель зон стоит там же", () => {
    // Условие тикетов 188 и 199 слово в слово: «полоса не выросла, указатель
    // зон на месте». Строка действий там полна, и её 44 px — настоящая цель
    // нажатия, а не воздух.
    expect(drawRail(true)).toContain("imm-row-bare");
    expect(drawRail(false)).not.toContain("imm-row-bare");
  });

  it("блок не починен уменьшением своих чисел", () => {
    // Тот же замок, что в tests/rail-overflow.test.ts, но с той стороны, с
    // которой в блок пришла новая строка: числа макета 41a не двигаются.
    expect(globalsCss).toMatch(/\.imm-empty-title \{[\s\S]*?font-size: 22px;/u);
    expect(globalsCss).toMatch(/\.imm-empty-body \{[\s\S]*?font-size: 12\.5px;/u);
    expect(globalsCss).toMatch(/\.imm-empty-start \{[\s\S]*?gap: 10px;/u);
    expect(globalsCss).toMatch(/\.imm-rail \.imm-empty-cta \{[\s\S]*?padding: 0 2px 12px;/u);
  });
});

describe("три затемнения продукта не перемножаются", () => {
  // Пустая СЦЕНА (.42, тикет 137), пустая ЗОНА (.56, тикет 35b) и вечер —
  // разные слои с разными смыслами. На перемножении уже обжигались дважды:
  // тикет 107 (ночь × пустота = 0.040 светлоты) и 35b.
  it("пустая комната и пустая зона — по одному фильтру за раз, а не два", () => {
    // В пустой комнате пусты и все её зоны: .42 × .56 дали бы 0.235 от кадра.
    const both = sceneFilter("day", "warm", true, "day", true);
    expect(both).toBe(EMPTY_ROOM_FILTER);
    expect(both).not.toContain(EMPTY_ZONE_FILTER);
    expect(sceneFilter("day", "warm", false, "day", true)).toBe(EMPTY_ZONE_FILTER);
  });

  it("вечер и пустая комната складываются строкой, а не удваивают затемнение", () => {
    // Слагаемых ровно два и каждое своё: рецепт вечера от базы плюс .42.
    // Третьего затемнения в строке быть не может.
    const dusk = sceneFilter("dusk", "warm", true, "day");
    expect(dusk.match(/brightness\(/gu) ?? []).toHaveLength(2);
    expect(dusk.endsWith(EMPTY_ROOM_FILTER)).toBe(true);
    expect(dusk).not.toContain(EMPTY_ZONE_FILTER);
  });

  it("вуаль пустоты одна: вуали пустой комнаты и пустой зоны вместе не кладутся", () => {
    // Две вуали `multiply` перемножаются ровно как две яркости, поэтому
    // вуаль зоны — отдельный слой сцены, и в пустой комнате его нет вовсе.
    const layers = sceneLayers("dusk", "warm", true, "day");
    expect(layers.filter((layer) => layer === EMPTY_ROOM_VEIL)).toHaveLength(1);
    expect(layers.at(-1)).toEqual(EMPTY_ROOM_VEIL);
  });
});
