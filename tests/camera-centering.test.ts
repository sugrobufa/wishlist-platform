import { describe, it, expect } from "vitest";
import { rooms, roomsContract, sceneMotion } from "../src/config/design";
import {
  cameraOrigin,
  computeZoneCamera,
  frameGapAfterZoom,
  frameRect,
  sceneSize,
  viewportCenter,
  walkScore,
  zoneCenterAfterCamera,
  zoneRectFor,
  type SceneView,
} from "../src/components/scene/camera";

// Баг приёмки 20: после клика зона обязана оказаться в центре видимой области.
// Контракт motion.json → openZone делит смещение на scale, а браузер тем же
// scale его домножал (scale стоял в списке функций снаружи translate) — зона
// недоезжала на (scale − 1) · расстояние_до_центра. Разбор — docs/adr/0002.
//
// Здесь три уровня проверки:
//   1. модель «что делает браузер» собрана независимо, матрицами;
//   2. чистая функция zoneCenterAfterCamera сверена с этой моделью;
//   3. все зоны обеих раскладок приезжают в центр вьюпорта.
//
// Раунд 2 пакета (тикет 21) достроил карту с 84 зон до 130; продукт рендерит
// 120 — зона `money` спрятана до записи в zones.json (ADR-0003).
//
// Тикет 22 разложил наезд на ПЯТЬ вложенных слоёв и перевёл масштаб на формулу.
// Модель браузера ниже переписана под настоящую стопку слоёв (иначе она
// проверяла бы не тот DOM, что живёт в сцене), сами требования к центровке —
// те же и с теми же допусками. Числа полос и пустоты пересчитаны под новый
// масштаб: они всегда были следствием scale, а не отдельным решением.
// Выводы ADR-0002 не изменились.

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

/** Слой `inset: 0` с `transform-origin: o`: M = T(o) · X · T(−o). */
function layer(x: Matrix, o: { x: number; y: number }): Matrix {
  return [translate(o.x, o.y), x, translate(-o.x, -o.y)].reduce(mul, IDENTITY);
}

/**
 * Точка кадра после ВСЕЙ стопки слоёв наезда — так, как её собирает браузер.
 *
 * Разметка (SceneStage): .camera(вес) → .over(перелёт) → .settle(оседание) →
 * .pan(сдвиг) → .zoom(масштаб). Внешний слой применяется последним, поэтому
 * матрицы перемножаются в том же порядке, слева направо. Все слои `inset: 0`,
 * то есть равны вьюпорту сцены, и проценты translate берутся от него.
 *
 * `moment` — узел партитуры: «settled» это конец походки (жест сложился в
 * единицу), «peak» — верхняя точка перелёта, когда масштаб на 3% больше.
 */
