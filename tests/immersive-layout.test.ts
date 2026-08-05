import { describe, it, expect } from "vitest";
import tokensJson from "@design/tokens.json";
import { hitTargetMin, roomsContract, scene } from "../src/config/design";
import { sceneSize, zoneScenePercent, type SceneView } from "../src/components/scene/camera";
import {
  clearBand,
  immersiveLayout,
  sceneBand,
  zoneHitBox,
  zoneOnScreen,
  type Box,
  type Screen,
} from "../src/components/scene/immersive-layout";

// Раскладка «комната во весь экран» (тикет 24).
//
// ГЛАВНОЕ ТРЕБОВАНИЕ ТИКЕТА, ради которого этот файл и существует: после
// раскладки все 13 зон каждой из 10 комнат обязаны остаться на экране целиком
// и нажимаемыми — в обеих раскладках. Проверяется числом, а не глазами.
//
// Здесь же зафиксирована развилка контракта («сцена — весь экран 430×932»
// против «сцена держит пропорцию 430:352»): тест «кадр уже упёрся в края
// экрана» показывает, ПОЧЕМУ увеличивать кадр некуда — карта зон занимает
// телефонную сцену ровно от края до края.
//
// Если тест упал — раскладка кого-то из зон потеряла. Это баг раскладки,
// а не повод поправить ожидания.

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

function right(box: Box): number {
  return box.left + box.width;
}

function bottom(box: Box): number {
  return box.top + box.height;
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
    width: Math.min(w, box.left + box.width + growX) - left,
    height: Math.min(h, box.top + box.height + growY) - top,
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

describe("все 13 зон 10 комнат целиком на экране (тикет 24, главное требование)", () => {
  it("130 зон в контракте — по 13 на комнату", () => {
    expect(allZones).toHaveLength(130);
    expect(roomsContract.rooms).toHaveLength(10);
  });

  for (const { view, screen } of VIEWS) {
    it(`${view} ${screen.w}×${screen.h}: ни одна зона не уехала за край экрана`, () => {
      for (const { id, rect } of allZones) {
        const box = zoneOnScreen(rect, view, screen);
        expect(box.left, `${id} левый край`).toBeGreaterThanOrEqual(-EPS);
        expect(box.top, `${id} верхний край`).toBeGreaterThanOrEqual(-EPS);
        expect(right(box), `${id} правый край`).toBeLessThanOrEqual(screen.w + EPS);
        expect(bottom(box), `${id} нижний край`).toBeLessThanOrEqual(screen.h + EPS);
        expect(box.width, `${id} ширина`).toBeGreaterThan(0);
        expect(box.height, `${id} высота`).toBeGreaterThan(0);
      }
    });

    it(`${view} ${screen.w}×${screen.h}: ни одна зона не лежит под полосами интерфейса`, () => {
      // Полосы держат заголовок, служебные ссылки, «Добавить вещь» и значок
      // «поделиться». Зона под ними была бы видна, но не нажимаема — это и
      // есть «нажимаемы» из требования тикета.
      const free = clearBand(view, screen);
      for (const { id, rect } of allZones) {
        const box = zoneOnScreen(rect, view, screen);
        expect(box.top, `${id} заезжает под верхнюю полосу`).toBeGreaterThanOrEqual(free.top - EPS);
        expect(bottom(box), `${id} заезжает под нижнюю полосу`).toBeLessThanOrEqual(
          free.bottom + EPS,
        );
      }
    });
  }

  it("раскладка держится и на других вьюпортах, не только на двух проверочных", () => {
    const sweep: Array<{ view: SceneView; screen: Screen }> = [
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
        expect(box.left, `${where} левый край`).toBeGreaterThanOrEqual(-EPS);
        expect(right(box), `${where} правый край`).toBeLessThanOrEqual(screen.w + EPS);
        expect(box.top, `${where} верх`).toBeGreaterThanOrEqual(free.top - EPS);
        expect(bottom(box), `${where} низ`).toBeLessThanOrEqual(free.bottom + EPS);
      }
    }
  });
});

