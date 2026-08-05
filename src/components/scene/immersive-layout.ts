// Раскладка «комната во весь экран» (тикет 24) — числа и геометрия.
//
// ЗАЧЕМ ОТДЕЛЬНЫЙ МОДУЛЬ. Раскладку рисует CSS (scene.module.css → .viewport,
// globals.css → полосы), а проверяет тест: все 13 зон каждой из 10 комнат
// обязаны остаться на экране целиком, нажимаемыми и не под интерфейсом.
// Чтобы тест проверял ту же раскладку, что видит человек, формула живёт
// здесь одна: CSS берёт числа из `tokens.css` (те же ключи tokens.json),
// а тест — отсюда. Разъедутся — упадёт `tests/immersive-layout.test.ts`.
//
// РАЗВИЛКА КОНТРАКТА («во весь экран» против пропорции 430:352) разобрана
// в тикете и в его Comments. Короткая версия: карта зон покрывает кадр
// целиком (по горизонтали — ровно от края до края телефонной сцены), поэтому
// любое увеличение кадра сверх ширины экрана выносит зоны за край. Сцена
// держит пропорцию, а «во весь экран» достаётся раскладкой: сцена больше не
// стоит в колонке под шапкой, а лежит фоном всего экрана, интерфейс — двумя
// полосами поверх, по числам `layout.phoneImmersive`/`desktopImmersive`.
import tokensJson from "@design/tokens.json";
import { hitTargetMin, scene, type ZoneRect } from "@/config/design";
import { round4, zoneScenePercent, type SceneView } from "./camera";

type ImmersiveContract = {
  layout: {
    phoneImmersive: {
      topVeil: number;
      bottomVeil: number;
      titleTop: number;
      railBottom: number;
      tabBar: number;
      hitTargetMin: number;
    };
    desktopImmersive: { topVeil: number; bottomVeil: number; sidePad: number };
  };
  spacing: { gutter: number };
};

const tokens = tokensJson as unknown as ImmersiveContract;

export type Box = { left: number; top: number; width: number; height: number };
export type Screen = { w: number; h: number };

/**
 * Полосы интерфейса и зазор до сцены — всё из пакета.
 *
 * `railTop` — высота верхней полосы: в контракте это «вуаль сверху»
 * (190 телефон / 132 десктоп). В нашей раскладке вуаль превратилась в отступ:
 * фон экрана и так цвета вуали (`surface.app.ground` = #0B0806), градиенту
 * поверх пустоты темнеть не по чему — темнеет он на самом кадре (`.scrim`).
 *
 * `railBottom` — 116 из `phoneImmersive.railBottom`, единственное число полосы
 * в пакете; на десктопе в полосе те же кнопки, поэтому число то же.
 * `gap` — `spacing.gutter`: воздух между кадром и полосами, он же запас,
 * который держит зону нижнего края от заезда под нижнюю полосу.
 */
export const immersiveLayout = {
  phone: {
    railTop: tokens.layout.phoneImmersive.topVeil,
    railBottom: tokens.layout.phoneImmersive.railBottom,
    titleTop: tokens.layout.phoneImmersive.titleTop,
    gap: tokens.spacing.gutter,
    /** Пропорция сцены (rooms.json → scene): телефон 430:352. */
    ar: scene.phone.w / scene.phone.h,
  },
  desktop: {
    railTop: tokens.layout.desktopImmersive.topVeil,
    railBottom: tokens.layout.phoneImmersive.railBottom,
    titleTop: tokens.layout.desktopImmersive.sidePad,
    gap: tokens.spacing.gutter,
    /** Десктоп 1120:625 — тот же кадр целиком, без телефонного кропа. */
    ar: scene.desktop.w / scene.desktop.h,
  },
} as const;

/**
 * Где на экране лежит сцена (`.viewport` из scene.module.css).
 *
 * Правило ровно то же, что в CSS:
 *   width  = min(100%, (100dvh − railTop − railBottom − gap) × пропорция)
 *   top    = railTop, по центру по горизонтали.
 *
 * То есть сцена берёт всю ширину экрана, пока её высота помещается между
 * полосами; на низком экране — сжимается по высоте. Верх сцены прижат к
 * нижнему краю верхней полосы: пустоты между заголовком и комнатой нет
 * (пункт 2 приёмки), а весь запас уходит вниз, под нижнюю вуаль.
 */
export function sceneBand(view: SceneView, screen: Screen): Box {
  const l = immersiveLayout[view];
  const free = Math.max(0, screen.h - l.railTop - l.railBottom - l.gap);
  const width = Math.min(screen.w, free * l.ar);
  return {
    left: round4((screen.w - width) / 2),
    top: l.railTop,
    width: round4(width),
    height: round4(width / l.ar),
  };
}

/**
 * Прямоугольник зоны в пикселях экрана. Считается тем же путём, что рисует
 * браузер: доля сцены (`zoneScenePercent`, тикет 22) × коробка сцены. Своей
 * карты координат здесь нет — `rooms.json` остаётся единственной.
 */
export function zoneOnScreen(rect: ZoneRect, view: SceneView, screen: Screen): Box {
  const band = sceneBand(view, screen);
  const p = zoneScenePercent(rect, view);
  return {
    left: round4(band.left + (p.left / 100) * band.width),
    top: round4(band.top + (p.top / 100) * band.height),
    width: round4((p.width / 100) * band.width),
    height: round4((p.height / 100) * band.height),
  };
}

/**
 * Настоящая цель нажатия зоны: прямоугольник добит до `hitTargetMin`
 * (`.hotspot::after`, 44 px реальных пикселей экрана) и обрезан краем сцены —
 * `.viewport` режет всё, что вылезло (`overflow: hidden`), и обрезка эта
 * действует и на попадание пальцем.
 */
export function zoneHitBox(rect: ZoneRect, view: SceneView, screen: Screen): Box {
  const band = sceneBand(view, screen);
  const box = zoneOnScreen(rect, view, screen);
  const growX = Math.max(0, hitTargetMin - box.width) / 2;
  const growY = Math.max(0, hitTargetMin - box.height) / 2;
  const left = Math.max(band.left, box.left - growX);
  const top = Math.max(band.top, box.top - growY);
  const right = Math.min(band.left + band.width, box.left + box.width + growX);
  const bottom = Math.min(band.top + band.height, box.top + box.height + growY);
  return {
    left: round4(left),
    top: round4(top),
    width: round4(Math.max(0, right - left)),
    height: round4(Math.max(0, bottom - top)),
  };
}

/** Полоса экрана, свободная от интерфейса: между верхней и нижней полосами. */
export function clearBand(view: SceneView, screen: Screen): { top: number; bottom: number } {
  const l = immersiveLayout[view];
  return { top: l.railTop, bottom: screen.h - l.railBottom };
}
