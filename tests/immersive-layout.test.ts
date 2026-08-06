import { describe, it, expect } from "vitest";
import tokensJson from "@design/tokens.json";
import {
  hitTargetMin,
  rooms,
  roomsContract,
  scene,
  zoneHiddenByProduct,
} from "../src/config/design";
import {
  sceneSize,
  viewportCenter,
  zoneCenterAfterCamera,
  zoneInsideViewport,
  zoneScenePercent,
  type SceneView,
} from "../src/components/scene/camera";
import { visibleZones } from "../src/components/scene/zones";
import {
  clearBand,
  immersiveLayout,
  railBand,
  railContent,
  sceneBand,
  sceneGap,
  sceneVisible,
  zoneHitBox,
  zoneOnScreen,
  type Box,
  type Screen,
} from "../src/components/scene/immersive-layout";

// Раскладка «комната во весь экран» (тикеты 24 и 42) — и достижимость зон
// (тикет 40).
//
// ЧЕМ ЭТОТ ФАЙЛ БЫЛ РАНЬШЕ И ПОЧЕМУ ПЕРЕПИСАН ДВАЖДЫ.
//
// Раунд первый (тикет 40). До смены системы координат файл требовал: «все 13
// зон каждой из 10 комнат остаются на экране ЦЕЛИКОМ». Это было верно, но не
// потому, что раскладка хороша, — а потому что разметка жила в координатах окна
// 430 и физически не могла выйти за него: всё, что стояло правее, при разметке
// прижималось к краю. Тест проверял не раскладку, а собственную обрезку
// контракта. Раунды 4–5 перенесли разметку в координаты кадра 630 (ADR-0006),
// 46 зон встали правее прежней стены 430, и 33 из них в покое не видны на
// телефоне вовсе. Это НАМЕРЕННО: окно 430 ездит по кадру, а не обрезает его.
//
// Раунд второй (тикет 42). Десктоп ВПИСЫВАЛ кадр целиком, и оттого на 1920
// вокруг комнаты стояла чёрная рамка в 234 px с каждой стороны. Владелец
// трижды просил комнату во весь экран; развилку закрыли в пользу буквы
// контракта: кадр ЗАПОЛНЯЕТ окно, пропорцию держит КРОП, а не поля. После этого
// пять здешних проверок описывали мир, которого больше нет («окно равно кадру»,
// «все 130 получают 44×44 на любом окне», «зон под полосами нет», «кадр не
// шире экрана»). Переписаны, а не ослаблены — что именно осталось под тестом,
// перечислено ниже.
//
// ТРЕБОВАНИЕ: **все зоны ДОСТИЖИМЫ** — теперь на ОБЕИХ раскладках одинаково.
// Дорог ровно две, и каждая зона обязана иметь хотя бы одну:
//   1. через кадр — если зона попадает в окно, у неё есть настоящая цель
//      нажатия в полные 44×44;
//   2. через указатель зон (тикет 34) — он строится по ДАННЫМ, а не по
//      видимости, поэтому доводит и до зоны за краем окна; наезд камеры
//      доезжает до неё и ставит её в середину экрана.
// Ослабления порога здесь нет: там, где зона видна, требования к цели прежние.
// Что действительно исчезло — обещание «видно всё сразу», которого раскладка
// никогда не давала, а давала обрезка карты.
//
// РАЗНИЦА МЕЖДУ ВИДАМИ. На телефоне список «заоконных» зон — свойство КАДРА:
// окно всегда показывает 430 из 630 px, на любом экране одни и те же 33 зоны.
// На десктопе кроп — свойство ОКНА: сколько кадра срежется, решает пропорция
// окна, а сколько зон при этом недоберут до 44 px — ещё и его размер. Поэтому
// десктопные числа записаны таблицей по вьюпортам, а не одним списком.
//
// Если тест упал — либо раскладка потеряла зону, либо указатель перестал быть
// полным списком, либо вокруг комнаты снова появились поля. Всё это баг, а не
// повод поправить ожидания.

const tokens = tokensJson as unknown as {
  layout: {
    phoneImmersive: { topVeil: number; railBottom: number; titleTop: number };
    desktopImmersive: { topVeil: number; sidePad: number };
  };
  spacing: { gutter: number };
};

/** Вьюпорты живой проверки из тикета: телефон 430×932, десктоп 1280. */
const PHONE: Screen = { w: 430, h: 932 };
const DESKTOP: Screen = { w: 1280, h: 800 };

/** Округления процентов в CSS дают доли пикселя — на них не ловим. */
const EPS = 0.05;

/** Телефонные экраны обхода: тот же 430 с адресной строкой и что поменьше. */
const PHONE_SCREENS: Screen[] = [
  PHONE,
  { w: 430, h: 745 },
  { w: 390, h: 844 },
  { w: 375, h: 667 },
  { w: 360, h: 640 },
];

/**
 * Десктопные экраны обхода — от порога раскладки (`@media min-width: 1024px`)
 * до 1920. Пропорция окна здесь и есть главная переменная: у кадра она 1.792
 * (1120:625), поэтому 16:9 срезается почти не срезаясь, 16:10 теряет по 5.4%
 * ширины с каждой стороны, а 4:3 — по 12.8%.
 */
const DESKTOP_SCREENS: Screen[] = [
  { w: 1024, h: 768 },
  { w: 1280, h: 720 },
  DESKTOP,
  { w: 1366, h: 768 },
  { w: 1440, h: 900 },
  { w: 1536, h: 864 },
  { w: 1920, h: 1080 },
];

/** Все 130 зон контракта: 13 в каждой из 10 комнат (money тоже — ADR-0003). */
const allZones = roomsContract.rooms.flatMap((room) =>
  room.zones.map((zone) => ({
    id: `${room.id}/${zone.key}`,
    roomId: room.id,
    key: zone.key,
    rect: zone.rect,
  })),
);

type Zone = (typeof allZones)[number];

/**
 * 33 зоны, до которых на телефоне в покое не дотянуться пальцем: они целиком
 * лежат правее правого края окна (кадр 12…442). Список закрытый и именной —
 * если зона уедет за окно незаметно, тест это покажет; если вернётся, тоже.
 *
 * Все 33 стоят в правой трети кадра, куда прежняя система координат размечать
 * не давала: книжные шкафы, вертушки, вазы, часовницы и банки с деньгами.
 */
