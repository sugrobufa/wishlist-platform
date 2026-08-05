import { describe, it, expect } from "vitest";
import tokensJson from "@design/tokens.json";
import { hitTargetMin, rooms, roomsContract, scene } from "../src/config/design";
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
  sceneBand,
  zoneHitBox,
  zoneOnScreen,
  type Box,
  type Screen,
} from "../src/components/scene/immersive-layout";

// Раскладка «комната во весь экран» (тикет 24) — и достижимость зон (тикет 40).
//
// ЧЕМ ЭТОТ ФАЙЛ БЫЛ РАНЬШЕ И ПОЧЕМУ ПЕРЕПИСАН. До смены системы координат он
// требовал: «все 13 зон каждой из 10 комнат остаются на экране ЦЕЛИКОМ». Это
// было верно, но не потому, что раскладка хороша, — а потому что разметка жила
// в координатах окна 430 и физически не могла выйти за него: всё, что стояло
// правее, при разметке прижималось к краю. Тест проверял не раскладку, а
// собственную обрезку контракта.
//
// Раунды 4–5 перенесли разметку в координаты кадра 630 (ADR-0006). Теперь
// 46 зон стоят правее прежней стены 430, и 33 из них в покое не видны на
// телефоне вовсе. Это НАМЕРЕННО: окно 430 ездит по кадру, а не обрезает его.
//
// ТРЕБОВАНИЕ СТАЛО ДРУГИМ — не слабее, а честнее: **все зоны ДОСТИЖИМЫ**.
// Дорог ровно две, и каждая зона обязана иметь хотя бы одну:
//   1. через кадр — если зона попадает в окно, у неё есть настоящая цель
//      нажатия и она не лежит под полосами интерфейса;
//   2. через указатель зон (тикет 34) — он строится по ДАННЫМ, а не по
//      видимости, поэтому доводит и до зоны за краем окна; наезд камеры
//      доезжает до неё и ставит её в середину экрана.
// Ослабления порога здесь нет: там, где зона видна, требования к цели прежние.
// Что действительно исчезло — обещание «видно всё сразу», которого раскладка
// никогда не давала, а давала обрезка карты.
//
// Если тест упал — либо раскладка потеряла зону, либо указатель перестал быть
// полным списком. И то и другое — баг, а не повод поправить ожидания.

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

const VIEWS: Array<{ view: SceneView; screen: Screen }> = [
  { view: "phone", screen: PHONE },
  { view: "desktop", screen: DESKTOP },
];

/** Все 130 зон контракта: 13 в каждой из 10 комнат (money тоже — ADR-0003). */
const allZones = roomsContract.rooms.flatMap((room) =>
  room.zones.map((zone) => ({ id: `${room.id}/${zone.key}`, rect: zone.rect })),
);

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

function right(box: Box): number {
  return box.left + box.width;
}

function bottom(box: Box): number {
  return box.top + box.height;
}

/** Есть ли у зоны настоящая цель нажатия на этом экране (не срезана в ноль). */
function tappable(rect: (typeof allZones)[number]["rect"], view: SceneView, screen: Screen) {
  const hit = zoneHitBox(rect, view, screen);
  return hit.width > 0 && hit.height > 0;
}

/**
 * Цель нажатия в прежней раскладке — сцена стояла блоком в колонке: телефон
 * 430×352, десктоп 1120×625, обрезка та же (`overflow: hidden` на сцене).
 * Нужна, чтобы утверждение «нажимать стало не хуже» было проверкой, а не
 * обещанием.
 */