function throughCss(
  p: { x: number; y: number },
  rect: (typeof allZones)[number]["rect"],
  view: SceneView,
  moment: "settled" | "peak" = "settled",
) {
  const { w, h } = sceneSize(view);
  const o = cameraOrigin(view);
  const { scale, dx, dy } = computeZoneCamera(rect, view);
  const score = walkScore(view);
  const num = (transform: string) => Number(transform.replace(/[^\d.]/gu, ""));
  const gesture = [
    num(score.lead.on),
    num(score.over.on),
    // На пике перелёта слой оседания ещё в единице.
    moment === "peak" ? 1 : num(score.settle.on),
  ];
  const m = [
    ...gesture.map((k) => layer(scaleM(k), o)),
    translate((dx / 100) * w, (dy / 100) * h),
    layer(scaleM(scale), o),
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

  it("прежняя формула (с делением на scale) промахивалась на (S−1)·смещение", () => {
    // Именной тест на сам баг. Раунд 4 формулу контракта ИСПРАВИЛ (см. тест
    // ниже), поэтому здесь она уже не читается из motion.json, а считается
    // руками — как памятка о том, что именно чинил ADR-0002 и какой ценой.
    // Масштабы берём из блока `cameraScale`, помеченного в контракте устаревшим:
    // это ровно те числа, при которых замерялся промах приёмки.
    expect(roomsContract.cameraScale.phone).toBe(1.72);
    expect(roomsContract.cameraScale.desktopLegacy).toBe(1.45);
    const legacyScale: Record<SceneView, number> = {
      phone: roomsContract.cameraScale.phone,
      desktop: roomsContract.cameraScale.desktopLegacy,
    };
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
      const scale = legacyScale[view];
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
      const expected = (legacyScale[view] - 1) * (r.x + r.w / 2 - c.x);
      expect(missOf(view).pxX, view).toBeCloseTo(expected, 6);
      // А починенный расчёт даёт ноль.
      expect(zoneCenterAfterCamera(music.rect, view).x - c.x, view).toBeCloseTo(0, 9);
    }
  });

  it("раунд 4: контракт считает сдвиг без деления на scale — отступления больше нет", () => {
    // Это снятие расхождения, ради которого писался ADR-0002. Формула пакета
    // теперь совпадает с тем, что считает код; флаг сторожит, чтобы деление
    // не вернулось в следующем пакете молча.
    expect(sceneMotion.camera.panFormula.dividesByScale).toBe(false);
    expect(sceneMotion.camera.panFormula.dx).toBe("((sceneW/2 - (x + w/2)) / sceneW) * 100");
    expect(sceneMotion.camera.panFormula.dy).toBe("((sceneH/2 - (y + h/2)) / sceneH) * 100");

    // И буква контракта, посчитанная как написано, доводит зону до центра —
    // с тем единственным множителем S, который ставит стопка слоёв (тикет 22:
    // сдвиг лежит СНАРУЖИ масштаба, поэтому браузер его больше не домножает).
    for (const view of VIEWS) {
      const { w, h } = sceneSize(view);
      const c = viewportCenter(view);
      for (const { id, rect } of allZones) {
        const r = zoneRectFor(rect, view);
        const { scale, dx, dy } = computeZoneCamera(rect, view);
        const contractDx = ((w / 2 - (r.x + r.w / 2)) / w) * 100;
        const contractDy = ((h / 2 - (r.y + r.h / 2)) / h) * 100;
        expect(dx, `${id} ${view} dx`).toBeCloseTo(contractDx * scale, 9);
        expect(dy, `${id} ${view} dy`).toBeCloseTo(contractDy * scale, 9);
        expect(zoneCenterAfterCamera(rect, view).x - c.x, `${id} ${view}`).toBeCloseTo(0, 9);
      }
    }
  });

  it("перелёт на 3% делает кадр крупнее, но не сдвигает зону с центра", () => {
    // Ловушка тикета 22: слои жеста (вес, перелёт, оседание) стоят СНАРУЖИ
    // слоя сдвига, поэтому их множитель сокращается в условии центровки.
    // Если бы перелёт лежал внутри сдвига, зону уводило бы на (k−1)·S·|zc − c| —
    // до 4.4% ширины на телефоне, вдвое больше допуска приёмки в 2%.
    for (const view of VIEWS) {
      const c = viewportCenter(view);
      const { w, h } = sceneSize(view);
      let worstInside = 0;
      for (const { id, rect } of allZones) {
        const r = zoneRectFor(rect, view);
        const centre = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
        const peak = throughCss(centre, rect, view, "peak");
        expect(peak.x, `${id} ${view} x на перелёте`).toBeCloseTo(c.x, 9);
        expect(peak.y, `${id} ${view} y на перелёте`).toBeCloseTo(c.y, 9);

        // Тот же перелёт, но повешенный ВНУТРИ сдвига — для сравнения.
        const { scale } = computeZoneCamera(rect, view);
        const k = sceneMotion.walk.scale.overshoot;
        worstInside = Math.max(
          worstInside,
          Math.abs((k - 1) * scale * (centre.x - c.x)) / w,
          Math.abs((k - 1) * scale * (centre.y - c.y)) / h,
        );
      }
      // Кадр на перелёте ровно на 3% крупнее — это и есть весь эффект.
      const rect = must(allZones[0], "первая зона").rect;
      const r = zoneRectFor(rect, view);
      const tl = throughCss({ x: r.x, y: r.y }, rect, view, "peak");
      const br = throughCss({ x: r.x + r.w, y: r.y + r.h }, rect, view, "peak");
      const { scale } = computeZoneCamera(rect, view);
      expect(br.x - tl.x).toBeCloseTo(r.w * scale * 1.03, 6);
      expect(worstInside, `${view}: снос, если перелёт положить внутрь сдвига`).toBeGreaterThan(
        0.02,
      );
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
  // Числа этого блока пересчитаны тикетом 22: масштаб наезда стал формулой, а
  // пустота у краёв всегда была его следствием. Направление — в плюс: узкие
  // зоны приближаются сильнее, кадр под ними крупнее и закрывает больше, так
  // что зон без пустоты стало БОЛЬШЕ (72 → 80 телефон, 55 → 69 десктоп), а
  // худшая пустота сверху упала с 24.9% до 12.1%. Решение ADR-0002 (зажима
  // нет) не пересматривается — пересчитаны только его цифры.

  /**
   * Независимый вывод: пустоты не будет ровно тогда, когда центр зоны лежит не
   * ближе некоторого расстояния к краю кадра. Порог считается из «сдвиг ≤ запас»,
   * а не из той же модели прямоугольников, что в коде, — это перекрёстная сверка.
   * Масштаб теперь у каждой зоны свой, поэтому и полоса у каждой своя.
   */
  function band(view: SceneView, axis: "x" | "y", scale: number) {
    const { w, h } = sceneSize(view);
    const f = frameRect(view);
    const size = axis === "x" ? w : h;
    const a = axis === "x" ? f.x : f.y;
    const len = axis === "x" ? f.w : f.h;
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
        for (const { id, rect } of allZones) {
          const { lo, hi } = band(view, axis, computeZoneCamera(rect, view).scale);
          const r = zoneRectFor(rect, view);
          const centre = axis === "x" ? r.x + r.w / 2 : r.y + r.h / 2;
          const gap = frameGapAfterZoom(rect, view);
          const exposed =
            axis === "x" ? gap.left > 0 || gap.right > 0 : gap.top > 0 || gap.bottom > 0;
          expect(exposed, `${id} ${view} ${axis}`).toBe(
            !(centre >= lo - 1e-6 && centre <= hi + 1e-6),
          );
        }
      }
    }
  });

  it("полоса центрируемости расширяется вместе с масштабом зоны", () => {
    // Числа для дизайн-сессии: только зоны, чей центр внутри полосы, можно
    // довести до середины экрана, ничего не обнажив. Всё остальное — вопрос к
    // партитуре (запас кадра), а не к коду. Одной полосы больше нет: чем уже
    // зона, тем сильнее наезд, тем крупнее кадр — и тем шире полоса. На упоре
    // min формулы полоса уже прежней (масштаб меньше 1.72), на упоре max —
    // заметно шире; это и есть выигрыш от перехода на формулу.
    const pct = (view: SceneView, axis: "x" | "y", scale: number) => {
      const f = frameRect(view);
      const a = axis === "x" ? f.x : f.y;
      const len = axis === "x" ? f.w : f.h;
      const { lo, hi } = band(view, axis, scale);
      return { lo: ((lo - a) / len) * 100, hi: ((hi - a) / len) * 100 };
    };
    const limits = {
      phone: sceneMotion.cameraScaleFormula.phone,
      desktop: sceneMotion.cameraScaleFormula.desktop,
    };
    expect(limits.phone).toEqual({ min: 1.45, max: 2.6, sceneW: 430 });
    expect(limits.desktop).toEqual({ min: 1.3, max: 2.05, sceneW: 430 });

    expect(pct("phone", "x", limits.phone.min).lo).toBeCloseTo(20.8, 1);
    expect(pct("phone", "x", limits.phone.min).hi).toBeCloseTo(82.0, 1);
    expect(pct("phone", "x", limits.phone.max).lo).toBeCloseTo(10.3, 1);
    expect(pct("phone", "x", limits.phone.max).hi).toBeCloseTo(92.4, 1);
    expect(pct("phone", "y", limits.phone.min).lo).toBeCloseTo(30.8, 1);
    expect(pct("phone", "y", limits.phone.min).hi).toBeCloseTo(69.2, 1);
    expect(pct("phone", "y", limits.phone.max).lo).toBeCloseTo(15.5, 1);
    expect(pct("phone", "y", limits.phone.max).hi).toBeCloseTo(84.5, 1);
    expect(pct("desktop", "x", limits.desktop.min).lo).toBeCloseTo(34.7, 1);
    expect(pct("desktop", "x", limits.desktop.min).hi).toBeCloseTo(65.3, 1);
    expect(pct("desktop", "x", limits.desktop.max).lo).toBeCloseTo(20.6, 1);
    expect(pct("desktop", "x", limits.desktop.max).hi).toBeCloseTo(79.4, 1);
    expect(pct("desktop", "y", limits.desktop.max).lo).toBeCloseTo(20.6, 1);
    expect(pct("desktop", "y", limits.desktop.max).hi).toBeCloseTo(79.4, 1);
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
    // Числа пересчитаны тикетом 22 под масштаб-формулу (было при фиксированных
    // 1.72/1.45: чистых 72/55, худшие 23.2/24.9/28.9 и 33.1/28.8/32.2).
    // Переход на формулу пустоту УМЕНЬШИЛ: узкие зоны приближаются сильнее, и
    // кадр под ними закрывает вьюпорт с запасом.
    const phone = worst("phone");
    expect(phone.clean).toBe(80);
    expect(phone.left).toBeCloseTo(19.0, 1);
    expect(phone.top).toBeCloseTo(12.1, 1);
    expect(phone.bottom).toBeCloseTo(27.5, 1);

    const desktop = worst("desktop");
    expect(desktop.clean).toBe(69);
    expect(desktop.left).toBeCloseTo(27.9, 1);
    expect(desktop.top).toBeCloseTo(20.1, 1);
    expect(desktop.bottom).toBeCloseTo(29.7, 1);
  });

  it("зона целиком на экране — кроме высоких шкафов, где формула считает по ширине", () => {
    // После верного наезда зона стоит по центру, поэтому «влезает» = её размер
    // после масштаба не больше вьюпорта.
    //
    // Прежний список был из одной bold/anything (269 px в сцене 430) — теперь
    // она получает нижний упор формулы 1.45 и влезает. Взамен вылезают три
    // ВЫСОКИЕ узкие зоны: формула масштаба смотрит только на ширину зоны
    // (`sceneW / (zone.w · 2.4)`), поэтому гардероб 83×191 получает ×2.16 и не
    // помещается по высоте. Это свойство контракта, а не расчёта: вопрос
    // дизайну — учитывать в формуле высоту (записано в ADR-0003 §2).
    const tooBig: string[] = [];
    for (const view of VIEWS) {
      const { w, h } = sceneSize(view);
      for (const { id, rect } of allZones) {
        const r = zoneRectFor(rect, view);
        const { scale } = computeZoneCamera(rect, view);
        if (r.w * scale > w + 1 || r.h * scale > h + 1) tooBig.push(`${id} ${view}`);
      }
    }
    expect(tooBig).toEqual([
      "cream/fashion phone",
      "emerald/fashion phone",
      "emerald/home phone",
      "cream/fashion desktop",
    ]);
  });
});
