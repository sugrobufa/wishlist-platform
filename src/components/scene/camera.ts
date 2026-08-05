// Чистая математика наезда камеры. Координаты приходят ТОЛЬКО из rooms.json
// (через src/config/design), партитура — motion.json → openZone: масштаб,
// длительности, кривая. Ничего не задаётся руками; десктоп — тот же
// расчёт через factorFromPhone (1.7778).
// Раунд 2 пакета переписал openZone на «походку» из семи фаз и убрал поле
// origin; здесь пока однослойный наезд с origin «50% 50%» — как было
// (ADR-0003). Разложение на вложенные слои и cameraScale формулой — тикет 22.
// Одно осознанное отступление от буквы контракта — множитель scale в смещении
// камеры: вывод и обоснование в docs/adr/0002-camera-centering.md.
import { cameraScale, scene, sceneMotion, toDesktopRect, type ZoneRect } from "@/config/design";

export type SceneView = "phone" | "desktop";

export type CameraTransform = {
  scale: number;
  /**
   * Значения translate как они уходят в CSS: проценты ШИРИНЫ/ВЫСОТЫ слоя
   * камеры (он равен вьюпорту сцены). Браузер умножит их на scale, потому что
   * scale стоит в списке функций СНАРУЖИ — экранный сдвиг равен dx·scale.
   */
  dx: number;
  dy: number;
  /** Готовая строка `scale(S) translate(dx%, dy%)` для style.transform. */
  transform: string;
};

/** Габариты сцены вида: телефон 430×352, десктоп 1120×625 (rooms.json → scene). */
export function sceneSize(view: SceneView): { w: number; h: number } {
  return view === "phone"
    ? { w: scene.phone.w, h: scene.phone.h }
    : { w: scene.desktop.w, h: scene.desktop.h };
}

/** Прямоугольник зоны в координатах вида: телефонный как есть, десктоп ×1.7778. */
export function zoneRectFor(rect: ZoneRect, view: SceneView): ZoneRect {
  return view === "phone" ? rect : toDesktopRect(rect);
}

/** Округление до 4 знаков — чтобы в CSS не утекали хвосты float. */
export function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

/** Центр вьюпорта сцены в её же px — точка, куда обязан приехать центр зоны. */
export function viewportCenter(view: SceneView): { x: number; y: number } {
  const { w, h } = sceneSize(view);
  return { x: w / 2, y: h / 2 };
}

/** transform-origin камеры (sceneMotion.camera.origin, «50% 50%») в px сцены. */
export function cameraOrigin(view: SceneView): { x: number; y: number } {
  const { w, h } = sceneSize(view);
  const o = sceneMotion.camera.originPct;
  return { x: (o.x / 100) * w, y: (o.y / 100) * h };
}

/**
 * Наезд камеры: центр зоны обязан оказаться в центре вьюпорта.
 *
 * ВЫВОД (почему тут нет деления на scale, которое стоит в motion.json —
 * см. docs/adr/0002-camera-centering.md).
 *
 * Трансформ висит на слое `.camera`: он `inset: 0`, то есть РОВНО вьюпорт
 * сцены (430×352 телефон / 1120×625 десктоп). Проценты внутри translate
 * считаются от размера этого слоя ДО масштабирования, а список функций
 * `scale(S) translate(t)` браузер перемножает слева направо — scale снаружи,
 * значит экранный сдвиг равен S·t, а не t.
 *
 * Точка p слоя уезжает в  p' = o + S·(p − o) + S·t,  где o — transform-origin.
 * Нужно, чтобы центр зоны zc попал в центр вьюпорта c:
 *   c = o + S·(zc − o) + S·t   ⟹   t = (c − o)/S + (o − zc).
 * При контрактном origin «50% 50%» (o = c) это просто t = c − zc, то есть
 * translate в процентах слоя = ((sceneW/2 − (x + w/2)) / sceneW) · 100.
 *
 * Контракт делит это ещё и на scale — сдвиг выходит в S раз короче нужного,
 * и зона застревает на (S−1)·(расстояние от центра). Формулу motion.json не
 * трогаем (она в переработке у дизайна), расхождение зафиксировано в ADR-0002.
 *
 * Масштаб — cameraScale из rooms.json (1.72 телефон / 1.45 десктоп).
 */