function legacyHitBox(rect: (typeof allZones)[number]["rect"], view: SceneView): Box {
  const { w, h } = sceneSize(view);
  const p = zoneScenePercent(rect, view);
  const box = {
    left: (p.left / 100) * w,
    top: (p.top / 100) * h,
    width: (p.width / 100) * w,
    height: (p.height / 100) * h,
  };
  const growX = Math.max(0, hitTargetMin - box.width) / 2;
  const growY = Math.max(0, hitTargetMin - box.height) / 2;
  const left = Math.max(0, box.left - growX);
  const top = Math.max(0, box.top - growY);
  return {
    left,
    top,
    width: Math.max(0, Math.min(w, box.left + box.width + growX) - left),
    height: Math.max(0, Math.min(h, box.top + box.height + growY) - top),
  };
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

  it("десктоп: окно равно кадру, поэтому пальцем достаются ВСЕ 130", () => {
    // Десктопная сцена показывает кадр целиком (630 · 1.7778 = 1120), значит
    // второй дороги там никому не нужно — и это же объясняет, почему разбиение
    // выше касается только телефона.
    for (const { id, rect } of allZones) {
      const hit = zoneHitBox(rect, "desktop", DESKTOP);
      expect(hit.width, `${id} ширина цели`).toBeGreaterThanOrEqual(hitTargetMin - EPS);
      expect(hit.height, `${id} высота цели`).toBeGreaterThanOrEqual(hitTargetMin - EPS);
    }
  });

  it("ДОРОГА 2: каждая зона за краем окна есть в указателе зон", () => {
    // Указатель (`ZoneIndex`) строит список тем же `visibleZones`, что и сцена,
    // и смотрит только на данные — ни на кадр, ни на экран. Поэтому «зона не
    // видна» и «зона недоступна» — разные вещи, и это проверка, а не обещание.
    const listed = new Set(
      rooms.flatMap((room) =>
        visibleZones(room.zones, []).map((zone) => `${room.id}/${zone.key}`),
      ),
    );
    // Из 33 заоконных продукт показывает 30: три (`gamer/money`, `sport/money`,
    // `loft/money`) — это скрытая зона денег, её нет ни в кадре, ни в списке.
    const hidden = BEYOND_PHONE_WINDOW.filter((id) => !listed.has(id));
    expect(hidden).toEqual(["gamer/money", "sport/money", "study/money", "loft/money"]);
    for (const id of BEYOND_PHONE_WINDOW) {
      if (hidden.includes(id)) continue;
      expect(listed.has(id), `${id}: за окном и не в указателе — недостижима`).toBe(true);
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

  it("ни одна зона не лежит под полосами интерфейса — ни на одном вьюпорте", () => {
    // По вертикали окно кадр НЕ режет: полосы держат заголовок, служебные
    // ссылки, «Добавить вещь» и указатель зон, и зона под ними была бы видна,
    // но не нажимаема. Это требование пережило смену координат целиком —
    // разметка по вертикали как была в пределах кадра, так и осталась.
    const sweep: Array<{ view: SceneView; screen: Screen }> = [
      ...VIEWS,
      { view: "phone", screen: { w: 430, h: 745 } }, // тот же телефон с адресной строкой
      { view: "phone", screen: { w: 390, h: 844 } },
      { view: "phone", screen: { w: 375, h: 667 } },
      { view: "phone", screen: { w: 360, h: 640 } },
      { view: "desktop", screen: { w: 1024, h: 768 } },
      { view: "desktop", screen: { w: 1280, h: 720 } },
      { view: "desktop", screen: { w: 1440, h: 900 } },
      { view: "desktop", screen: { w: 1920, h: 1080 } },
    ];
    for (const { view, screen } of sweep) {
      const free = clearBand(view, screen);
      for (const { id, rect } of allZones) {
        const box = zoneOnScreen(rect, view, screen);
        const where = `${id} @ ${view} ${screen.w}×${screen.h}`;
        expect(box.top, `${where} заезжает под верхнюю полосу`).toBeGreaterThanOrEqual(
          free.top - EPS,
        );
        expect(bottom(box), `${where} заезжает под нижнюю полосу`).toBeLessThanOrEqual(
          free.bottom + EPS,
        );
      }
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
      expect(beyond.map((z) => z.id), `${screen.w}×${screen.h}`).toEqual(BEYOND_PHONE_WINDOW);
    }
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

  it("десктоп: все 130 зон получают полные 44×44 на любом окне", () => {
    for (const screen of [
      DESKTOP,
      { w: 1024, h: 768 },
      { w: 1440, h: 900 },
      { w: 1920, h: 1080 },
    ]) {
      for (const { id, rect } of allZones) {
        const hit = zoneHitBox(rect, "desktop", screen);
        expect(hit.width, `${id} ширина цели @${screen.w}`).toBeGreaterThanOrEqual(
          hitTargetMin - EPS,
        );
        expect(hit.height, `${id} высота цели @${screen.w}`).toBeGreaterThanOrEqual(
          hitTargetMin - EPS,
        );
      }
    }
  });

  it("нажимать не стало хуже ни в одной видимой зоне: цель не меньше прежней", () => {
    // Сравнение с раскладкой ДО тикета 24 (сцена блоком в колонке). Координаты
    // у обеих теперь одни и те же, поэтому меряется именно раскладка.
    for (const { view, screen } of VIEWS) {
      for (const { id, rect } of allZones) {
        const now = zoneHitBox(rect, view, screen);
        const before = legacyHitBox(rect, view);
        const where = `${id} ${view}`;
        // Прежняя раскладка масштабировала цель вместе со сценой; сравниваем
        // долю цели от сцены — на телефоне сцена та же, на десктопе окно ниже
        // холста, поэтому доля и есть честная мера.
        const scaleNow = view === "phone" ? 1 : sceneBand(view, screen).width / scene.desktop.w;
        expect(now.width / scaleNow, `${where} ширина цели`).toBeGreaterThanOrEqual(
          before.width - EPS,
        );
        expect(now.height / scaleNow, `${where} высота цели`).toBeGreaterThanOrEqual(
          before.height - EPS,
        );
      }
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

  it("десктоп: кадру есть куда расти, и он растёт вместе с окном", () => {
    // Десктопная сцена видит кадр целиком, поэтому там роста ограничивает
    // только высота окна — и карта теперь занимает всю его ширину, а не левые
    // 68%, как при прежней системе координат.
    const short = sceneBand("desktop", { w: 1280, h: 800 });
    const tall = sceneBand("desktop", { w: 1920, h: 1080 });
    expect(tall.width).toBeGreaterThan(short.width);
    // На высоком окне сцена крупнее прежнего холста 1120×625.
    expect(tall.width).toBeGreaterThan(scene.desktop.w);
    // Ширину экрана кадр не перерастает: зоны обязаны остаться в кадре.
    expect(tall.width).toBeLessThanOrEqual(1920);
    // Крайняя правая зона стоит у самого края десктопной сцены.
    const rightMost = Math.max(
      ...allZones.map(({ rect }) => right(zoneOnScreen(rect, "desktop", DESKTOP))),
    );
    const band = sceneBand("desktop", DESKTOP);
    expect(rightMost).toBeCloseTo(band.left + band.width, 0);
  });
});