const BEYOND_PHONE_WINDOW = [
  "cream/events",
  "cream/books",
  "cream/music",
  "cream/flowers",
  "warm/home",
  "warm/books",
  "warm/flowers",
  "lux/books",
  "lux/flowers",
  "lux/home",
  "emerald/books",
  "emerald/music",
  "emerald/flowers",
  "bold/books",
  "bold/flowers",
  "cottage/books",
  "cottage/flowers",
  "gamer/watches",
  "gamer/music",
  "gamer/books",
  "gamer/money",
  "sport/books",
  "sport/music",
  "sport/sport",
  "sport/money",
  "study/watches",
  "study/books",
  "study/music",
  "study/money",
  "loft/books",
  "loft/sport",
  "loft/watches",
  "loft/money",
];

/**
 * Достижимость пальцем на ДЕСКТОПЕ, по вьюпортам (тикет 42).
 *
 * `bleedX` — сколько кадра ушло за КАЖДЫЙ боковой край окна; `full` — зон с
 * полными 44×44; `short` — цель есть, но меньше 44 хотя бы по одной стороне;
 * `gone` — цель срезана в ноль. Сумма трёх всегда 130: молча потеряться нельзя
 * ни одной, дорога к `short` и `gone` — указатель зон (проверено ниже).
 *
 * Читать таблицу так: пока пропорция окна близка к пропорции кадра (16:9),
 * кроп меньше полупроцента и пальцем достаются ВСЕ 130. На 16:10 срезается по
 * 5.4% ширины, и правый край окна начинает подъедать зоны у правой стены
 * комнаты. На 4:3 — по 12.8%, и десктоп становится похож на телефон.
 */
const DESKTOP_REACH: Array<{
  screen: Screen;
  bleedX: number;
  full: number;
  short: number;
  gone: number;
}> = [
  { screen: { w: 1024, h: 768 }, bleedX: 176.128, full: 105, short: 12, gone: 13 },
  { screen: { w: 1280, h: 720 }, bleedX: 5.12, full: 130, short: 0, gone: 0 },
  { screen: DESKTOP, bleedX: 76.8, full: 125, short: 5, gone: 0 },
  { screen: { w: 1366, h: 768 }, bleedX: 5.128, full: 130, short: 0, gone: 0 },
  { screen: { w: 1440, h: 900 }, bleedX: 86.4, full: 127, short: 3, gone: 0 },
  { screen: { w: 1536, h: 864 }, bleedX: 6.144, full: 130, short: 0, gone: 0 },
  { screen: { w: 1920, h: 1080 }, bleedX: 7.68, full: 130, short: 0, gone: 0 },
];

/**
 * Пять зон, которым на 1280×800 правый край окна не даёт полных 44×44. Список
 * именной по той же причине, что телефонный: незаметно приехавшая сюда шестая
 * зона — это ухудшение, а не мелочь.
 */
const DESKTOP_1280_SHORT = [
  "lux/home",
  "gamer/money",
  "sport/money",
  "study/watches",
  "loft/money",
];

/** 1024×768 — худший десктоп у порога раскладки: 12 зон недобирают до 44 px… */
const DESKTOP_1024_SHORT = [
  "warm/home",
  "warm/flowers",
  "lux/bags",
  "lux/books",
  "emerald/fashion",
  "bold/flowers",
  "sport/music",
  "sport/travel",
  "study/music",
  "study/travel",
  "study/money",
  "loft/sport",
];

/** …а 13 срезаны краем окна начисто. Все 25 — на указателе зон. */
const DESKTOP_1024_GONE = [
  "cream/events",
  "cream/flowers",
  "lux/flowers",
  "lux/home",
  "emerald/anything",
  "emerald/flowers",
  "cottage/flowers",
  "gamer/money",
  "sport/money",
  "study/watches",
  "study/books",
  "loft/travel",
  "loft/money",
];

/**
 * Зоны, целиком спрятанные под полосой интерфейса на десктопе — по вьюпортам.
 * Почти везде это одна `study/money` (зона денег, продукт её не показывает);
 * на 1280×720 нижняя полоса накрывает ещё и `cream/anything`. Список именной:
 * следующая показываемая зона, уехавшая под полосу целиком, обязана быть
 * замечена, а не приехать молча.
 */
const DESKTOP_SWALLOWED_BY_RAIL: Record<string, string[]> = {
  "1024×768": ["study/money"],
  "1280×720": ["cream/anything", "study/money"],
  "1280×800": ["study/money"],
  "1366×768": ["study/money"],
  "1440×900": ["study/money"],
  "1536×864": ["study/money"],
  "1920×1080": [],
};

function right(box: Box): number {
  return box.left + box.width;
}

function bottom(box: Box): number {
  return box.top + box.height;
}

/** Есть ли у зоны настоящая цель нажатия на этом экране (не срезана в ноль). */
function tappable(rect: Zone["rect"], view: SceneView, screen: Screen) {
  const hit = zoneHitBox(rect, view, screen);
  return hit.width > 0 && hit.height > 0;
}

/** Полные 44×44 — цель, которой хватает пальцу (rooms.json → hitTargetMin). */
function fullTarget(rect: Zone["rect"], view: SceneView, screen: Screen) {
  const hit = zoneHitBox(rect, view, screen);
  return hit.width >= hitTargetMin - EPS && hit.height >= hitTargetMin - EPS;
}

/** Задел ли зону кроп: её прямоугольник вылезает за видимую часть сцены. */
function clippedByWindow(rect: Zone["rect"], view: SceneView, screen: Screen) {
  const vis = sceneVisible(view, screen);
  const box = zoneOnScreen(rect, view, screen);
  return (
    box.left < vis.left - EPS ||
    right(box) > right(vis) + EPS ||
    box.top < vis.top - EPS ||
    bottom(box) > bottom(vis) + EPS
  );
}

/** Указатель зон (`ZoneIndex`) — тот же список, что строит сцена: 122 зоны. */
const listedInIndex = new Set(
  rooms.flatMap((room) => visibleZones(room.zones, []).map((zone) => `${room.id}/${zone.key}`)),
);