export function computeZoneCamera(rect: ZoneRect, view: SceneView): CameraTransform {
  const scale = cameraScale[view];
  const { w, h } = sceneSize(view);
  const r = zoneRectFor(rect, view);
  const o = cameraOrigin(view);
  const c = viewportCenter(view);
  const tx = (c.x - o.x) / scale + (o.x - (r.x + r.w / 2));
  const ty = (c.y - o.y) / scale + (o.y - (r.y + r.h / 2));
  const dx = (tx / w) * 100;
  const dy = (ty / h) * 100;
  return {
    scale,
    dx,
    dy,
    transform: `scale(${scale}) translate(${round4(dx)}%, ${round4(dy)}%)`,
  };
}

/**
 * Где окажется центр зоны после наезда — в px координат сцены. Это модель того,
 * что делает браузер (p' = o + S·(p − o) + S·t), а не пересказ формулы: тест
 * гоняет её по всем 120 зонам обеих раскладок и требует попадания в центр
 * вьюпорта. Дрейф кадра сюда не входит намеренно: слой хотспотов живёт вне
 * камеры и вне дрейфа, поэтому «центр зоны» — это то место, куда человек ткнул.
 */
export function zoneCenterAfterCamera(rect: ZoneRect, view: SceneView): { x: number; y: number } {
  const { w, h } = sceneSize(view);
  const r = zoneRectFor(rect, view);
  const { scale, dx, dy } = computeZoneCamera(rect, view);
  const o = cameraOrigin(view);
  return {
    x: o.x + scale * (r.x + r.w / 2 - o.x) + scale * (dx / 100) * w,
    y: o.y + scale * (r.y + r.h / 2 - o.y) + scale * (dy / 100) * h,
  };
}

/**
 * Положение кадра 630×351 в координатах сцены вида: на телефоне со сдвигом
 * x = −12 (scene.phone.image), на десктопе — от нуля, потому что десктопные
 * координаты считаются от угла изображения ((x − image.x) · f).
 */
export function frameRect(view: SceneView): ZoneRect {
  const img = scene.phone.image;
  if (view === "phone") return { x: img.x, y: img.y, w: img.w, h: img.h };
  const f = scene.desktop.factorFromPhone;
  return { x: 0, y: 0, w: img.w * f, h: img.h * f };
}

/** Прямоугольник → проценты сцены (позиция слоя кадра и слоя хотспотов). */
export function rectToPercent(
  r: ZoneRect,
  view: SceneView,
): { left: number; top: number; width: number; height: number } {
  const { w, h } = sceneSize(view);
  return {
    left: round4((r.x / w) * 100),
    top: round4((r.y / h) * 100),
    width: round4((r.w / w) * 100),
    height: round4((r.h / h) * 100),
  };
}

export type RectPercent = { left: number; top: number; width: number; height: number };

/**
 * Положение зоны В ДОЛЯХ КАДРА (проценты от 630×351) — единственный расчёт
 * позиции хотспота.
 *
 * Карта rooms.json задана в координатах телефонной СЦЕНЫ (430×352), а кадр
 * стоит в ней со сдвигом `image.x = −12`: на телефоне видна только часть кадра
 * (430 из 630), на десктопе — весь кадр (630 · 1.7778 = 1120). Поэтому «доля
 * сцены» у телефона и десктопа разная, а «доля кадра» — одна и та же: зона
 * лежит на одном и том же участке картинки при любой ширине экрана (телефон,
 * планшет, десктоп, 4K и будущая сцена «почти во весь экран»).
 *
 * Слой хотспотов в scene.module.css повторяет геометрию слоя кадра, поэтому
 * эти проценты уходят в CSS как есть — без множителей и медиазапросов.
 */