describe("цель нажатия зоны (rooms.json → hitTargetMin)", () => {
  it("десктоп: все 130 зон получают полные 44×44", () => {
    for (const { id, rect } of allZones) {
      const hit = zoneHitBox(rect, "desktop", DESKTOP);
      expect(hit.width, `${id} ширина цели`).toBeGreaterThanOrEqual(hitTargetMin - EPS);
      expect(hit.height, `${id} высота цели`).toBeGreaterThanOrEqual(hitTargetMin - EPS);
    }
  });

  it("телефон: 44×44 у всех, кроме восьми зон у правого края кадра", () => {
    // Телефонный кроп режет кадр по x = 430, и у зоны, упёршейся в этот край,
    // добивка до 44 px обрезается вместе с кадром. Это геометрия пакета, а не
    // раскладки: список и числа те же, что были до тикета (проверка ниже).
    const narrow = allZones
      .map(({ id, rect }) => ({ id, hit: zoneHitBox(rect, "phone", PHONE) }))
      .filter(({ hit }) => hit.width < hitTargetMin - EPS || hit.height < hitTargetMin - EPS);

    expect(narrow.map((z) => z.id)).toEqual([
      "cream/flowers",
      "lux/flowers",
      "emerald/flowers",
      "bold/music",
      "cottage/music",
      "cottage/flowers",
      "cottage/home",
      "gamer/events",
    ]);
    // Самая узкая цель на телефоне — 35×45 px: палец попадает.
    const worst = Math.min(...narrow.map((z) => z.hit.width));
    expect(worst).toBeCloseTo(35, 2);
    for (const { id, hit } of narrow) {
      expect(hit.height, `${id} высота цели`).toBeGreaterThanOrEqual(hitTargetMin - EPS);
    }
  });

  it("нажимать не стало хуже ни в одной зоне: цель не меньше прежней", () => {
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
  it("телефон: карта зон занимает кадр ровно от края до края экрана", () => {
    // Это и есть ответ на «сцена — весь экран 430×932». Крайние зоны стоят
    // ВПЛОТНУЮ к обеим сторонам сцены: увеличить кадр — значит вынести их за
    // экран. Запас равен нулю, а не «маленький».
    const band = sceneBand("phone", PHONE);
    const boxes = allZones.map(({ rect }) => zoneOnScreen(rect, "phone", PHONE));
    const left = Math.min(...boxes.map((b) => b.left));
    const rightEdge = Math.max(...boxes.map(right));
    expect(left - band.left).toBeCloseTo(0, 3);
    expect(band.left + band.width - rightEdge).toBeCloseTo(0, 3);
    // По вертикали запас тоже нулевой: зоны занимают 5…352 из 352.
    const top = Math.min(...boxes.map((b) => b.top));
    const bottomEdge = Math.max(...boxes.map(bottom));
    expect(top - band.top).toBeCloseTo((5 / scene.phone.h) * band.height, 2);
    expect(band.top + band.height - bottomEdge).toBeCloseTo(0, 2);
  });

  it("десктоп: кадру есть куда расти, и он растёт вместе с окном", () => {
    // Десктопная сцена видит кадр целиком (630 px пакета), а карта зон — его
    // левые 68%: по вертикали запаса нет, поэтому размер задаёт высота окна.
    const short = sceneBand("desktop", { w: 1280, h: 800 });
    const tall = sceneBand("desktop", { w: 1920, h: 1080 });
    expect(tall.width).toBeGreaterThan(short.width);
    // На высоком окне сцена крупнее прежнего холста 1120×625.
    expect(tall.width).toBeGreaterThan(scene.desktop.w);
    // Ширину экрана кадр не перерастает: зоны обязаны остаться в кадре.
    expect(tall.width).toBeLessThanOrEqual(1920);
  });
});