/**
 * Цель нажатия зоны в ПРОИЗВОЛЬНОЙ коробке сцены — та же арифметика, что в
 * `zoneHitBox`: доля сцены × коробка, добивка до `hitTargetMin`, обрезка
 * видимой частью. Нужна, чтобы сравнивать нынешнюю раскладку с прежними,
 * а не пересказывать их формулы трижды.
 */
function hitBoxIn(rect: Zone["rect"], view: SceneView, band: Box, clip: Box): Box {
  const p = zoneScenePercent(rect, view);
  const box = {
    left: band.left + (p.left / 100) * band.width,
    top: band.top + (p.top / 100) * band.height,
    width: (p.width / 100) * band.width,
    height: (p.height / 100) * band.height,
  };
  const growX = Math.max(0, hitTargetMin - box.width) / 2;
  const growY = Math.max(0, hitTargetMin - box.height) / 2;
  const left = Math.max(clip.left, box.left - growX);
  const top = Math.max(clip.top, box.top - growY);
  return {
    left,
    top,
    width: Math.max(0, Math.min(right(clip), box.left + box.width + growX) - left),
    height: Math.max(0, Math.min(bottom(clip), box.top + box.height + growY) - top),
  };
}

/**
 * Цель нажатия в раскладке ДО тикета 24 — сцена стояла блоком в колонке:
 * телефон 430×352, десктоп 1120×625, обрезка та же (`overflow: hidden`).
 * Нужна, чтобы утверждение «нажимать стало не хуже» было проверкой, а не
 * обещанием.
 */
function legacyHitBox(rect: Zone["rect"], view: SceneView): Box {
  const { w, h } = sceneSize(view);
  const band = { left: 0, top: 0, width: w, height: h };
  return hitBoxIn(rect, view, band, band);
}

/**
 * Коробка сцены в раскладке ДО тикета 42 — десктоп ВПИСЫВАЛ кадр между
 * полосами (формула `fit`, та же, что осталась у телефона). На 1280×800 это
 * 949.8×530 против нынешних 1433.6×800.
 *
 * Кадр целиком лежал внутри окна, поэтому обрезка совпадала с самой коробкой:
 * ничего не срезалось, но и комната была меньше окна на 234 px с каждой
 * стороны — ровно та чёрная рамка, из-за которой тикет 42 и случился.
 */
function preCoverBand(screen: Screen): Box {
  const l = immersiveLayout.desktop;
  const width = Math.min(screen.w, Math.max(0, screen.h - l.railTop - l.railBottom - l.gap) * l.ar);
  return { left: (screen.w - width) / 2, top: l.railTop, width, height: width / l.ar };
}

function preCoverHitBox(rect: Zone["rect"], screen: Screen): Box {
  const band = preCoverBand(screen);
  return hitBoxIn(rect, "desktop", band, band);
}

describe("раскладка «во весь экран»: числа из пакета", () => {
  it("полосы интерфейса и зазор взяты из tokens.json, а не придуманы", () => {
    expect(immersiveLayout.phone.railTop).toBe(tokens.layout.phoneImmersive.topVeil);
    expect(immersiveLayout.phone.railBottom).toBe(tokens.layout.phoneImmersive.railBottom);
    expect(immersiveLayout.phone.titleTop).toBe(tokens.layout.phoneImmersive.titleTop);
    expect(immersiveLayout.desktop.railTop).toBe(tokens.layout.desktopImmersive.topVeil);
    expect(immersiveLayout.desktop.titleTop).toBe(tokens.layout.desktopImmersive.sidePad);
    // Нижняя полоса в пакете одна (телефонная): в ней те же кнопки на обоих видах.
    expect(immersiveLayout.desktop.railBottom).toBe(tokens.layout.phoneImmersive.railBottom);
    for (const view of ["phone", "desktop"] as const) {
      expect(immersiveLayout[view].gap).toBe(tokens.spacing.gutter);
    }
    // Контрольные значения контракта — чтобы правка пакета была видна в диффе.
    expect([immersiveLayout.phone.railTop, immersiveLayout.desktop.railTop]).toEqual([190, 132]);
    expect(immersiveLayout.phone.railBottom).toBe(116);
    expect(immersiveLayout.phone.gap).toBe(22);
  });

  it("кадр держит пропорцию сцены из rooms.json, а не пропорцию экрана", () => {
    const phone = sceneBand("phone", PHONE);
    const desktop = sceneBand("desktop", DESKTOP);
    expect(phone.width / phone.height).toBeCloseTo(scene.phone.w / scene.phone.h, 6);
    expect(desktop.width / desktop.height).toBeCloseTo(scene.desktop.w / scene.desktop.h, 6);
    // Телефон 430×932: кадр берёт всю ширину и встаёт под верхнюю полосу.
    expect(phone).toEqual({ left: 0, top: 190, width: 430, height: 352 });
  });

  it("две раскладки названы одним словом: телефон вписывает, десктоп заполняет", () => {
    expect(immersiveLayout.phone.fit).toBe("fit");
    expect(immersiveLayout.desktop.fit).toBe("cover");
  });
});