export function zoneFramePercent(rect: ZoneRect): RectPercent {
  const img = scene.phone.image;
  return {
    left: round4(((rect.x - img.x) / img.w) * 100),
    top: round4(((rect.y - img.y) / img.h) * 100),
    width: round4((rect.w / img.w) * 100),
    height: round4((rect.h / img.h) * 100),
  };
}

/**
 * То же положение, но в процентах СЦЕНЫ вида: «доля кадра × размещение кадра
 * в сцене» — ровно та композиция, которую делает браузер (.hotspots повторяет
 * .frame, хотспот внутри — проценты родителя). Отдельной десктопной карты не
 * появляется: десктоп получается из той же доли кадра.
 */
export function zoneScenePercent(rect: ZoneRect, view: SceneView): RectPercent {
  const frame = rectToPercent(frameRect(view), view);
  const z = zoneFramePercent(rect);
  return {
    left: round4(frame.left + (z.left / 100) * frame.width),
    top: round4(frame.top + (z.top / 100) * frame.height),
    width: round4((z.width / 100) * frame.width),
    height: round4((z.height / 100) * frame.height),
  };
}

export type FrameGap = { left: number; right: number; top: number; bottom: number };

export type AmbientDrift = { scaleMin: number; translatePct: number };

const DEFAULT_DRIFT: AmbientDrift = {
  scaleMin: sceneMotion.drift.scaleFrom,
  translatePct: sceneMotion.drift.translatePct,
};

/**
 * Сколько пустоты открывает кадр по каждой стороне после наезда (px сцены,
 * 0 — сторона закрыта). Дрейф живёт ПОД камерой и не опускается ниже scale
 * 1.10 (motion.json → ambient.drift.amplitude) — это и есть весь запас кадра
 * на панорамирование; его собственный ход ±1.1% учтён как штраф к запасу,
 * поэтому число — худший кадр дыхания, а не средний.
 *
 * Зажима по этим границам НЕТ намеренно: он вернул бы промах центра на
 * 48 из 120 зон телефона и 65 из 120 зон десктопа (до 33% ширины), то есть
 * ровно тот баг, который чинится. Обоснование и цифры — ADR-0002.
 */
export function frameGapAfterZoom(
  rect: ZoneRect,
  view: SceneView,
  ambient: AmbientDrift = DEFAULT_DRIFT,
): FrameGap {
  const { w: sw, h: sh } = sceneSize(view);
  const img = frameRect(view);
  const { scale, dx, dy } = computeZoneCamera(rect, view);
  const cx = sw / 2;
  const cy = sh / 2;
  // Дрейф (scale m вокруг центра) под камерой (scale s вокруг центра + сдвиг):
  // точка p → c + s·m·(p − c) + s·t, где t = translate камеры в px.
  const k = scale * ambient.scaleMin;
  const shiftX = (dx / 100) * sw * scale;
  const shiftY = (dy / 100) * sh * scale;
  // Худший вклад собственного translate дрейфа (±translatePct% сцены).
  const driftX = (ambient.translatePct / 100) * sw * ambient.scaleMin * scale;
  const driftY = (ambient.translatePct / 100) * sh * ambient.scaleMin * scale;
  const left = cx + (img.x - cx) * k + shiftX;
  const right = cx + (img.x + img.w - cx) * k + shiftX;
  const top = cy + (img.y - cy) * k + shiftY;
  const bottom = cy + (img.y + img.h - cy) * k + shiftY;
  return {
    left: Math.max(0, round4(left + driftX)),
    right: Math.max(0, round4(sw - (right - driftX))),
    top: Math.max(0, round4(top + driftY)),
    bottom: Math.max(0, round4(sh - (bottom - driftY))),
  };
}

/** Кадр после наезда накрывает вьюпорт целиком (все зазоры нулевые). */
export function frameCoversViewport(
  rect: ZoneRect,
  view: SceneView,
  ambient: AmbientDrift = DEFAULT_DRIFT,
): boolean {
  const gap = frameGapAfterZoom(rect, view, ambient);
  return gap.left === 0 && gap.right === 0 && gap.top === 0 && gap.bottom === 0;
}
