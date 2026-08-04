// Чистая математика наезда камеры. Координаты приходят ТОЛЬКО из rooms.json
// (через src/config/design), формула — motion.json → openZone[0]. Ничего не
// задаётся руками; десктоп — тот же расчёт через factorFromPhone (1.7778).
import { cameraScale, scene, sceneMotion, toDesktopRect, type ZoneRect } from "@/config/design";

export type SceneView = "phone" | "desktop";

export type CameraTransform = {
  scale: number;
  /** Проценты ДО масштаба — как в формуле: translate стоит внутри scale(). */
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

/**
 * Наезд камеры по формуле motion.json → openZone[0]:
 *   dx = ((sceneW/2 − (x + w/2)) / sceneW) · 100 / scale   (dy аналогично)
 * Масштаб — cameraScale из rooms.json (1.72 телефон / 1.45 десктоп).
 */
export function computeZoneCamera(rect: ZoneRect, view: SceneView): CameraTransform {
  const scale = cameraScale[view];
  const { w, h } = sceneSize(view);
  const r = zoneRectFor(rect, view);
  const dx = (((w / 2 - (r.x + r.w / 2)) / w) * 100) / scale;
  const dy = (((h / 2 - (r.y + r.h / 2)) / h) * 100) / scale;
  return {
    scale,
    dx,
    dy,
    transform: `scale(${scale}) translate(${round4(dx)}%, ${round4(dy)}%)`,
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

/** Прямоугольник → проценты сцены (позиции хотспотов и слоя кадра). */
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

/**
 * Проверка краевых зон: после наезда кадр всё ещё накрывает вьюпорт сцены.
 * Слой дрейфа живёт ПОД камерой и не опускается ниже scale 1.10
 * (motion.json → ambient.drift.amplitude); его худший сдвиг ±1.1% учтён
 * как штраф к запасу. Это гарантия телефонной сцены — на десктопе кадр
 * равен вьюпорту, и края у наезда прячут вуаль и шторки (как в макете 17a).
 */
export function frameCoversViewport(
  rect: ZoneRect,
  view: SceneView,
  ambient: { scaleMin: number; translatePct: number } = {
    scaleMin: sceneMotion.drift.scaleFrom,
    translatePct: sceneMotion.drift.translatePct,
  },
): boolean {
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
  return left + driftX <= 0 && right - driftX >= sw && top + driftY <= 0 && bottom - driftY >= sh;
}
