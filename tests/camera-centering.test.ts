import { describe, it, expect } from "vitest";
import { cameraScale, rooms, roomsContract, sceneMotion } from "../src/config/design";
import {
  cameraOrigin,
  computeZoneCamera,
  frameGapAfterZoom,
  frameRect,
  sceneSize,
  viewportCenter,
  zoneCenterAfterCamera,
  zoneRectFor,
  type SceneView,
} from "../src/components/scene/camera";

// Баг приёмки 20: после клика зона обязана оказаться в центре видимой области.
// Контракт motion.json → openZone[0] делит смещение на scale, а браузер тем же
// scale его домножает (scale стоит в списке функций снаружи translate) — зона
// недоезжала на (scale − 1) · расстояние_до_центра. Разбор — docs/adr/0002.
//
// Здесь три уровня проверки:
//   1. модель «что делает браузер» собрана независимо, матрицами;
//   2. чистая функция zoneCenterAfterCamera сверена с этой моделью;
//   3. все зоны обеих раскладок приезжают в центр вьюпорта.
//
// Раунд 2 пакета (тикет 21) достроил карту с 84 зон до 130; продукт рендерит
// 120 — зона `money` спрятана до записи в zones.json (ADR-0003). Числа полос и
// пустоты пересчитаны на этот набор, выводы ADR-0002 не изменились.

const VIEWS = ["phone", "desktop"] as const;

const allZones = rooms.flatMap((room) =>
  room.zones.map((zone) => ({ id: `${room.id}/${zone.key}`, rect: zone.rect })),
);

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`не найдено: ${what}`);
  return value;
}

// ---------- независимая модель CSS-трансформа (матрицы, как в браузере) -----