// ---------------------------------------------------------------------------
// ТРЕБОВАНИЕ ТИКЕТА 42: комната от края до края, полей вокруг неё нет.
// ---------------------------------------------------------------------------
describe("комната во весь экран: кроп вместо полей (тикет 42)", () => {
  it("десктоп: полей вокруг сцены нет — ноль со всех четырёх сторон", () => {
    // Это и есть требование тикета, записанное числом. Владелец трижды просил
    // комнату во весь экран; вписанный кадр давал на 1920 чёрную рамку в 234 px
    // с каждой стороны, и рамка была ровно тем, что он видел.
    for (const screen of DESKTOP_SCREENS) {
      expect(sceneGap("desktop", screen), `${screen.w}×${screen.h}`).toEqual({
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
      });
    }
    // И на сверхшироком окне тоже: там кроп идёт по другой стороне (кадр
    // вылезает вверх и вниз), но полей всё равно нет.
    expect(sceneGap("desktop", { w: 2560, h: 1080 })).toEqual({
      left: 0,
      right: 0,
      top: 0,
      bottom: 0,
    });
  });

  it("десктоп: кадр не меньше окна ни по одной стороне — это и есть cover", () => {
    for (const screen of DESKTOP_SCREENS) {
      const band = sceneBand("desktop", screen);
      const where = `${screen.w}×${screen.h}`;
      expect(band.width, `${where} ширина кадра`).toBeGreaterThanOrEqual(screen.w - EPS);
      expect(band.height, `${where} высота кадра`).toBeGreaterThanOrEqual(screen.h - EPS);
      // Видимая часть сцены на десктопе — весь экран, без остатка.
      expect(sceneVisible("desktop", screen), where).toEqual({
        left: 0,
        top: 0,
        width: screen.w,
        height: screen.h,
      });
    }
    // Контрольные числа: 1280×800 (16:10) и 1920×1080 (16:9). Кадр вылезает
    // вбок, по высоте садится ровно в окно.
    const wide = sceneBand("desktop", DESKTOP);
    expect(wide.left).toBeCloseTo(-76.8, 4);
    expect(wide.width).toBeCloseTo(1433.6, 4);
    expect(wide.top).toBeCloseTo(0, 4);
    expect(wide.height).toBeCloseTo(800, 4);
    const full = sceneBand("desktop", { w: 1920, h: 1080 });
    expect(full.left).toBeCloseTo(-7.68, 4);
    expect(full.width).toBeCloseTo(1935.36, 4);
    expect(full.top).toBeCloseTo(0, 4);
    expect(full.height).toBeCloseTo(1080, 4);
  });

  it("кроп делится поровну: центр кадра совпадает с центром экрана", () => {
    // Без этого рассыпается ДОРОГА 2: наезд камеры целится в центр СЦЕНЫ, и
    // только совпадение центров делает «зона в середине сцены» и «зона в
    // середине экрана» одним и тем же. Композиция тоже не съезжает.
    for (const screen of [...DESKTOP_SCREENS, { w: 2560, h: 1080 }]) {
      const band = sceneBand("desktop", screen);
      const where = `${screen.w}×${screen.h}`;
      expect(band.left + band.width / 2, `${where} центр по x`).toBeCloseTo(screen.w / 2, 6);
      expect(band.top + band.height / 2, `${where} центр по y`).toBeCloseTo(screen.h / 2, 6);
    }
  });

  it("сколько кадра видно: доля — это отношение пропорций окна и комнаты", () => {
    // Кроп не выдуман раскладкой, он выводится: видно min(1, ar_окна/ar_кадра)
    // ширины кадра. Отсюда и вся десктопная таблица достижимости ниже.
    const frameAr = immersiveLayout.desktop.ar;
    for (const screen of DESKTOP_SCREENS) {
      const band = sceneBand("desktop", screen);
      const share = screen.w / band.width;
      expect(share, `${screen.w}×${screen.h}`).toBeCloseTo(
        Math.min(1, screen.w / screen.h / frameAr),
        6,
      );
    }
    // Числами: 16:9 показывает 99.2% кадра, 16:10 — 89.3%, 4:3 — 74.4%.
    const shown = (screen: Screen) => (screen.w / sceneBand("desktop", screen).width) * 100;
    expect(shown({ w: 1920, h: 1080 })).toBeCloseTo(99.2, 1);
    expect(shown(DESKTOP)).toBeCloseTo(89.3, 1);
    expect(shown({ w: 1024, h: 768 })).toBeCloseTo(74.4, 1);
    // Телефон видит 68.3% — десктоп 4:3 ближе всего к нему, и это не совпадение:
    // и там и там окно ездит по кадру, а не обрезает карту.
    expect((scene.phone.w / scene.phone.image.w) * 100).toBeCloseTo(68.3, 1);
  });

  it("телефон вписан по-прежнему: по бокам нулей, сверху и снизу — полосы", () => {
    // Телефонная раскладка тикетом 42 не тронута ни на пиксель: кадр стоит
    // между полосами, поля сверху/снизу — это они и есть.
    expect(sceneGap("phone", PHONE)).toEqual({ left: 0, right: 0, top: 190, bottom: 390 });
    for (const screen of PHONE_SCREENS) {
      const gap = sceneGap("phone", screen);
      const where = `${screen.w}×${screen.h}`;
      expect(gap.left, `${where} слева`).toBe(0);
      expect(gap.right, `${where} справа`).toBe(0);
      expect(gap.top, `${where} сверху`).toBe(immersiveLayout.phone.railTop);
    }
  });

  it("полосы интерфейса лежат НА комнате, а не вокруг неё", () => {
    // Смысл требования: 44 px отступа полосы отмеряются от края КОМНАТЫ, и он
    // же край окна. Вернись вписывание — полоса поедет по чёрному полю, и это
    // упадёт здесь (CSS ссылается сюда: globals.css → .imm-rail).
    for (const screen of DESKTOP_SCREENS) {
      const rail = railBand("desktop", screen);
      const content = railContent("desktop", screen);
      const vis = sceneVisible("desktop", screen);
      const where = `${screen.w}×${screen.h}`;
      expect(rail.left, `${where} левый край полосы`).toBeGreaterThanOrEqual(vis.left - EPS);
      expect(rail.left + rail.width, `${where} правый край полосы`).toBeLessThanOrEqual(
        right(vis) + EPS,
      );
      // Обе полосы по вертикали тоже лежат на комнате: сверху 0…132, снизу
      // последние 116 px окна — и то и другое внутри видимой сцены.
      expect(vis.top, `${where} верх комнаты`).toBeLessThanOrEqual(EPS);
      expect(bottom(vis), `${where} низ комнаты`).toBeGreaterThanOrEqual(screen.h - EPS);
      // Содержимое полосы отступает от края комнаты ровно на sidePad = 44.
      expect(content.left - vis.left, `${where} отступ содержимого`).toBeCloseTo(
        immersiveLayout.desktop.sidePad,
        6,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// ГЛАВНОЕ ТРЕБОВАНИЕ: все зоны достижимы. Две дороги, ни одна зона не мимо.
// ---------------------------------------------------------------------------
describe("все 130 зон достижимы: кадром или указателем (тикет 40)", () => {
  it("130 зон в контракте — по 13 на комнату", () => {
    expect(allZones).toHaveLength(130);
    expect(roomsContract.rooms).toHaveLength(10);
  });

  it("телефон: 97 зон достаются пальцем, 33 стоят за краем окна — и это все 130", () => {
    // Разбиение, а не порог: у каждой зоны ровно одно из двух состояний, и
    // сумма обязана давать 130. Молча потеряться нельзя ни одной.
    const beyond = allZones.filter(({ rect }) => !tappable(rect, "phone", PHONE));
    const reachableByFinger = allZones.filter(({ rect }) => tappable(rect, "phone", PHONE));
    expect(beyond.map((z) => z.id)).toEqual(BEYOND_PHONE_WINDOW);
    expect(beyond).toHaveLength(33);
    expect(reachableByFinger).toHaveLength(97);
    expect(beyond.length + reachableByFinger.length).toBe(allZones.length);

    // «За краем окна» — это ровно геометрия кадра, а не случайность раскладки:
    // окно показывает кадр с 12 по 442, и у всех 33 левый край не ближе 442.
    const windowRight = -scene.phone.image.x + scene.phone.w;
    expect(windowRight).toBe(442);
    for (const { id, rect } of beyond) {
      expect(rect.x, `${id} начинается правее окна`).toBeGreaterThanOrEqual(windowRight);
    }
  });

  it("десктоп: на 1280×800 пальцем достаются 125 зон, 5 срезаны краем окна", () => {
    // Прежде здесь стояло «окно равно кадру, поэтому пальцем достаются ВСЕ
    // 130»: десктоп вписывал кадр целиком, и второй дороги там не требовалось.
    // С кропом (тикет 42) десктоп живёт по телефонному правилу — зона либо
    // получает полные 44×44, либо уходит под край окна и достаётся указателем.
    const full = allZones.filter(({ rect }) => fullTarget(rect, "desktop", DESKTOP));
    const short = allZones.filter(({ rect }) => !fullTarget(rect, "desktop", DESKTOP));
    expect(full).toHaveLength(125);
    expect(short.map((z) => z.id)).toEqual(DESKTOP_1280_SHORT);
    expect(full.length + short.length).toBe(allZones.length);

    // Все пятеро — у ПРАВОЙ стены комнаты, их подъедает правый край окна.
    // Ни одна не срезана в ноль: на 1280×800 самая узкая цель — 15.7 px.
    const vis = sceneVisible("desktop", DESKTOP);
    for (const { id, rect } of short) {
      const box = zoneOnScreen(rect, "desktop", DESKTOP);
      expect(right(box), `${id} упирается в правый край окна`).toBeGreaterThan(right(vis));
      expect(zoneHitBox(rect, "desktop", DESKTOP).width, `${id} ширина цели`).toBeGreaterThan(0);
    }
  });

  it("десктоп: разбиение по вьюпортам — сумма всегда 130", () => {
    // Здесь и записано, «сколько пальцем, сколько указателем» на десктопе:
    // на 16:9 — 130 и 0, на 1280×800 — 125 и 5, на 1024×768 — 105 и 25.
    for (const row of DESKTOP_REACH) {
      const where = `${row.screen.w}×${row.screen.h}`;
      const band = sceneBand("desktop", row.screen);
      expect((band.width - row.screen.w) / 2, `${where} вылет кадра вбок`).toBeCloseTo(
        row.bleedX,
        3,
      );
      const full = allZones.filter(({ rect }) => fullTarget(rect, "desktop", row.screen));
      const gone = allZones.filter(({ rect }) => !tappable(rect, "desktop", row.screen));
      const short = allZones.filter(
        ({ rect }) =>
          tappable(rect, "desktop", row.screen) && !fullTarget(rect, "desktop", row.screen),
      );
      expect(full.length, `${where} полные 44×44`).toBe(row.full);
      expect(short.length, `${where} цель меньше 44`).toBe(row.short);
      expect(gone.length, `${where} срезаны в ноль`).toBe(row.gone);
      expect(full.length + short.length + gone.length, `${where} сумма`).toBe(allZones.length);
    }
  });

  it("десктоп 1024×768 — худший случай у порога раскладки, и он именной", () => {
    // 1024 — ровно та ширина, с которой включается десктопная раскладка
    // (@media min-width: 1024px). Пропорция 4:3 срезает по 12.8% с каждой
    // стороны, и десктоп становится телефоном: 25 зон из 130 уходят на
    // указатель. Это ДОЛГ, а не приёмка (записан в Comments тикета 42):
    // либо раскладка на узких окнах, либо принять указатель как дорогу.
    const screen: Screen = { w: 1024, h: 768 };
    const gone = allZones.filter(({ rect }) => !tappable(rect, "desktop", screen));
    const short = allZones.filter(
      ({ rect }) => tappable(rect, "desktop", screen) && !fullTarget(rect, "desktop", screen),
    );
    expect(gone.map((z) => z.id)).toEqual(DESKTOP_1024_GONE);
    expect(short.map((z) => z.id)).toEqual(DESKTOP_1024_SHORT);
  });

  it("ДОРОГА 2: каждая зона за краем окна есть в указателе зон", () => {
    // Указатель (`ZoneIndex`) строит список тем же `visibleZones`, что и сцена,
    // и смотрит только на данные — ни на кадр, ни на экран. Поэтому «зона не
    // видна» и «зона недоступна» — разные вещи, и это проверка, а не обещание.
    const listed = listedInIndex;
    // Все 33 заоконные зоны теперь лежат в указателе. Прежде четыре из них
    // (`gamer/money`, `sport/money`, `study/money`, `loft/money`) были скрытой
    // зоной денег — её не было ни в кадре, ни в списке; ADR-0008 её включил,
    // и заоконных без второй дороги не осталось ни одной.
    const hidden = BEYOND_PHONE_WINDOW.filter((id) => !listed.has(id));
    expect(hidden).toEqual([]);
    for (const id of BEYOND_PHONE_WINDOW) {
      if (hidden.includes(id)) continue;
      expect(listed.has(id), `${id}: за окном и не в указателе — недостижима`).toBe(true);
    }
  });

  it("ДОРОГА 2 на десктопе: всё, что срезал кроп, лежит в указателе", () => {
    // То же требование, что у телефона, на каждом десктопном вьюпорте: зона
    // без полных 44×44 обязана быть либо в указателе, либо скрытой продуктом.
    // Скрытых осталось восемь — адресные исключения ADR-0006 «предмета нет в
    // интерьере»; десять зон денег вернулись в продукт (ADR-0008).
    expect(listedInIndex.size).toBe(122);
    expect(allZones.filter(({ roomId, key }) => zoneHiddenByProduct(roomId, key))).toHaveLength(8);
    for (const screen of DESKTOP_SCREENS) {
      const short = allZones.filter(({ rect }) => !fullTarget(rect, "desktop", screen));
      for (const { id, roomId, key } of short) {
        const where = `${id} @ ${screen.w}×${screen.h}`;
        if (zoneHiddenByProduct(roomId, key)) {
          expect(listedInIndex.has(id), `${where}: скрыта продуктом, в списке ей не место`).toBe(
            false,
          );
          continue;
        }
        expect(listedInIndex.has(id), `${where}: срезана и не в указателе — недостижима`).toBe(
          true,
        );
      }
    }
  });

  it("ДОРОГА 2: наезд из указателя доводит заоконную зону до середины экрана", () => {
    // Без этого «есть в списке» ничего не стоило бы: нажал пункт — и уехал в
    // пустоту. Камера центрируется на середине прямоугольника, поэтому доезжает
    // и туда, куда пальцем не дотянуться.
    for (const view of ["phone", "desktop"] as const) {
      const c = viewportCenter(view);
      for (const { id, rect } of allZones) {
        if (view === "phone" && !BEYOND_PHONE_WINDOW.includes(id)) continue;
        const got = zoneCenterAfterCamera(rect, view);
        expect(got.x, `${id} ${view} x`).toBeCloseTo(c.x, 9);
        expect(got.y, `${id} ${view} y`).toBeCloseTo(c.y, 9);
      }
    }
  });

  it("телефон: ни одна зона не лежит под полосами интерфейса", () => {
    // По вертикали окно кадр НЕ режет: полосы держат заголовок, служебные
    // ссылки, «Добавить вещь» и указатель зон, и зона под ними была бы видна,
    // но не нажимаема. Это требование пережило смену координат целиком —
    // разметка по вертикали как была в пределах кадра, так и осталась.
    // Тикет 42 его тоже не трогал: телефон по-прежнему ВПИСЫВАЕТ кадр между
    // полосами, поэтому под ними физически нет комнаты.
    for (const screen of PHONE_SCREENS) {
      const free = clearBand("phone", screen);
      for (const { id, rect } of allZones) {
        const box = zoneOnScreen(rect, "phone", screen);
        const where = `${id} @ phone ${screen.w}×${screen.h}`;
        expect(box.top, `${where} заезжает под верхнюю полосу`).toBeGreaterThanOrEqual(
          free.top - EPS,
        );
        expect(bottom(box), `${where} заезжает под нижнюю полосу`).toBeLessThanOrEqual(
          free.bottom + EPS,
        );
      }
    }
  });

  it("десктоп: полосы лежат НА зонах, и это норма — нажатий они не берут", () => {
    // Прежде здесь стояло «ни одна зона не лежит под полосами — ни на одном
    // вьюпорте». На десктопе это требование держалось вписыванием: кадр стоял
    // МЕЖДУ полосами. С кропом комната идёт от края до края, полосы лежат на
    // ней — так и рисовал макет (турны 17a/23c), и иначе чёрной рамки не
    // убрать. Зона под полосой остаётся нажимаемой: `.imm-rail` объявлена
    // `pointer-events: none`, нажатия берут только её ссылки и кнопки.
    //
    // Числа записаны, чтобы рост был виден в диффе: на 1920×1080 полосы задевают
    // 33 зоны, на 1280×800 — 40, на 1024×768 — 42.
    const touched = (screen: Screen) => {
      const free = clearBand("desktop", screen);
      return allZones.filter(({ rect }) => {
        const box = zoneOnScreen(rect, "desktop", screen);
        return box.top < free.top - EPS || bottom(box) > free.bottom + EPS;
      });
    };
    expect(touched({ w: 1920, h: 1080 })).toHaveLength(33);
    expect(touched(DESKTOP)).toHaveLength(40);
    expect(touched({ w: 1024, h: 768 })).toHaveLength(42);

    // ЦЕЛИКОМ под полосой почти везде лежит только `study/money` — зона денег,
    // продукт её не показывает. Единственное исключение — 1280×720: там нижняя
    // полоса накрывает `cream/anything` целиком. Это ДОЛГ (Comments тикета 42),
    // а не приёмка: на низком окне зону видно только сквозь полосу.
    for (const screen of DESKTOP_SCREENS) {
      const where = `${screen.w}×${screen.h}`;
      const free = clearBand("desktop", screen);
      const swallowed = allZones
        .filter(({ rect }) => {
          const box = zoneOnScreen(rect, "desktop", screen);
          return bottom(box) <= free.top + EPS || box.top >= free.bottom - EPS;
        })
        .map((z) => z.id);
      const expected = DESKTOP_SWALLOWED_BY_RAIL[where];
      expect(expected, `${where}: вьюпорта нет в таблице`).toBeDefined();
      expect(swallowed, where).toEqual(expected);
    }
  });

  it("состав «за окном» не зависит от размера телефона — это свойство кадра", () => {
    // Окно всегда 430 в координатах сцены, каким бы ни был экран: сцена держит
    // пропорцию и масштабируется целиком. Значит и список заоконных зон один и
    // тот же на любом телефоне — меняется только физический размер пикселя.
    for (const screen of [
      { w: 430, h: 745 },
      { w: 390, h: 844 },
      { w: 375, h: 667 },
      { w: 360, h: 640 },
    ]) {
      const beyond = allZones.filter(({ rect }) => !tappable(rect, "phone", screen));
      expect(
        beyond.map((z) => z.id),
        `${screen.w}×${screen.h}`,
      ).toEqual(BEYOND_PHONE_WINDOW);
    }
  });

  it("а на десктопе — зависит, и это разница между вписыванием и кропом", () => {
    // Телефонный список закрыт и одинаков на любом экране, потому что окно
    // всегда 430 из 630 в координатах СЦЕНЫ. На десктопе кроп считается от
    // окна, поэтому меняется и он: та же пропорция 16:10 при большем окне даёт
    // тот же процент кропа, но зоны крупнее в px — и до 44 добирают уже другие.
    const shortAt = (screen: Screen) =>
      allZones.filter(({ rect }) => !fullTarget(rect, "desktop", screen)).map((z) => z.id);
    // 1280×800 и 1440×900 — одна пропорция, разный размер, разные списки.
    expect(shortAt(DESKTOP)).toHaveLength(5);
    expect(shortAt({ w: 1440, h: 900 })).toHaveLength(3);
    expect(shortAt({ w: 1440, h: 900 })).toEqual(["lux/home", "gamer/money", "sport/money"]);
    // 16:9 при любом размере не теряет никого.
    expect(shortAt({ w: 1280, h: 720 })).toEqual([]);
    expect(shortAt({ w: 1920, h: 1080 })).toEqual([]);
  });

  it("«зона целиком в окне» и «есть цель нажатия» — разные вещи, и обе посчитаны", () => {
    // 68 зон попадают в окно ЦЕЛИКОМ, ещё 29 — краем: 17 свешиваются влево
    // (кадр начинается за левым краем окна, x < 12) и 12 упираются в правый
    // край, не уходя за него совсем. Краем — это тоже достижимо: видимого
    // куска хватает пальцу, кроме семи случаев ниже.
    const whole = allZones.filter(({ rect }) => zoneInsideViewport(rect, "phone"));
    expect(whole).toHaveLength(68);
    const partial = allZones.filter(
      ({ id, rect }) => !zoneInsideViewport(rect, "phone") && !BEYOND_PHONE_WINDOW.includes(id),
    );
    expect(partial).toHaveLength(29);
    expect(whole.length + partial.length + BEYOND_PHONE_WINDOW.length).toBe(130);
    // Левый свес — обратная сторона той же смены координат: кадр стоит в сцене
    // со сдвигом −12, поэтому зона у левого края кадра (x < 12) уходит под
    // левый край окна. Их 17, и все они срезаются, а не пропадают.
    expect(allZones.filter(({ rect }) => rect.x < -scene.phone.image.x)).toHaveLength(17);
  });
});

describe("цель нажатия зоны (rooms.json → hitTargetMin)", () => {
  it("телефон: полные 44×44 у всех, кроме семи зон на самом краю окна", () => {
    // Порог не ослаблен: 44 px из `hitTargetMin`, как и был. Меньше получают
    // только зоны, которые окно режет по правому краю — у них до 44 добивать
    // некуда, пикселей за краем сцены нет. Зоны, ушедшие за окно целиком,
    // сюда не входят: их дорога — указатель (разбиение выше).
    const narrow = allZones
      .filter(({ id }) => !BEYOND_PHONE_WINDOW.includes(id))
      .map(({ id, rect }) => ({ id, hit: zoneHitBox(rect, "phone", PHONE) }))
      .filter(({ hit }) => hit.width < hitTargetMin - EPS || hit.height < hitTargetMin - EPS);

    expect(narrow.map((z) => z.id)).toEqual([
      "cream/home",
      "emerald/home",
      "bold/music",
      "bold/home",
      "cottage/music",
      "sport/events",
      "study/events",
    ]);
    // Самая узкая цель на телефоне — 16 px по ширине (`bold/music`: зона
    // 426…502 показана окном только до 442). Это меньше прежних 33 px, и это
    // ДОЛГ, а не приёмка: дизайну стоит сдвинуть такие зоны внутрь окна или
    // принять, что дорога к ним — указатель. Записано в ADR-0006.
    const worst = Math.min(...narrow.map((z) => z.hit.width));
    expect(worst).toBeCloseTo(16, 2);
    // По высоте окно не режет никого: 44 у всех семи.
    for (const { id, hit } of narrow) {
      expect(hit.height, `${id} высота цели`).toBeGreaterThanOrEqual(hitTargetMin - EPS);
    }
  });

  it("десктоп: полные 44×44 у всех, кого не задел кроп", () => {
    // Прежде здесь стояло «все 130 зон получают полные 44×44 на любом окне» —
    // это держалось на вписывании: кадр целиком лежал в окне, резать было
    // нечему. С кропом порог остался тем же (44 px из `hitTargetMin`), но
    // держится он там, где до 44 есть куда добивать. Утверждение стало точнее:
    // недобор возможен ТОЛЬКО у зоны, которую задел край окна.
    for (const screen of DESKTOP_SCREENS) {
      for (const { id, rect } of allZones) {
        if (clippedByWindow(rect, "desktop", screen)) continue;
        const hit = zoneHitBox(rect, "desktop", screen);
        const where = `${id} @ ${screen.w}×${screen.h}`;
        expect(hit.width, `${where} ширина цели`).toBeGreaterThanOrEqual(hitTargetMin - EPS);
        expect(hit.height, `${where} высота цели`).toBeGreaterThanOrEqual(hitTargetMin - EPS);
      }
    }
    // На 16:9 кроп меньше полупроцента и не задевает никого настолько, чтобы
    // отнять 44 px: там полные 44×44 достаются всем 130 зонам.
    for (const screen of [
      { w: 1920, h: 1080 },
      { w: 1536, h: 864 },
      { w: 1280, h: 720 },
    ]) {
      for (const { id, rect } of allZones) {
        const hit = zoneHitBox(rect, "desktop", screen);
        const where = `${id} @ ${screen.w}×${screen.h}`;
        expect(hit.width, `${where} ширина цели`).toBeGreaterThanOrEqual(hitTargetMin - EPS);
        expect(hit.height, `${where} высота цели`).toBeGreaterThanOrEqual(hitTargetMin - EPS);
      }
    }
  });

  it("телефон: нажимать не стало хуже с тикета 24 — цель не меньше прежней", () => {
    // Сравнение с раскладкой ДО тикета 24 (сцена блоком в колонке). Координаты
    // у обеих одни и те же, сцена того же размера, поэтому меряется именно
    // раскладка. Телефон тикетом 42 не тронут — проверка осталась как была.
    for (const { id, rect } of allZones) {
      const now = zoneHitBox(rect, "phone", PHONE);
      const before = legacyHitBox(rect, "phone");
      expect(now.width, `${id} ширина цели`).toBeGreaterThanOrEqual(before.width - EPS);
      expect(now.height, `${id} высота цели`).toBeGreaterThanOrEqual(before.height - EPS);
    }
  });

  it("десктоп: кроп — размен, и он посчитан от нынешней раскладки", () => {
    // ПРЕЖНИЙ ЭТАЛОН ЗДЕСЬ ПОТЕРЯЛ СМЫСЛ и пересобран. Он мерил цель в долях
    // холста 1120: делил нынешнюю цель на масштаб сцены и сравнивал с целью в
    // блоке 1120×625. Пока сцена вписывалась, доля и была честной мерой. С
    // кропом деление врёт дважды: во-первых, добивка до 44 px — величина
    // ЭКРАННАЯ и на масштаб не делится (оттого и падало `cream/jewelry`:
    // 155 «долей» против 215), во-вторых, сравнивать стало нужно не с блоком
    // из тикета 24, а с тем вписыванием, которое кроп заменил.
    //
    // Пересобранное утверждение сильнее прежнего и проверяемо: где край окна не
    // достаёт, цель нажатия НЕ уменьшилась — она выросла вместе с кадром
    // (на 1280×800 кадр стал 1433.6 против 949.8, то есть ×1.51). Где достаёт —
    // это и есть цена решения, и зоны там ровно те, что в разбиении выше.
    for (const screen of [DESKTOP, { w: 1440, h: 900 }, { w: 1920, h: 1080 }]) {
      const grown = sceneBand("desktop", screen).width / preCoverBand(screen).width;
      expect(grown, `${screen.w}×${screen.h} кадр вырос`).toBeGreaterThan(1.3);
      for (const { id, rect } of allZones) {
        if (clippedByWindow(rect, "desktop", screen)) continue;
        const now = zoneHitBox(rect, "desktop", screen);
        const before = preCoverHitBox(rect, screen);
        const where = `${id} @ ${screen.w}×${screen.h}`;
        expect(now.width, `${where} ширина цели`).toBeGreaterThanOrEqual(before.width - EPS);
        expect(now.height, `${where} высота цели`).toBeGreaterThanOrEqual(before.height - EPS);
      }
    }
    // На 16:9 размена нет вовсе: кроп в 7.68 px никому не мешает добить до 44,
    // и цель не уменьшилась НИ У ОДНОЙ из 130 зон, включая задетые краем.
    for (const { id, rect } of allZones) {
      const screen = { w: 1920, h: 1080 };
      const now = zoneHitBox(rect, "desktop", screen);
      const before = preCoverHitBox(rect, screen);
      expect(now.width, `${id} ширина цели @1920`).toBeGreaterThanOrEqual(before.width - EPS);
      expect(now.height, `${id} высота цели @1920`).toBeGreaterThanOrEqual(before.height - EPS);
    }
  });
});

describe("развилка контракта: почему кадр не растянут на весь экран", () => {
  it("телефон: окно показывает 430 из 630 px кадра — оно ездит, а не режет карту", () => {
    // Это и есть ответ на «сцена — весь экран 430×932», переписанный под новую
    // систему координат. Прежний довод («карта занимает кадр ровно от края до
    // края экрана») держался на обрезке: карта была шириной ровно с окно.
    // Теперь карта шириной с КАДР, и увеличивать кадр по-прежнему некуда — но
    // по другой причине: за окном и так уже стоят 33 зоны, растягивание кадра
    // выгонит за окно ещё.
    const band = sceneBand("phone", PHONE);
    expect(band.width).toBe(scene.phone.w);
    // Карта покрывает кадр целиком: от 0 до 630.
    const left = Math.min(...allZones.map((z) => z.rect.x));
    const rightEdge = Math.max(...allZones.map((z) => z.rect.x + z.rect.w));
    expect(left).toBe(0);
    expect(rightEdge).toBe(scene.phone.image.w);
    // А окно видит из этого 430/630 = 68.3%.
    expect((scene.phone.w / scene.phone.image.w) * 100).toBeCloseTo(68.3, 1);
    // По вертикали запас нулевой с обеих сторон — здесь ничего не изменилось.
    const boxes = allZones.map(({ rect }) => zoneOnScreen(rect, "phone", PHONE));
    const top = Math.min(...boxes.map((b) => b.top));
    const bottomEdge = Math.max(...boxes.map(bottom));
    expect(top - band.top).toBeCloseTo((5 / scene.phone.h) * band.height, 2);
    expect(band.top + band.height - bottomEdge).toBeCloseTo(0, 1);
  });

  it("десктоп: кадр ПЕРЕрастает окно намеренно — в этом и состоит кроп", () => {
    // Прежде здесь ожидалось `tall.width ≤ 1920` — «ширину экрана кадр не
    // перерастает: зоны обязаны остаться в кадре». Это и было вписывание: кадр
    // жался в окно, вокруг оставалась рамка. Тикет 42 развернул требование:
    // кадр обязан быть НЕ МЕНЬШЕ окна, а лишнее срезается. На 1920×1080 кадр
    // ровно 1935.36 — те самые 7.68 px за каждым краем.
    const short = sceneBand("desktop", DESKTOP);
    const tall = sceneBand("desktop", { w: 1920, h: 1080 });
    expect(tall.width).toBeGreaterThan(short.width);
    // На высоком окне сцена крупнее прежнего холста 1120×625 — и заметно.
    expect(tall.width).toBeGreaterThan(scene.desktop.w);
    expect(tall.width).toBeCloseTo(1935.36, 4);
    expect(tall.width).toBeGreaterThan(1920);
    // Крайняя правая зона теперь стоит ЗА краем окна, а не у края сцены:
    // прежде правый край карты совпадал с правым краем экрана.
    const rightMost = Math.max(
      ...allZones.map(({ rect }) => right(zoneOnScreen(rect, "desktop", DESKTOP))),
    );
    const band = sceneBand("desktop", DESKTOP);
    expect(rightMost).toBeCloseTo(right(band), 0);
    expect(rightMost).toBeGreaterThan(DESKTOP.w);
    // Расти кадру есть куда и вширь: он растёт вместе с окном по обеим сторонам.
    expect(tall.height).toBeGreaterThan(short.height);
  });
});
