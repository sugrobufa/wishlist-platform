import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
  round4,
  sceneSize,
  viewportCenter,
  zoneCenterAfterCamera,
  zoneInsideViewport,
  zoneScenePercent,
  type SceneView,
} from "../src/components/scene/camera";
import { visibleZones } from "../src/components/scene/zones";
import {
  clampPan,
  clearBand,
  desktopReference,
  EDGE_HINT_SLACK,
  immersiveLayout,
  minWindowAr,
  phoneEdgeHints,
  phonePanRange,
  phonePanShiftPx,
  phonePanToZone,
  phoneWindowOnFrame,
  phoneZoneHitBoxAtPan,
  phoneZoneOnScreenAtPan,
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
// Раунд третий (тикет 45). Кроп оказался БЕЗ ДНА: его глубину задаёт пропорция
// окна, и на 4:3 (1024×768 — айпад в альбоме, он же порог десктопной раскладки)
// срезалась четверть ширины комнаты. Числа этот файл и записал: 105 зон пальцем
// из 130, 12 недобирают 44 px, 13 срезаны в ноль. Тикет 45 поставил кропу
// предел — «не глубже, чем на эталонном окне 1280×800» (`minWindowAr`), —
// и 1024×768 стал вести себя ровно как эталон: 125 пальцем, 5 указателем, ноль
// срезанных. Цена — поле сверху и снизу (64 px на 1024×768), и оно тоже под
// тестом: обязано быть меньше полос интерфейса, которые его накрывают.
// Окна 16:10 и шире не изменились НИ НА ПИКСЕЛЬ — это отдельная проверка,
// сверяющая нынешнюю формулу с прежней («чистый cover») на каждом из них.
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
// Раунд четвёртый (тикет 55). У телефона появилась ТРЕТЬЯ дорога — пан: окно
// 430 ездит по кадру 630 пальцем, а не только наездом камеры. Инвариант
// достижимости переписан ЧЕСТНО, двумя числами: «пальцем В ПОКОЕ» — прежние
// 97 против 33 (свойство кадра, разбиение ниже не менялось), «пальцем ПАНОМ» —
// все 130 (у каждой зоны есть позиция окна с полной целью 44×44 — самая
// широкая зона у́же окна). Обе цифры под тестом в блоке «пан окна по кадру».
// Пан — свойство показа: карта, указатель и камера не изменились ни на пиксель.
//
// Раунд пятый (тикет 57). Телефон повторил движение десктопа: кадр стоял ПОД
// верхней полосой (top 190), и между шапкой и комнатой лежала мёртвая тёмная
// зона в 190 px — владелец увидел её на стенде. Теперь кадр от верха экрана,
// вуаль лежит НА нём, освободившееся ушло вниз (лист вещей 362 → 552 px).
// ТАБЛИЦА ДОСТИЖИМОСТИ ОТ ЭТОГО НЕ СДВИНУЛАСЬ НИ НА ЗОНУ, и это не совпадение:
// кадр ПЕРЕЕХАЛ, а не изменился в размере (проверка «размер тот же до пикселя»
// ниже), обрезка `sceneVisible` просто сдвинулась вместе с ним, а режет она по
// горизонтали — там, где стоят те самые 33 заоконные и 7 узких. Что появилось
// нового — числа задетых вуалью зон: было 0, стало 75 из 130 на 430×932.
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
 * (1120:625), поэтому 16:9 срезается почти не срезаясь, а 16:10 теряет по 5.4%
 * ширины с каждой стороны. Всё, что у́же 16:10, кроп резал тем глубже, чем у́же
 * окно (4:3 — по 12.8% с каждой стороны, 5:4 — по 15.1%), пока тикет 45 не
 * поставил ему предел.
 *
 * Три узких окна здесь не выдуманы: 1024×768 — айпад в альбоме и ровно порог
 * раскладки, 1194×834 — iPad Pro 11 в альбоме, 1280×1024 — 5:4, самое узкое
 * из реально встречающихся десктопных окон.
 */
const DESKTOP_SCREENS: Screen[] = [
  { w: 1024, h: 768 },
  { w: 1194, h: 834 },
  { w: 1280, h: 720 },
  DESKTOP,
  { w: 1280, h: 1024 },
  { w: 1366, h: 768 },
  { w: 1440, h: 900 },
  { w: 1536, h: 864 },
  { w: 1920, h: 1080 },
];

/** Окна 16:10 и шире: их тикет 45 не трогает вовсе. */
const DESKTOP_WIDE = DESKTOP_SCREENS.filter((s) => s.w / s.h >= minWindowAr);

/** Окна у́же эталона: здесь кроп упирается в предел, и появляется поле. */
const DESKTOP_NARROW = DESKTOP_SCREENS.filter((s) => s.w / s.h < minWindowAr);

/**
 * Прежняя формула — «чистый cover» без предела, с тем же округлением до 4
 * знаков, что у `sceneBand`. Эталон проверки «ничего не изменилось».
 */
function pureCoverBand(screen: Screen): Box {
  const ar = immersiveLayout.desktop.ar;
  const width = Math.max(screen.w, screen.h * ar);
  const height = width / ar;
  return {
    left: round4((screen.w - width) / 2),
    top: round4((screen.h - height) / 2),
    width: round4(width),
    height: round4(height),
  };
}

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
 * Достижимость пальцем на ДЕСКТОПЕ, по вьюпортам (тикеты 42 и 45).
 *
 * `bleedX` — сколько кадра ушло за КАЖДЫЙ боковой край окна; `field` — поле
 * сверху и снизу (кроп упёрся в предел, тикет 45); `full` — зон с полными
 * 44×44; `short` — цель есть, но меньше 44 хотя бы по одной стороне; `gone` —
 * цель срезана в ноль. Сумма трёх всегда 130: молча потеряться нельзя ни одной,
 * дорога к `short` — указатель зон (проверено ниже), а `gone` теперь ноль
 * везде — это и есть приёмка тикета 45.
 *
 * Читать таблицу так: пока пропорция окна близка к пропорции кадра (16:9),
 * кроп меньше полупроцента и пальцем достаются ВСЕ 130. На 16:10 срезается по
 * 5.4% ширины, и правый край окна начинает подъедать зоны у правой стены
 * комнаты. Уже 16:10 картинка больше НЕ ухудшается: кроп остановлен на глубине
 * эталона, и 1024×768, 1194×834, 1280×1024 повторяют строку 1280×800 зона в
 * зону — разной остаётся только высота поля.
 *
 * Было до тикета 45 (для сравнения, эти строки и есть находка тикета):
 *   1024×768   bleedX 176.128  →  105 / 12 / 13
 *   1194×834   bleedX 150.336  →  117 /  4 /  9
 *   1280×1024  bleedX 277.504  →  101 /  5 / 24
 */
const DESKTOP_REACH: Array<{
  screen: Screen;
  bleedX: number;
  field: number;
  full: number;
  short: number;
  gone: number;
}> = [
  { screen: { w: 1024, h: 768 }, bleedX: 61.44, field: 64, full: 125, short: 5, gone: 0 },
  { screen: { w: 1194, h: 834 }, bleedX: 71.64, field: 43.875, full: 125, short: 5, gone: 0 },
  { screen: { w: 1280, h: 720 }, bleedX: 5.12, field: 0, full: 130, short: 0, gone: 0 },
  { screen: DESKTOP, bleedX: 76.8, field: 0, full: 125, short: 5, gone: 0 },
  { screen: { w: 1280, h: 1024 }, bleedX: 76.8, field: 112, full: 125, short: 5, gone: 0 },
  { screen: { w: 1366, h: 768 }, bleedX: 5.128, field: 0, full: 130, short: 0, gone: 0 },
  { screen: { w: 1440, h: 900 }, bleedX: 86.4, field: 0, full: 127, short: 3, gone: 0 },
  { screen: { w: 1536, h: 864 }, bleedX: 6.144, field: 0, full: 130, short: 0, gone: 0 },
  { screen: { w: 1920, h: 1080 }, bleedX: 7.68, field: 0, full: 130, short: 0, gone: 0 },
];

/**
 * Пять зон, которым на эталонном 1280×800 правый край окна не даёт полных
 * 44×44. Список именной по той же причине, что телефонный: незаметно приехавшая
 * сюда шестая зона — это ухудшение, а не мелочь.
 *
 * После тикета 45 этот же список получают ВСЕ окна у́же эталона: глубина кропа
 * у них общая с эталоном, а недобирают до 44 те же зоны у правой стены. Прежде
 * на 1024×768 список был другой и вдвое длиннее — 12 недобирающих и 13
 * срезанных в ноль.
 */
const DESKTOP_1280_SHORT = [
  "lux/home",
  "gamer/money",
  "sport/money",
  "study/watches",
  "loft/money",
];

/**
 * Зоны, целиком спрятанные под полосой интерфейса на десктопе — по вьюпортам.
 * Почти везде это одна `study/money`; на 1280×720 нижняя полоса накрывает ещё и
 * `cream/anything` (долг из тикета 42, 16:9 тикет 45 не трогал). Список
 * именной: следующая показываемая зона, уехавшая под полосу целиком, обязана
 * быть замечена, а не приехать молча.
 *
 * На узких окнах спрятанных нет вовсе, и это побочный выигрыш тикета 45: кадр
 * стал ниже окна, его верх и низ отошли от полос. На 1024×768 `study/money`
 * из-под полосы вышла.
 *
 * NB: `study/money` больше НЕ «зона, которую продукт не показывает» — ADR-0008
 * вернул зоны денег в продукт (122 зоны из 130). Так что это показываемая зона,
 * целиком лежащая под полосой, и её дорога — указатель зон.
 */
const DESKTOP_SWALLOWED_BY_RAIL: Record<string, string[]> = {
  "1024×768": [],
  "1194×834": [],
  "1280×720": ["cream/anything", "study/money"],
  "1280×800": ["study/money"],
  "1280×1024": [],
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
    // Телефон 430×932: кадр берёт всю ширину и встаёт У ВЕРХА экрана (тикет
    // 57). Размер тот же, что был под полосой, — переехал, а не растянулся.
    expect(phone).toEqual({ left: 0, top: 0, width: 430, height: 352 });
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
  it("десктоп: по бокам полей нет никогда — комната от края до края", () => {
    // Это и есть требование тикета 42, записанное числом. Владелец трижды просил
    // комнату во весь экран; вписанный кадр давал на 1920 чёрную рамку в 234 px
    // с каждой стороны, и рамка была ровно тем, что он видел. По ГОРИЗОНТАЛИ
    // это требование безусловное и предел кропа его не касается: кадр всегда
    // не у́же окна.
    for (const screen of [...DESKTOP_SCREENS, { w: 2560, h: 1080 }]) {
      const gap = sceneGap("desktop", screen);
      const where = `${screen.w}×${screen.h}`;
      expect(gap.left, `${where} слева`).toBe(0);
      expect(gap.right, `${where} справа`).toBe(0);
    }
  });

  it("десктоп: на 16:10 и шире полей нет и сверху со снизу", () => {
    // Требование тикета 42 целиком: 1920×1080, 1440×900, 1280×800 — нули со
    // всех четырёх сторон. Тикет 45 их не тронул и не имел права тронуть.
    for (const screen of DESKTOP_WIDE) {
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

  it("десктоп: на узком окне поле есть — и оно меньше полос, которые его прячут", () => {
    // Цена предела кропа (тикет 45). Поле делится поровну, стоит там же, где
    // полосы интерфейса, и того же цвета, что фон сцены — на альбомных окнах
    // человек видит не чёрную рамку, а ту же тёмную полосу, что и всегда.
    // Если поле когда-нибудь перерастёт полосу, оно вылезет наружу — вот это
    // и ловится здесь.
    expect(DESKTOP_NARROW.map((s) => `${s.w}×${s.h}`)).toEqual([
      "1024×768",
      "1194×834",
      "1280×1024",
    ]);
    for (const screen of DESKTOP_NARROW) {
      const gap = sceneGap("desktop", screen);
      const where = `${screen.w}×${screen.h}`;
      expect(gap.top, `${where} поле сверху`).toBeGreaterThan(0);
      expect(gap.top, `${where} поле = половина остатка`).toBeCloseTo(gap.bottom, 6);
      expect(gap.top, `${where} поле вылезло из-под верхней полосы`).toBeLessThanOrEqual(
        immersiveLayout.desktop.railTop,
      );
      expect(gap.bottom, `${where} поле вылезло из-под нижней полосы`).toBeLessThanOrEqual(
        immersiveLayout.desktop.railBottom,
      );
    }
    // Числами: 64 px на 1024×768 против полос в 132 и 116; 112 на 1280×1024 —
    // это самое большое поле из реальных окон, и оно всё ещё под полосой.
    expect(sceneGap("desktop", { w: 1024, h: 768 })).toEqual({
      left: 0,
      right: 0,
      top: 64,
      bottom: 64,
    });
    expect(sceneGap("desktop", { w: 1280, h: 1024 }).top).toBe(112);
  });

  it("десктоп: кадр не меньше окна по ширине — это и есть cover", () => {
    for (const screen of DESKTOP_SCREENS) {
      const band = sceneBand("desktop", screen);
      const where = `${screen.w}×${screen.h}`;
      expect(band.width, `${where} ширина кадра`).toBeGreaterThanOrEqual(screen.w - EPS);
      // По высоте кадр перерастает окно только там, где кроп не упёрся в предел.
      const wide = screen.w / screen.h >= minWindowAr;
      if (wide) expect(band.height, `${where} высота кадра`).toBeGreaterThanOrEqual(screen.h - EPS);
      else expect(band.height, `${where} высота кадра`).toBeLessThan(screen.h);
      // Видимая часть сцены — весь экран по ширине; по высоте весь, пока нет поля.
      expect(sceneVisible("desktop", screen), where).toEqual({
        left: 0,
        top: wide ? 0 : sceneGap("desktop", screen).top,
        width: screen.w,
        height: wide ? screen.h : band.height,
      });
    }
    // Контрольные числа: 1280×800 (16:10) и 1920×1080 (16:9). Кадр вылезает
    // вбок, по высоте садится ровно в окно.
    const refBand = sceneBand("desktop", DESKTOP);
    expect(refBand.left).toBeCloseTo(-76.8, 4);
    expect(refBand.width).toBeCloseTo(1433.6, 4);
    expect(refBand.top).toBeCloseTo(0, 4);
    expect(refBand.height).toBeCloseTo(800, 4);
    const full = sceneBand("desktop", { w: 1920, h: 1080 });
    expect(full.left).toBeCloseTo(-7.68, 4);
    expect(full.width).toBeCloseTo(1935.36, 4);
    expect(full.top).toBeCloseTo(0, 4);
    expect(full.height).toBeCloseTo(1080, 4);
    // А на 1024×768 кадр 1146.88×640 стоит по центру: вбок ушло по 61.44,
    // сверху и снизу осталось по 64 (было — 1376.256×768 и по 176.128 вбок).
    const narrow = sceneBand("desktop", { w: 1024, h: 768 });
    expect(narrow).toEqual({ left: -61.44, top: 64, width: 1146.88, height: 640 });
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
    // Кроп не выдуман раскладкой, он выводится. Формула была
    // min(1, ar_окна/ar_кадра); тикет 45 подставил в неё пол:
    // min(1, max(ar_окна, ar_эталона)/ar_кадра) — окно у́же эталона считается
    // как эталон. Отсюда и вся десктопная таблица достижимости ниже.
    const frameAr = immersiveLayout.desktop.ar;
    for (const screen of DESKTOP_SCREENS) {
      const band = sceneBand("desktop", screen);
      const share = screen.w / band.width;
      expect(share, `${screen.w}×${screen.h}`).toBeCloseTo(
        Math.min(1, Math.max(screen.w / screen.h, minWindowAr) / frameAr),
        6,
      );
    }
    // Числами: 16:9 показывает 99.2% кадра, 16:10 — 89.3%. 4:3 показывал 74.4%,
    // теперь показывает те же 89.3%, что эталон, — это и есть тикет 45.
    const shown = (screen: Screen) => (screen.w / sceneBand("desktop", screen).width) * 100;
    expect(shown({ w: 1920, h: 1080 })).toBeCloseTo(99.2, 1);
    expect(shown(DESKTOP)).toBeCloseTo(89.3, 1);
    expect(shown({ w: 1024, h: 768 })).toBeCloseTo(89.3, 1);
    expect(shown({ w: 1280, h: 1024 })).toBeCloseTo(89.3, 1);
    // Телефон видит 68.3% — и теперь ни одно десктопное окно к нему не
    // приближается: пол держит десктоп на 89.3% и выше.
    expect((scene.phone.w / scene.phone.image.w) * 100).toBeCloseTo(68.3, 1);
    for (const screen of DESKTOP_SCREENS) {
      expect(shown(screen), `${screen.w}×${screen.h}`).toBeGreaterThanOrEqual(89.28);
    }
  });

  it("телефон вписан, но прижат к верху: поля только снизу (тикет 57)", () => {
    // Прежде здесь стояло `top: 190, bottom: 390` — «поля сверху и снизу это
    // полосы и есть». Верхнее поле и было мёртвой тёмной зоной, которую увидел
    // владелец: между шапкой и комнатой 190 px, где нет ни того, ни другого.
    // Теперь его НОЛЬ, а всё, что освободилось, ушло вниз — 390 стало 580.
    expect(sceneGap("phone", PHONE)).toEqual({ left: 0, right: 0, top: 0, bottom: 580 });
    for (const screen of PHONE_SCREENS) {
      const gap = sceneGap("phone", screen);
      const where = `${screen.w}×${screen.h}`;
      expect(gap.left, `${where} слева`).toBe(0);
      expect(gap.right, `${where} справа`).toBe(0);
      expect(gap.top, `${where} сверху`).toBe(0);
      // Всё поле теперь снизу, и его ровно столько, сколько экран длиннее кадра.
      expect(gap.bottom, `${where} снизу`).toBeCloseTo(
        screen.h - sceneBand("phone", screen).height,
        4,
      );
    }
  });

  it("телефон: кадр ПЕРЕЕХАЛ, а не растянулся — размер тот же до пикселя", () => {
    // Главная страховка тикета 57: пропорция 430:352 неприкосновенна (ADR-0006),
    // и «поднять кадр к верху» не имело права превратиться в «растянуть кадр».
    // Прежняя формула считала ширину как min(экран, (высота − полосы − зазор) ×
    // пропорция); на всех телефонах обхода ограничителем был ЭКРАН, а не
    // высота, — поэтому размер и не изменился. Здесь это записано числом.
    const before = (screen: Screen) => {
      const l = immersiveLayout.phone;
      const width = Math.min(
        screen.w,
        Math.max(0, screen.h - l.railTop - l.railBottom - l.gap) * l.ar,
      );
      return { width: round4(width), height: round4(width / l.ar) };
    };
    for (const screen of PHONE_SCREENS) {
      const now = sceneBand("phone", screen);
      const was = before(screen);
      const where = `${screen.w}×${screen.h}`;
      expect(now.width, `${where} ширина кадра`).toBeCloseTo(was.width, 4);
      expect(now.height, `${where} высота кадра`).toBeCloseTo(was.height, 4);
      // И то, и другое — просто ширина экрана и она же ÷ пропорция.
      expect(now.width, `${where} кадр во всю ширину`).toBe(screen.w);
    }
    // Контрольные числа обхода: 430 → 352, 390 → 319.26, 375 → 307, 360 → 294.7.
    expect(sceneBand("phone", { w: 390, h: 844 }).height).toBeCloseTo(319.2558, 3);
    expect(sceneBand("phone", { w: 375, h: 667 }).height).toBeCloseTo(306.9767, 3);
    expect(sceneBand("phone", { w: 360, h: 640 }).height).toBeCloseTo(294.6977, 3);
  });

  it("CSS телефона считает ту же формулу и кладёт вуаль НА комнату (тикет 57)", () => {
    // Раскладку рисует CSS, а проверяет этот файл — сходятся они только пока
    // числа совпадают. Тикет 57 переставил ДВА места, и оба здесь:
    //   1) кадр больше не отсчитывается от полос и не отступает под них;
    //   2) верхняя вуаль поднялась НАД сценой слоем — иначе комната закрасила
    //      бы её собой (в разметке вуаль стоит до сцены), и вместо шапки на
    //      комнате получилась бы шапка ПОД комнатой. Ни один другой тест этого
    //      не увидит: геометрия при такой поломке остаётся верной до пикселя.
    const scene = readFileSync(
      fileURLToPath(new URL("../src/components/scene/scene.module.css", import.meta.url)),
      "utf8",
    );
    expect(scene, "в формулу кадра вернулись полосы").toContain("--band-free-h: 100dvh;");
    expect(scene, "кадр снова отступает под верхнюю полосу").toMatch(
      /\.stage \{[^}]*padding-top: 0;/u,
    );
    expect(scene, "лист вещей снова считается от верхней полосы").toContain(
      "max-height: calc(100dvh - var(--band-h) * 0.75 - var(--rail-bottom));",
    );

    const globals = readFileSync(
      fileURLToPath(new URL("../src/app/globals.css", import.meta.url)),
      "utf8",
    );
    const layer = (selector: string) =>
      new RegExp(`\\.${selector} \\{[^}]*z-index: (\\d+);`, "u").exec(globals)?.[1];
    // Вуаль над сценой, шапка над вуалью. Сцена своего z-index не берёт
    // намеренно: возьми она его — стала бы контекстом наложения, и лист вещей
    // (.panel, z-index 2) уже не смог бы подняться над вуалью.
    expect(layer("imm-veil-top"), "вуаль потеряла слой — уедет под комнату").toBe("1");
    expect(layer("imm-rail-top"), "шапка потеряла слой — уедет под свою вуаль").toBe("2");
    expect(scene, "сцена взяла z-index и заперла лист вещей").not.toMatch(
      /\.stage \{[^}]*z-index:/u,
    );
    // И обе полосы по-прежнему прозрачны для пальца: зона под шапкой обязана
    // нажиматься насквозь — на телефоне таких зон теперь 75 из 130.
    expect(globals).toMatch(/\.imm-rail \{[^}]*pointer-events: none;/u);
    expect(globals).toMatch(/\.imm-veil \{[^}]*pointer-events: none;/u);
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
      // последние 116 px окна. На окне у́же эталона комната начинается ниже нуля
      // (поле), и требование становится мягче ровно на высоту поля: полоса
      // обязана его накрыть, иначе поле видно наружу.
      expect(vis.top, `${where} верх комнаты`).toBeLessThanOrEqual(
        immersiveLayout.desktop.railTop + EPS,
      );
      expect(bottom(vis), `${where} низ комнаты`).toBeGreaterThanOrEqual(
        screen.h - immersiveLayout.desktop.railBottom - EPS,
      );
      // Содержимое полосы отступает от края комнаты ровно на sidePad = 44.
      expect(content.left - vis.left, `${where} отступ содержимого`).toBeCloseTo(
        immersiveLayout.desktop.sidePad,
        6,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// ТРЕБОВАНИЕ ТИКЕТА 45: у кропа есть дно, и оно на глубине эталона 1280×800.
// ---------------------------------------------------------------------------
describe("предел глубины кропа (тикет 45)", () => {
  it("эталон — 1280×800, и это тот же вьюпорт, на котором принимали раскладку", () => {
    expect(desktopReference).toEqual({ w: 1280, h: 800 });
    expect(desktopReference).toEqual(DESKTOP);
    expect(minWindowAr).toBeCloseTo(1.6, 9);
    // Предел лежит между пропорцией кадра и пропорцией телефонного окна: он
    // ограничивает кроп, а не отменяет его.
    expect(minWindowAr).toBeLessThan(immersiveLayout.desktop.ar);
  });

  it("глубже эталона не режется ни одно окно", () => {
    // Одна фраза тикета 45, записанная числом: доля видимого кадра на любом
    // десктопном окне не меньше, чем на 1280×800.
    const share = (screen: Screen) => screen.w / sceneBand("desktop", screen).width;
    const refShare = share(desktopReference);
    expect(refShare).toBeCloseTo(0.892857, 6);
    for (const screen of [...DESKTOP_SCREENS, { w: 2560, h: 1080 }, { w: 1024, h: 1366 }]) {
      expect(share(screen), `${screen.w}×${screen.h}`).toBeGreaterThanOrEqual(refShare - 1e-9);
    }
    // На окне у́же эталона кроп упирается в предел ТОЧНО, а не примерно:
    // 4:3, 5:4 и даже айпад в портрете видят ровно ту же долю кадра.
    for (const screen of [...DESKTOP_NARROW, { w: 1024, h: 1366 }]) {
      expect(share(screen), `${screen.w}×${screen.h}`).toBeCloseTo(refShare, 9);
    }
  });

  it("окна 16:10 и шире не изменились ни на пиксель", () => {
    // Прямое сравнение с ПРЕЖНЕЙ формулой (чистый cover): там, где пропорция
    // окна не у́же эталона, предел не участвует и коробка сцены совпадает до
    // знака. Это и есть гарантия «1920×1080 и 1280×800 не тронуты».
    for (const screen of [...DESKTOP_WIDE, { w: 2560, h: 1080 }, { w: 2560, h: 1440 }]) {
      const where = `${screen.w}×${screen.h}`;
      expect(sceneBand("desktop", screen), where).toEqual(pureCoverBand(screen));
    }
    // А на узких — изменились, и вот насколько: кадр стал уже на 20%, зато
    // целиком поместился в предел.
    const narrowBefore = pureCoverBand({ w: 1024, h: 768 });
    expect(narrowBefore.width).toBeCloseTo(1376.256, 3);
    expect(sceneBand("desktop", { w: 1024, h: 768 }).width).toBeCloseTo(1146.88, 3);
  });

  it("предел не откатывает тикет 42: даже на 4:3 кадр больше вписанного", () => {
    // Проверка на «а не вернулись ли мы тихо к вписыванию». Вписывание держало
    // пропорцию ПОЛЯМИ со всех сторон: на 1024×768 кадр был бы 892.4×498 и
    // вокруг него стояла бы рамка в 66 px слева и справа. Нынешний кадр шире
    // окна (по бокам его режет край) и в 1.28 раза больше прежнего — комната
    // по-прежнему во всю ширину экрана, поля только сверху и снизу.
    const screen: Screen = { w: 1024, h: 768 };
    const before = preCoverBand(screen);
    const now = sceneBand("desktop", screen);
    expect(before.width).toBeCloseTo(892.4, 0);
    expect(now.width / before.width).toBeGreaterThan(1.28);
    expect(now.width).toBeGreaterThan(screen.w);
    expect(sceneGap("desktop", screen).left).toBe(0);
  });

  it("CSS считает ту же формулу: `--band-ar-min` в scene.module.css — тот же эталон", () => {
    // Раскладку рисует CSS, а проверяет этот файл; сходятся они только пока
    // числа совпадают. Пропорция эталона — единственное число тикета 45, и
    // записано оно дважды, поэтому сверяется здесь напрямую по тексту файла.
    const css = readFileSync(
      fileURLToPath(new URL("../src/components/scene/scene.module.css", import.meta.url)),
      "utf8",
    );
    const floor = /--band-ar-min:\s*(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s*;/u.exec(css);
    expect(floor, "в scene.module.css нет --band-ar-min").not.toBeNull();
    const w = Number(floor?.[1]);
    const h = Number(floor?.[2]);
    expect([w, h], "CSS взял другое эталонное окно").toEqual([
      desktopReference.w,
      desktopReference.h,
    ]);
    expect(w / h).toBeCloseTo(minWindowAr, 9);
    // И сама формула на месте: высота кропа ограничена min(), ширина — cover.
    expect(css).toContain("--band-cover-h: min(100dvh, calc(100vw / (var(--band-ar-min))));");
    expect(css).toContain("--band-w: max(100vw, calc(var(--band-cover-h) * var(--band-ar)));");
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

  it("телефон, окно В ПОКОЕ: 97 зон пальцем, 33 за краем — и это все 130", () => {
    // Разбиение, а не порог: у каждой зоны ровно одно из двух состояний, и
    // сумма обязана давать 130. Молча потеряться нельзя ни одной.
    //
    // «В покое» — слово тикета 55: пан двигает окно по кадру, и ПАНОМ пальцем
    // достижимы все 130 (см. блок «пан окна по кадру» ниже, там второе число).
    // Здешнее разбиение — про окно в позиции покоя (12…442), оно от пана не
    // зависит и осталось свойством кадра.
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
    // на 16:9 — 130 и 0, на 1280×800 — 125 и 5. На 1024×768 было 105 и 25
    // (13 из них в ноль), после предела кропа — те же 125 и 5, что у эталона.
    for (const row of DESKTOP_REACH) {
      const where = `${row.screen.w}×${row.screen.h}`;
      const band = sceneBand("desktop", row.screen);
      expect((band.width - row.screen.w) / 2, `${where} вылет кадра вбок`).toBeCloseTo(
        row.bleedX,
        3,
      );
      expect(sceneGap("desktop", row.screen).top, `${where} поле`).toBeCloseTo(row.field, 3);
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

  it("ни одна зона не срезана в ноль — ни на одном десктопном окне", () => {
    // ГЛАВНАЯ ПРИЁМКА ТИКЕТА 45. До предела кропа на 1024×768 тринадцать зон
    // теряли цель нажатия целиком: указатель до них доводил, но человек не
    // видел даже намёка, что комната там продолжается. Теперь их ноль.
    for (const screen of DESKTOP_SCREENS) {
      const gone = allZones.filter(({ rect }) => !tappable(rect, "desktop", screen));
      expect(
        gone.map((z) => z.id),
        `${screen.w}×${screen.h}`,
      ).toEqual([]);
    }
  });

  it("десктоп 1024×768 — порог раскладки, и он повторяет эталон зона в зону", () => {
    // 1024 — ровно та ширина, с которой включается десктопная раскладка
    // (@media min-width: 1024px), и 1024×768 — айпад в альбоме, реальное
    // устройство. Прежде пропорция 4:3 срезала по 12.8% с каждой стороны, и
    // десктоп становился телефоном: 25 зон из 130 уходили на указатель, 13 из
    // них в ноль. После тикета 45 на любом окне у́же эталона недобирают до 44 px
    // ровно те же пять зон, что и на 1280×800, — и ни одна не срезана.
    for (const screen of DESKTOP_NARROW) {
      const gone = allZones.filter(({ rect }) => !tappable(rect, "desktop", screen));
      const short = allZones.filter(
        ({ rect }) => tappable(rect, "desktop", screen) && !fullTarget(rect, "desktop", screen),
      );
      const where = `${screen.w}×${screen.h}`;
      expect(
        gone.map((z) => z.id),
        where,
      ).toEqual([]);
      expect(
        short.map((z) => z.id),
        where,
      ).toEqual(DESKTOP_1280_SHORT);
    }
    // Самая узкая цель на 1024×768 — 15 px (`lux/home`, зона у правой стены).
    // Это не ноль: зону видно, палец в неё попадает, а точная дорога —
    // указатель. Прежде у неё не было ни одного пикселя.
    const worst = Math.min(
      ...DESKTOP_1280_SHORT.map((id) => {
        const zone = allZones.find((z) => z.id === id);
        if (!zone) throw new Error(`зоны ${id} нет в контракте`);
        return zoneHitBox(zone.rect, "desktop", { w: 1024, h: 768 }).width;
      }),
    );
    expect(worst).toBeCloseTo(15, 0);
    expect(worst).toBeGreaterThan(0);
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

  it("телефон: верхняя вуаль лежит НА зонах, нижняя до кадра не достаёт", () => {
    // ПРЕЖДЕ ЗДЕСЬ СТОЯЛО «ни одна зона не лежит под полосами интерфейса», и
    // держалось это вписыванием: кадр стоял МЕЖДУ полосами, под ними физически
    // не было комнаты — а была мёртвая тёмная зона в 190 px, которую владелец и
    // увидел на стенде. Тикет 57 поднял кадр к верху экрана, и телефон стал
    // жить по десктопному правилу тикета 42: полоса лежит на комнате, зона под
    // ней — норма, нажатий полоса не берёт (`.imm-rail { pointer-events: none }`
    // в globals.css, вуаль — тем более: `.imm-veil { pointer-events: none }`).
    //
    // Числа записаны, чтобы рост был виден в диффе. Верхняя вуаль — 190 px, и
    // это 54% кадра на 430-широком телефоне против 16.5% на десктопе: кадр у
    // телефона всего 352 px высотой, а вуаль пакета (phoneImmersive.topVeil)
    // рисовалась в турне 23c поверх комнаты во весь экран 932. Отсюда и разница
    // с десктопными 34–41: задетых зон 75 из 130 на 430, 102 на 360×640.
    const touchedTop = (screen: Screen) => {
      const free = clearBand("phone", screen);
      return allZones.filter(
        ({ rect }) => zoneOnScreen(rect, "phone", screen).top < free.top - EPS,
      );
    };
    expect(touchedTop(PHONE)).toHaveLength(75);
    expect(touchedTop({ w: 390, h: 844 })).toHaveLength(91);
    expect(touchedTop({ w: 375, h: 667 })).toHaveLength(97);
    expect(touchedTop({ w: 360, h: 640 })).toHaveLength(102);

    // НИЖНЯЯ ПОЛОСА КАДРА НЕ КАСАЕТСЯ ВОВСЕ — и это тоже требование, а не
    // случайность: кадр кончается на 352 при полосе, начинающейся на 816
    // (430×932). Заедь он под неё — «Добавить вещь» и указатель зон встали бы
    // на комнату, а подсказка «коснись зоны» (она живёт внизу с тикета 52)
    // оказалась бы на кадре. На самом коротком экране обхода запас всё ещё
    // 229 px (360×640: кадр до 294.7, полоса с 524).
    for (const screen of PHONE_SCREENS) {
      const free = clearBand("phone", screen);
      const band = sceneBand("phone", screen);
      const where = `phone ${screen.w}×${screen.h}`;
      expect(bottom(band), `${where}: кадр заехал под нижнюю полосу`).toBeLessThanOrEqual(
        free.bottom + EPS,
      );
      for (const { id, rect } of allZones) {
        expect(
          bottom(zoneOnScreen(rect, "phone", screen)),
          `${id} @ ${where} заезжает под нижнюю полосу`,
        ).toBeLessThanOrEqual(free.bottom + EPS);
      }
    }
    expect(bottom(sceneBand("phone", PHONE))).toBe(352);
    expect(clearBand("phone", PHONE).bottom).toBe(816);
  });

  it("телефон: цена решения — 35 зон целиком под вуалью, и все они достижимы", () => {
    // Честная цена тикета 57, записанная числом. «Целиком под вуалью» —
    // прямоугольник зоны не выходит из полосы 0…190; на 430×932 таких 35.
    // Мера грубая: вуаль — ГРАДИЕНТ (0.92 → 0.46 на 66% → 0), и зона у её
    // нижнего края почти не притемнена. Прикидка по альфе в центре зоны (не
    // утверждение теста — градиент живёт в globals.css, не в модуле) даёт
    // мягче: на 430×932 темнее 0.5 лежат 14 зон, и 7 из них и так стоят за
    // правым краем окна в покое, — в окне реально гаснут семь.
    //
    // Это ровно тот же размен, что принял тикет 42 на десктопе (`study/money`
    // целиком под полосой), и обе дороги к таким зонам остались: указатель зон
    // строится по данным, камера доводит любую зону до середины экрана, пан
    // (тикет 55) даёт полные 44×44 каждой. Проверяем именно это.
    const swallowed = allZones.filter(({ rect }) => {
      const free = clearBand("phone", PHONE);
      return bottom(zoneOnScreen(rect, "phone", PHONE)) <= free.top + EPS;
    });
    expect(swallowed).toHaveLength(35);
    // На узком телефоне кадр ниже, а вуаль та же — тонет больше.
    const swallowedAt = (screen: Screen) =>
      allZones.filter(
        ({ rect }) =>
          bottom(zoneOnScreen(rect, "phone", screen)) <= clearBand("phone", screen).top + EPS,
      ).length;
    expect(swallowedAt({ w: 430, h: 745 })).toBe(35);
    expect(swallowedAt({ w: 390, h: 844 })).toBe(55);
    expect(swallowedAt({ w: 375, h: 667 })).toBe(66);
    expect(swallowedAt({ w: 360, h: 640 })).toBe(77);
    for (const { id, roomId, key, rect } of swallowed) {
      // Дорога 1 — пан: у каждой полные 44×44 в какой-то позиции окна.
      const hit = phoneZoneHitBoxAtPan(rect, PHONE, phonePanToZone(rect));
      expect(hit.width, `${id} ширина цели паном`).toBeGreaterThanOrEqual(hitTargetMin - EPS);
      expect(hit.height, `${id} высота цели паном`).toBeGreaterThanOrEqual(hitTargetMin - EPS);
      // Дорога 2 — указатель: либо зона в нём, либо продукт её не показывает.
      if (zoneHiddenByProduct(roomId, key)) continue;
      expect(listedInIndex.has(id), `${id}: под вуалью и не в указателе`).toBe(true);
    }
    // Ни одна из них не потеряла цель нажатия от переезда кадра: вуаль не
    // режет пиксели, она их красит (`pointer-events: none`).
    for (const { id, rect } of swallowed) {
      const box = zoneHitBox(rect, "phone", PHONE);
      const beyond = BEYOND_PHONE_WINDOW.includes(id);
      expect(box.width > 0, `${id} цель в покое`).toBe(!beyond);
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
    // 34 зоны, на 1280×800 — 41, на 1024×768 — 30 (тикет 53 переставил
    // `cream/events` на стену памяти у верха кадра — рект из rects-fix, y=74,
    // и зона легла под верхнюю полосу на всех широких вьюпортах; до предела
    // кропа на 1024×768 было 42 — обе кромки кадра тогда стояли под полосами).
    const touched = (screen: Screen) => {
      const free = clearBand("desktop", screen);
      return allZones.filter(({ rect }) => {
        const box = zoneOnScreen(rect, "desktop", screen);
        return box.top < free.top - EPS || bottom(box) > free.bottom + EPS;
      });
    };
    expect(touched({ w: 1920, h: 1080 })).toHaveLength(34);
    expect(touched(DESKTOP)).toHaveLength(41);
    expect(touched({ w: 1024, h: 768 })).toHaveLength(30);
    expect(touched({ w: 1280, h: 1024 })).toHaveLength(5);

    // ЦЕЛИКОМ под полосой почти везде лежит только `study/money`. Исключений
    // два: на 1280×720 нижняя полоса накрывает ещё и `cream/anything` (долг из
    // тикета 42 — на низком окне зону видно только сквозь полосу), а на узких
    // окнах не спрятана ни одна: кадр стал ниже, и обе его кромки вышли
    // из-под полос.
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
    // А вот у окон У́ЖЕ эталона список общий, и это тикет 45: глубина кропа у
    // них одна на всех (89.3% кадра), поэтому недобирают одни и те же зоны —
    // хотя размеры окон разные, как у 1280×800 с 1440×900.
    expect(shortAt({ w: 1024, h: 768 })).toEqual(DESKTOP_1280_SHORT);
    expect(shortAt({ w: 1280, h: 1024 })).toEqual(DESKTOP_1280_SHORT);
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

// ---------------------------------------------------------------------------
// ТРЕБОВАНИЕ ТИКЕТА 55: «окно ездит по кадру» — жестом. Третья дорога телефона.
// ---------------------------------------------------------------------------
describe("пан окна по кадру (тикет 55)", () => {
  it("диапазон пана покрывает весь кадр: окно доезжает и до 0, и до 630", () => {
    // Числа не выдуманы: min = image.x (−12), max = 630 − 430 − 12 = 188.
    const { min, max } = phonePanRange();
    expect(min).toBe(scene.phone.image.x);
    expect([min, max]).toEqual([-12, 188]);
    // Покой — прежнее окно ADR-0006, упоры — края кадра.
    expect(phoneWindowOnFrame(0)).toEqual({ left: 12, right: 442 });
    expect(phoneWindowOnFrame(min)).toEqual({ left: 0, right: 430 });
    expect(phoneWindowOnFrame(max)).toEqual({ left: 200, right: 630 });
    expect(clampPan(10_000)).toBe(max);
    expect(clampPan(-10_000)).toBe(min);
  });

  it("пан — свойство показа: при нуле совпадает с прежней проекцией x − 12", () => {
    // Та же гарантия, что у кропа тикета 42: формула с паном НЕ вторая карта
    // координат, при p = 0 она даёт ровно zoneOnScreen/zoneHitBox.
    for (const { id, rect } of allZones) {
      const box = phoneZoneOnScreenAtPan(rect, PHONE, 0);
      const classic = zoneOnScreen(rect, "phone", PHONE);
      expect(box.left, `${id} left`).toBeCloseTo(classic.left, 2);
      expect(box.top, `${id} top`).toBeCloseTo(classic.top, 2);
      expect(box.width, `${id} width`).toBeCloseTo(classic.width, 2);
      expect(box.height, `${id} height`).toBeCloseTo(classic.height, 2);
      const hit = phoneZoneHitBoxAtPan(rect, PHONE, 0);
      const classicHit = zoneHitBox(rect, "phone", PHONE);
      expect(hit.width, `${id} цель ширина`).toBeCloseTo(classicHit.width, 2);
      expect(hit.height, `${id} цель высота`).toBeCloseTo(classicHit.height, 2);
    }
  });

  it("сдвиг слоёв — px экрана: покой ноль, окно вправо ⟹ кадр влево", () => {
    // px, а не проценты: переменную читают два слоя разной ширины (сани камеры
    // и слой хотспотов), и общий процент значил бы у них разные пиксели.
    expect(phonePanShiftPx(0, 430)).toBe(0);
    expect(phonePanShiftPx(188, 430)).toBe(-188);
    expect(phonePanShiftPx(-12, 430)).toBe(12);
    // На узком телефоне пиксель кадра меньше пикселя экрана: 390/430 от хода.
    expect(phonePanShiftPx(40, 390)).toBeCloseTo(-36.2791, 3);
  });

  it("ВТОРОЕ ЧИСЛО ДОСТИЖИМОСТИ: паном пальцем — все 130, полные 44×44", () => {
    // «97 пальцем в покое» дополнено, а не переписано: у КАЖДОЙ зоны есть
    // позиция окна, в которой её цель нажатия полная. Это возможно, потому что
    // самая широкая зона контракта (269) у́же окна (430) — и тоже проверено.
    const widest = Math.max(...allZones.map((z) => z.rect.w));
    expect(widest).toBeLessThanOrEqual(scene.phone.w);
    for (const { id, rect } of allZones) {
      const pan = phonePanToZone(rect);
      expect(pan, `${id} пан в диапазоне`).toBe(clampPan(pan));
      const hit = phoneZoneHitBoxAtPan(rect, PHONE, pan);
      expect(hit.width, `${id} ширина цели при пане ${pan}`).toBeGreaterThanOrEqual(
        hitTargetMin - EPS,
      );
      expect(hit.height, `${id} высота цели при пане ${pan}`).toBeGreaterThanOrEqual(
        hitTargetMin - EPS,
      );
    }
    // И честная обратная сторона: 33 заоконным зонам пан НЕОБХОДИМ — в покое
    // полной цели у них нет (их дороги до тикета 55 — указатель и камера).
    for (const id of BEYOND_PHONE_WINDOW) {
      const zone = allZones.find((z) => z.id === id);
      if (!zone) throw new Error(`зоны ${id} нет в контракте`);
      const restHit = phoneZoneHitBoxAtPan(zone.rect, PHONE, 0);
      expect(restHit.width, `${id} в покое`).toBeLessThan(hitTargetMin - EPS);
    }
  });

  it("семь узких зон у правого края покоя тоже получают полные 44 паном", () => {
    // Долг ADR-0006 («самая узкая цель — 16 px») пан закрывает без правки
    // карты: bold/music и остальные шесть достаются целиком, стоит окну
    // отъехать. Список — тот же, что в блоке «цель нажатия» ниже.
    for (const id of [
      "cream/home",
      "emerald/home",
      "bold/music",
      "bold/home",
      "cottage/music",
      "sport/events",
      "study/events",
    ]) {
      const zone = allZones.find((z) => z.id === id);
      if (!zone) throw new Error(`зоны ${id} нет в контракте`);
      const hit = phoneZoneHitBoxAtPan(zone.rect, PHONE, phonePanToZone(zone.rect));
      expect(hit.width, `${id} ширина цели`).toBeGreaterThanOrEqual(hitTargetMin - EPS);
    }
  });

  it("намёк на край: справа в покое горит во всех 10 комнатах, слева — ни в одной", () => {
    // Правило по данным ВИДИМЫХ зон (тот же visibleZones, что у сцены и
    // указателя) с люфтом EDGE_HINT_SLACK: спрятано больше люфта — горит.
    expect(EDGE_HINT_SLACK).toBe(12);
    expect(EDGE_HINT_SLACK).toBe(-scene.phone.image.x);
    for (const room of rooms) {
      const visible = visibleZones(room.zones, []);
      const rest = phoneEdgeHints(visible, 0);
      expect(rest.right, `${room.id} справа в покое`).toBe(true);
      expect(rest.left, `${room.id} слева в покое`).toBe(false);
      // У правого упора сторона меняется: справа гаснет, слева загорается.
      const atMax = phoneEdgeHints(visible, phonePanRange().max);
      expect(atMax.right, `${room.id} справа у упора`).toBe(false);
      expect(atMax.left, `${room.id} слева у упора`).toBe(true);
    }
  });

  it("«Кремовая»: за правым краем в покое — ровно пять зон владельца", () => {
    // Тикет 55 начинается с его вопроса: «home, books, music, flowers,
    // events». Порог люфта обязан давать этот же список — home срезан краем
    // (413…475 при окне до 442), остальные четыре стоят целиком за ним.
    const cream = roomsContract.rooms.find((room) => room.id === "cream");
    if (!cream) throw new Error("комнаты cream нет в контракте");
    const win = phoneWindowOnFrame(0);
    const beyond = cream.zones
      .filter((zone) => zone.rect.x + zone.rect.w - win.right > EDGE_HINT_SLACK)
      .map((zone) => zone.key)
      .sort();
    expect(beyond).toEqual(["books", "events", "flowers", "home", "music"]);
  });

  it("десктоп не изменился ни на пиксель: пан — телефонный, cover прежний", () => {
    // Функции пана принимают только телефонные величины; десктопная коробка
    // сцены — контрольное число тикета 42 — осталась той же (JS на десктопе
    // переменных пана не пишет, CSS их жёстко глушит — см. scene.module.css).
    const refBand = sceneBand("desktop", DESKTOP);
    expect(refBand.left).toBeCloseTo(-76.8, 4);
    expect(refBand.top).toBeCloseTo(0, 4);
    expect(refBand.width).toBeCloseTo(1433.6, 4);
    expect(refBand.height).toBeCloseTo(800, 4);
    const css = readFileSync(
      fileURLToPath(new URL("../src/components/scene/scene.module.css", import.meta.url)),
      "utf8",
    );
    // Слои пана и кромки на десктопе выключены самим CSS, не только жестом.
    expect(css).toMatch(/@media \(min-width: 1024px\)[\s\S]*?\.panWindow,\s*\.hotspots \{\s*transform: none;\s*transition: none;\s*\}/u);
    expect(css).toMatch(/@media \(min-width: 1024px\)[\s\S]*?\.edgeL,\s*\.edgeR \{\s*display: none;\s*\}/u);
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