type Matrix = readonly [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

function mul(m: Matrix, n: Matrix): Matrix {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}
const translate = (x: number, y: number): Matrix => [1, 0, 0, 1, x, y];
const scaleM = (s: number): Matrix => [s, 0, 0, s, 0, 0];
const apply = (m: Matrix, p: { x: number; y: number }) => ({
  x: m[0] * p.x + m[2] * p.y + m[4],
  y: m[1] * p.x + m[3] * p.y + m[5],
});

/**
 * Точка слоя `.camera` после `transform-origin: o; transform: scale(S) translate(t%)`.
 * Браузер собирает M = T(o) · S · T(t) · T(−o); проценты translate берутся от
 * размера самого слоя (он `inset: 0`, то есть равен вьюпорту сцены).
 */
function throughCss(p: { x: number; y: number }, rect: typeof allZones[number]["rect"], view: SceneView) {
  const { w, h } = sceneSize(view);
  const o = cameraOrigin(view);
  const { scale, dx, dy } = computeZoneCamera(rect, view);
  const m = [
    translate(o.x, o.y),
    scaleM(scale),
    translate((dx / 100) * w, (dy / 100) * h),
    translate(-o.x, -o.y),
  ].reduce(mul, IDENTITY);
  return apply(m, p);
}

describe("наезд доводит зону до центра (тикет 20)", () => {
  it("чистая функция совпадает с матричной моделью браузера (120 зон × 2 вида)", () => {
    expect(allZones).toHaveLength(120);
    for (const view of VIEWS) {
      for (const { id, rect } of allZones) {
        const r = zoneRectFor(rect, view);
        const centre = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
        const viaMatrix = throughCss(centre, rect, view);
        const viaFn = zoneCenterAfterCamera(rect, view);
        expect(viaFn.x, `${id} ${view} x`).toBeCloseTo(viaMatrix.x, 9);
        expect(viaFn.y, `${id} ${view} y`).toBeCloseTo(viaMatrix.y, 9);
      }
    }
  });

  it("центр зоны после трансформации = центр вьюпорта (120 зон × 2 вида)", () => {
    for (const view of VIEWS) {
      const c = viewportCenter(view);
      const { w, h } = sceneSize(view);
      for (const { id, rect } of allZones) {
        const got = zoneCenterAfterCamera(rect, view);
        expect(got.x, `${id} ${view} x`).toBeCloseTo(c.x, 9);
        expect(got.y, `${id} ${view} y`).toBeCloseTo(c.y, 9);
        // Критерий приёмки — допуск 2% ширины/высоты экрана; берём с запасом.
        expect(Math.abs(got.x - c.x) / w, `${id} ${view} промах X`).toBeLessThan(0.0001);
        expect(Math.abs(got.y - c.y) / h, `${id} ${view} промах Y`).toBeLessThan(0.0001);
      }
    }
  });

  it("угловые точки зоны едут вместе с центром (масштаб не перекошен)", () => {
    const view: SceneView = "desktop";
    const rect = must(
      must(
        rooms.find((room) => room.id === "bold"),
        "комната bold",
      ).zones.find((zone) => zone.key === "music"),
      "зона bold/music",
    ).rect;
    const r = zoneRectFor(rect, view);
    const { scale } = computeZoneCamera(rect, view);
    const tl = throughCss({ x: r.x, y: r.y }, rect, view);
    const br = throughCss({ x: r.x + r.w, y: r.y + r.h }, rect, view);
    expect(br.x - tl.x).toBeCloseTo(r.w * scale, 6);
    expect(br.y - tl.y).toBeCloseTo(r.h * scale, 6);
    const c = viewportCenter(view);
    expect((tl.x + br.x) / 2).toBeCloseTo(c.x, 6);
    expect((tl.y + br.y) / 2).toBeCloseTo(c.y, 6);
  });

  it("формула контракта (с делением на scale) промахивается на (S−1)·смещение", () => {
    // Именной тест на сам баг: считаем ровно то, что написано в motion.json,
    // и показываем, куда это приводит. Если формулу контракта поправят — тест
    // упадёт и напомнит про ADR-0002.
    expect(roomsContract.cameraScale.phone).toBe(1.72);
    expect(roomsContract.cameraScale.desktop).toBe(1.45);
    const bold = must(
      rooms.find((room) => room.id === "bold"),
      "комната bold",
    );
    const music = must(
      bold.zones.find((zone) => zone.key === "music"),
      "зона bold/music",
    );

    const missOf = (view: SceneView) => {
      const { w, h } = sceneSize(view);
      const scale = cameraScale[view];
      const r = zoneRectFor(music.rect, view);
      const c = viewportCenter(view);
      const zc = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
      // Контрактный translate в px и экранный сдвиг (браузер домножает на scale).
      const tx = ((c.x - zc.x) / w / scale) * w;
      const shift = tx * scale;
      const landed = c.x + scale * (zc.x - c.x) + shift;
      return { pxX: landed - c.x, pctX: ((landed - c.x) / w) * 100, h };
    };

    // Телефон: 145 px вправо на сцене 430 — зона улетает за правый край.
    expect(missOf("phone").pxX).toBeCloseTo(145.4, 1);
    expect(missOf("phone").pctX).toBeCloseTo(33.8, 1);
    // Десктоп: 91 px вправо на сцене 1120 — зона видна, но не в фокусе.
    expect(missOf("desktop").pxX).toBeCloseTo(91.2, 1);
    expect(missOf("desktop").pctX).toBeCloseTo(8.1, 1);

    // Тот же промах через общую формулу: (S − 1) · расстояние до центра.
    for (const view of VIEWS) {
      const r = zoneRectFor(music.rect, view);
      const c = viewportCenter(view);
      const expected = (cameraScale[view] - 1) * (r.x + r.w / 2 - c.x);
      expect(missOf(view).pxX, view).toBeCloseTo(expected, 6);
      // А починенный расчёт даёт ноль.
      expect(zoneCenterAfterCamera(music.rect, view).x - c.x, view).toBeCloseTo(0, 9);
    }
  });

  it("origin наезда берётся из контракта, а не из головы", () => {
    expect(sceneMotion.camera.origin).toBe("50% 50%");
    expect(sceneMotion.camera.originPct).toEqual({ x: 50, y: 50 });
    for (const view of VIEWS) {
      expect(cameraOrigin(view)).toEqual(viewportCenter(view));
    }
  });
});

// ---------- краевые зоны: пустота, зажим и почему его нет -------------------

describe("краевые зоны: сколько пустоты открывает кадр (решение ADR-0002)", () => {
  /**
   * Независимый вывод: пустоты не будет ровно тогда, когда центр зоны лежит не
   * ближе некоторого расстояния к краю кадра. Порог считается из «сдвиг ≤ запас»,
   * а не из той же модели прямоугольников, что в коде, — это перекрёстная сверка.
   */
  function band(view: SceneView, axis: "x" | "y") {
    const { w, h } = sceneSize(view);
    const f = frameRect(view);
    const size = axis === "x" ? w : h;
    const a = axis === "x" ? f.x : f.y;
    const len = axis === "x" ? f.w : f.h;
    const scale = cameraScale[view];
    const m = sceneMotion.drift.scaleFrom;
    const k = scale * m;
    const c = size / 2;
    const pen = (sceneMotion.drift.translatePct / 100) * size * m * scale;
    return {
      lo: (c + (a - c) * k + scale * c + pen) / scale,
      hi: (c + (a + len - c) * k + scale * c - pen - size) / scale,
    };
  }

  it("пустота появляется ровно у зон вне полосы центрируемости (120 × 2 × 2)", () => {
    for (const view of VIEWS) {
      for (const axis of ["x", "y"] as const) {
        const { lo, hi } = band(view, axis);
        for (const { id, rect } of allZones) {
          const r = zoneRectFor(rect, view);
          const centre = axis === "x" ? r.x + r.w / 2 : r.y + r.h / 2;
          const gap = frameGapAfterZoom(rect, view);
          const exposed = axis === "x" ? gap.left > 0 || gap.right > 0 : gap.top > 0 || gap.bottom > 0;
          expect(exposed, `${id} ${view} ${axis}`).toBe(!(centre >= lo - 1e-6 && centre <= hi + 1e-6));
        }
      }
    }
  });

  it("полоса центрируемости: телефон 17..86% / 25..75%, десктоп 31..69% кадра", () => {
    // Числа для дизайн-сессии: только зоны, чей центр внутри полосы, можно
    // довести до середины экрана, ничего не обнажив. Всё остальное — вопрос к
    // партитуре (запас кадра), а не к коду.
    const pct = (view: SceneView, axis: "x" | "y") => {
      const f = frameRect(view);
      const a = axis === "x" ? f.x : f.y;
      const len = axis === "x" ? f.w : f.h;
      const { lo, hi } = band(view, axis);
      return { lo: ((lo - a) / len) * 100, hi: ((hi - a) / len) * 100 };
    };
    expect(pct("phone", "x").lo).toBeCloseTo(17.1, 1);
    expect(pct("phone", "x").hi).toBeCloseTo(85.7, 1);
    expect(pct("phone", "y").lo).toBeCloseTo(25.4, 1);
    expect(pct("phone", "y").hi).toBeCloseTo(74.6, 1);
    expect(pct("desktop", "x").lo).toBeCloseTo(30.7, 1);
    expect(pct("desktop", "x").hi).toBeCloseTo(69.3, 1);
    expect(pct("desktop", "y").lo).toBeCloseTo(30.7, 1);
    expect(pct("desktop", "y").hi).toBeCloseTo(69.2, 1);
  });

  it("зажима смещения нет: худшая пустота — та, что даёт сам масштаб", () => {
    // Зажим по границам кадра НЕ добавлен намеренно (ADR-0002): он сдвигает
    // центр ровно на ту же величину, что и пустота, то есть возвращает баг —
    // и как раз на зонах, которые приёмка проверяет («Что угодно» у низа).
    // Эти числа — граница допустимого; поедут они только вместе с решением.
    const worst = (view: SceneView) => {
      const { w, h } = sceneSize(view);
      let left = 0;
      let bottom = 0;
      let top = 0;
      let clean = 0;
      for (const { rect } of allZones) {
        const g = frameGapAfterZoom(rect, view);
        left = Math.max(left, (g.left / w) * 100);
        top = Math.max(top, (g.top / h) * 100);
        bottom = Math.max(bottom, (g.bottom / h) * 100);
        if (g.left + g.right + g.top + g.bottom === 0) clean++;
      }
      return { left, top, bottom, clean };
    };
    // Числа пересчитаны на карту раунда 2 (120 зон в рендере вместо 84).
    // Верх подрос с 4.4% до 24.9%: достроенные зоны (книги, музыка, цветы)
    // стоят выше прежних, и наезд на них обнажает кадр сверху.
    const phone = worst("phone");
    expect(phone.clean).toBe(72);
    expect(phone.left).toBeCloseTo(23.2, 1);
    expect(phone.top).toBeCloseTo(24.9, 1);
    expect(phone.bottom).toBeCloseTo(28.9, 1);

    const desktop = worst("desktop");
    expect(desktop.clean).toBe(55);
    expect(desktop.left).toBeCloseTo(33.1, 1);
    expect(desktop.top).toBeCloseTo(28.8, 1);
    expect(desktop.bottom).toBeCloseTo(32.2, 1);
  });

  it("зона остаётся на экране целиком — кроме той, что шире экрана сама по себе", () => {
    // После верного наезда зона стоит по центру, поэтому «влезает» = её размер
    // после масштаба не больше вьюпорта. Единственное исключение — bold/anything
    // (269 px в сцене 430): она не влезает ни при каком центре, это разметка.
    const tooBig: string[] = [];
    for (const view of VIEWS) {
      const { w, h } = sceneSize(view);
      const scale = cameraScale[view];
      for (const { id, rect } of allZones) {
        const r = zoneRectFor(rect, view);
        if (r.w * scale > w + 1 || r.h * scale > h + 1) tooBig.push(`${id} ${view}`);
      }
    }
    expect(tooBig).toEqual(["bold/anything phone"]);
  });
});
