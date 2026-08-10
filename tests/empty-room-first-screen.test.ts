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

const { ZoneRail } = await import("../src/components/scene/zone-rail");

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

  it("заголовок и подпись — слова макета, дословно", () => {
    expect(ru.Room?.emptyTitle).toBe("Комната твоя. Пока в ней темно");
    expect(ru.Room?.emptyBody).toBe("Каждая вещь зажигает свою полку. Первая — самая заметная");
    expect(ownerPage).toContain('{t("emptyTitle")}');
    expect(ownerPage).toContain('{t("emptyBody")}');
  });

  it("полоса света ОДНА: «Добавить вещь» из строки действий в пустой комнате нет", () => {
    // «Одно действие, не два» — обе кнопки вели в /room/add, и две главные
    // подряд читаются как выбор, которого не существует.
    expect(ru.Room?.emptyAdd).toBe("Вставить ссылку из магазина");
    expect(ownerPage).toMatch(/<Link\s+href="\/room\/add"[\s\S]{0,200}imm-empty-cta/u);
    expect(ownerPage).toMatch(/\{!emptyRoom && \(\s*<Link\s+href="\/room\/add"/u);
  });

  it("«Или начни с готового» на месте — это и есть второй способ родить вещь", () => {
    // ВЫРЕЗКА ПО ИНДЕКСАМ ЗДЕСЬ БЫЛА, И ОНА ВРАЛА. Прежний вариант резал файл
    // до `indexOf("empty={emptyRoom}\n")` — с жёстким переводом строки. На
    // Windows файл лежит с CRLF, поиск не находил НИЧЕГО, `slice` отдавал
    // почти весь файл, и тест проходил СЛУЧАЙНО. В CI с LF граница находилась
    // раньше начала, кусок выходил пустым — и падало ровно то, что локально
    // было зелёным. Жёсткому `\n` в вырезках по исходнику здесь не место.
    //
    // Проверяем по существу и без арифметики позиций: набор рисуется в слоте
    // `below` (то есть ниже него в файле) и НЕ спрятан за `!emptyRoom` —
    // пустая комната единственное место, где он и нужен.
    const belowAt = ownerPage.indexOf("below={");
    expect(belowAt, "слот below исчез — проверь разметку страницы").toBeGreaterThan(0);
    expect(ownerPage.indexOf("<StarterPack")).toBeGreaterThan(belowAt);
    expect(ownerPage).not.toMatch(/\{!emptyRoom && \([\s\S]{0,400}<StarterPack/u);
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
