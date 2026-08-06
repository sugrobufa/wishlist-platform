/**
 * Метка зоны — свет вместо рамки (tokens.json → zoneMarker).
 *
 * Тикет 21 разложил в CSS-переменные всё, что не зависит от данных: альфы
 * состояний, размер искры, длительности, кривую. Здесь живёт остальное — то,
 * что собирается из зоны (`bloomAR`, `bloomRot`) и комнаты (акцент,
 * `roomLightness`): шаблоны фигур с плейсхолдерами, рамка фокуса, веса света
 * против тени, правило переворота подписи и правило близости (тикет 50).
 *
 * Значения не копируются в код: шаблоны и формулы читаются из пакета как есть.
 * Если дизайн перепишет контракт, правка либо доедет до экрана сама, либо
 * упадёт громко — молча подставить своё число нельзя (CLAUDE.md).
 *
 * ДВА СОЗНАТЕЛЬНЫХ ОТСТУПЛЕНИЯ ОТ БУКВЫ КОНТРАКТА (тикет 50, приёмка
 * 2026-08-06): фигура виньетки завершается прозрачностью до края слоя (иначе
 * прямоугольник зоны обрезает тень коробкой — прямая жалоба владельца), а в
 * покое свет выключен вовсе — виден только пульс искры, свечение разгорается
 * по приближению указателя. Замысел контракта (свет вместо рамки,
 * lightnessMix) не тронут; подробности — у `vignetteShape` и `PROXIMITY` ниже.
 */
import tokensJson from "@design/tokens.json";
import type { ZoneRect } from "@/config/design";
import { round4 } from "./camera";

type ZoneMarkerContract = {
  lightnessMix: { bloomWeight: string; vignetteWeight: string };
  bloom: { shape: string };
  vignette: { shape: string; shadow: string };
  label: { position: string };
  focus: { outline: string };
};

const zoneMarker = (tokensJson as unknown as { zoneMarker: ZoneMarkerContract }).zoneMarker;

function requireMatch(value: string, re: RegExp, what: string): RegExpMatchArray {
  const match = value.match(re);
  if (!match) throw new Error(`design/tokens.json: не удалось разобрать ${what}: "${value}"`);
  return match;
}

/**
 * Подстановка `{ключ}` в шаблон контракта. Отсутствие плейсхолдера — не мелочь:
 * незамеченный `{accent}` уехал бы в CSS строкой и молча погасил бы весь слой,
 * поэтому падаем громко.
 */
function fill(template: string, key: string, value: string, what: string): string {
  const token = `{${key}}`;
  if (!template.includes(token)) {
    throw new Error(`design/tokens.json: в ${what} нет плейсхолдера ${token}: "${template}"`);
  }
  return template.replaceAll(token, value);
}

export type MarkerWeights = {
  /** Вес тёплого пятна: множитель к альфе состояния bloom. */
  bloom: number;
  /** Вес тени: подставляется в АЛЬФУ цвета виньетки, так написан контракт. */
  vignette: number;
};

// "1 - roomLightness * 0.75" / "0.25 + roomLightness * 0.75"
function weight(formula: string, roomLightness: number, what: string): number {
  const parts = requireMatch(
    formula,
    /^\s*([\d.]+)\s*([+-])\s*roomLightness\s*\*\s*([\d.]+)\s*$/u,
    what,
  );
  const shift = Number(parts[3]) * roomLightness;
  return round4(Number(parts[1]) + (parts[2] === "-" ? -shift : shift));
}

/**
 * ГЛАВНОЕ РЕШЕНИЕ МЕТКИ: вес света против веса тени.
 *
 * Белое свечение пропадает на светлой комнате, поэтому механизма два — тёплое
 * пятно и мягкая тень по краям, — и их вес считает ОДНО число комнаты
 * (tokens.json → lightnessMix). Кремовая (0.82) получает свет 0.385 против
 * тени 0.865 и держится тенью; неоновая «Дерзкая» (0.15) — свет 0.8875 против
 * тени 0.3625 и держится светом. Ветка кода при этом одна: `if` тут нет и
 * быть не должно — меняется только число комнаты.
 *
 * ПОЧЕМУ ЧИСЛОМ, А НЕ CSS-переменной. tokens.css объявляет веса как `calc()`
 * от `--room-lightness` в `:root`. Но var() внутри значения пользовательского
 * свойства подставляется НА ТОМ ЖЕ элементе, где свойство объявлено: потомки
 * наследуют уже посчитанный `calc(1 - 0.5 * 0.75)`, и `--room-lightness`,
 * выставленный ниже по дереву (на сцене), на него уже не влияет — все комнаты
 * получили бы веса нейтральной 0.5. Поэтому вес считается здесь и приезжает
 * на сцену готовым числом; формула при этом всё равно берётся из пакета.
 */
export function markerWeights(roomLightness: number): MarkerWeights {
  const mix = zoneMarker.lightnessMix;
  return {
    bloom: weight(mix.bloomWeight, roomLightness, "zoneMarker.lightnessMix.bloomWeight"),
    vignette: weight(mix.vignetteWeight, roomLightness, "zoneMarker.lightnessMix.vignetteWeight"),
  };
}

/**
 * Тёплое пятно зоны. Центр смещён к верху прямоугольника — свет в комнате
 * падает сверху, пятно обязано совпадать с логикой освещения кадра; края
 * растворяются в прозрачность на 72% радиуса, поэтому границы пятна не видно
 * и оно читается как освещение, а не как фигура.
 *
 * Вытянутость — `bloomAR` зоны: два числа вместо силуэтной маски (вертикальное
 * пятно у шкафа, горизонтальное у полки). Акцент подставляется как
 * `var(--accent)` — цвет комнаты живёт в одной переменной на сцене.
 *
 * `…` в шаблоне — многоточие прозы («края растворяются»), а не стоп градиента.
 */
export function bloomShape(bloomAR: number): string {
  const shape = zoneMarker.bloom.shape.replace(/\s*…/gu, "");
  return fill(
    fill(shape, "ar", String(bloomAR), "zoneMarker.bloom.shape"),
    "accent",
    "var(--accent)",
    "zoneMarker.bloom.shape",
  );
}

/**
 * Насколько слой виньетки БОЛЬШЕ прямоугольника зоны (в процентах его сторон,
 * с каждой стороны — уходит в `inset: -18%` в scene.module.css). Тень ложится
 * кольцом НА границу предмета и растворяется чуть снаружи неё, а не красит
 * прямоугольник изнутри до краёв.
 */
export const VIGNETTE_BLEED_PCT = 18;

/** Пик тени кольца виньетки — доля полуоси слоя. При bleed 18% граница зоны
 * лежит на 73.5% полуоси (0.5 / 0.68), пик 72% встаёт ровно на неё. */
const VIGNETTE_PEAK_PCT = 72;

/** Где кольцо растворяется в ноль — СТРОГО до края слоя (96% < 100%). */
const VIGNETTE_FADE_PCT = 96;

/**
 * Мягкая тень вокруг предмета: центр остаётся освещённым, кадр по кольцу
 * притемняется — на светлой комнате это и есть метка. Вес тени идёт в АЛЬФУ
 * цвета (`rgba(24,14,6,{weight})` — так написан контракт), поэтому слою
 * остаётся его собственная альфа состояния.
 *
 * ОТСТУПЛЕНИЕ ОТ БУКВЫ КОНТРАКТА (тикет 50). Контрактная фигура
 * `ellipse 78% 78%, transparent 38%, {shadow} 100%` доводит тень до конца луча,
 * а весь слой ЗА эллипсом (углы и полосы вдоль всех четырёх сторон — эллипс
 * 78% не достаёт даже до середины краёв) заливает конечным цветом. Прямоугольник
 * зоны обрезает эту заливку по своим сторонам — владелец видит «тёмные коробки»,
 * и это его прямая жалоба двух приёмок подряд. Замысел («предмет остаётся
 * освещённым, вокруг притемняется») сохранён, но тень стала кольцом: прозрачный
 * центр (граница 38% — по-прежнему из контракта), пик у границы зоны и
 * растворение в прозрачность ДО края слоя. Конечный цвет градиента прозрачный,
 * поэтому резать прямоугольнику больше нечего — прямых линий слой породить
 * не может ни при каком размере зоны. Эллипс 50%×50% (а не 78%) — сознательно:
 * только так весь ход градиента гарантированно умещается внутри слоя.
 */
export function vignetteShape(weights: MarkerWeights): string {
  const shadow = fill(
    zoneMarker.vignette.shadow,
    "weight",
    String(weights.vignette),
    "zoneMarker.vignette.shadow",
  );
  // Внутренняя граница прозрачности — из контрактной фигуры: если дизайн
  // подвинет «освещённый центр», правка доедет сама.
  const inner = requireMatch(
    zoneMarker.vignette.shape,
    /transparent\s+([\d.]+)%/u,
    "zoneMarker.vignette.shape (граница освещённого центра)",
  )[1];
  return (
    `radial-gradient(ellipse 50% 50% at 50% 50%, transparent ${inner}%, ` +
    `${shadow} ${VIGNETTE_PEAK_PCT}%, transparent ${VIGNETTE_FADE_PCT}%)`
  );
}

/**
 * Мягкая маска слоя пятна (тикет 50): альфа растворяется до нуля ДО краёв
 * коробки слоя. Контрактная фигура пятна гаснет на 72% СВОЕГО луча, но при
 * `bloomAR` больше ~69 луч эллипса длиннее полуширины коробки — угасание не
 * успевает завершиться, и край зоны обрезает свет прямой кромкой (у «Геймера»
 * таких зон половина, bloomAR 120). Маска повторяет геометрию пятна (центр
 * смещён к верху, 42%) и не трогает его середину — чёрное плато до 55% полуоси,
 * ноль на 96%, до края остаётся запас. Поворот пятна (`bloomRot`) вращает
 * маску вместе со слоем, поэтому и повернутая коробка кромок не оставляет.
 */
export function markerMask(): string {
  return "radial-gradient(ellipse 50% 50% at 50% 42%, #000 55%, transparent 96%)";
}

/**
 * Пунктирная рамка фокуса. Единственное место, где рамка законна: фокус обязан
 * быть геометрически явным, свет для клавиатурного обхода не годится.
 */
export function focusOutline(): string {
  return fill(zoneMarker.focus.outline, "accent", "var(--accent)", "zoneMarker.focus.outline");
}

/**
 * Порог переворота подписи — из прозы контракта: «под нижней границей зоны,
 * слева; если зона ниже 70% высоты сцены — над верхней».
 */
const LABEL_FLIP_PCT = Number(
  requireMatch(zoneMarker.label.position, /(\d+)\s*%/u, "zoneMarker.label.position")[1],
);

/**
 * Подпись переезжает НАД зону, когда её нижняя граница уходит ниже порога —
 * иначе подпись уедет за кадр. Мерим именно нижнюю границу: у высокой зоны
 * (шкаф во всю стену) верх лежит высоко, а подпись всё равно рисуется под
 * низом, и решать обязан тот край, у которого она встанет.
 *
 * Мера — доля КАДРА: слой хотспотов повторяет геометрию кадра, а кадр по
 * вертикали занимает сцену целиком (351 из 352 на телефоне, 624 из 625 на
 * десктопе), поэтому «доля кадра» и «доля высоты сцены» совпадают с точностью
 * 0.3% — одно правило верно на обеих раскладках, без медиазапроса.
 */
export function labelAboveZone(box: { top: number; height: number }): boolean {
  return box.top + box.height > LABEL_FLIP_PCT;
}

// ---------- Правило близости: свет разгорается заранее (тикет 50) -----------

/**
 * РАДИУС ПРИБЛИЖЕНИЯ, в единицах КАДРА 630×351 (та же система, что у
 * прямоугольников зон, ADR-0006). В покое комната чистая — виден только пульс
 * искры; когда указатель подходит к зоне ближе этого радиуса, её свечение
 * разгорается: сила растёт линейно от 0 на радиусе до 1 на границе
 * прямоугольника, внутри — 1 (дальше состоянием владеет `:hover`, значения
 * совпадают — шва нет). Светится только БЛИЖАЙШАЯ зона.
 *
 * 72 единицы — это ~11% ширины кадра: на десктопе (кадр во всё окно)
 * ≈130–220 px хода мыши, на планшете меньше. Достаточно, чтобы разгорание
 * читалось движением, а не выключателем.
 */
export const PROXIMITY_RADIUS = 72;

/**
 * Сила света на устройствах без hover: свечение стоит у зоны, чей прямоугольник
 * ближе всего к центру видимого окна сцены, — приглашение «начни отсюда».
 * Тише полного наведения (1), чтобы постоянный свет не спорил с касанием:
 * касание-удержание отвечает press-состоянием поверх (CSS `:active`).
 */
export const TOUCH_REST_STRENGTH = 0.6;

/** Сила света по расстоянию до зоны: 1 внутри, 0 на радиусе и дальше. */
export function proximityStrength(distance: number): number {
  if (distance <= 0) return 1;
  if (distance >= PROXIMITY_RADIUS) return 0;
  return round4(1 - distance / PROXIMITY_RADIUS);
}

/** Расстояние от точки кадра до прямоугольника зоны (0 — точка внутри). */
export function distanceToZone(point: { x: number; y: number }, rect: ZoneRect): number {
  const dx = Math.max(rect.x - point.x, point.x - (rect.x + rect.w), 0);
  const dy = Math.max(rect.y - point.y, point.y - (rect.y + rect.h), 0);
  return Math.hypot(dx, dy);
}

export type ZoneLight = { key: string; strength: number };

/**
 * Какую зону зажечь для точки кадра: ближайшая по расстоянию до прямоугольника
 * (не до центра — у вытянутого шкафа центр далеко, а бок рядом), с силой по
 * `proximityStrength`. `null` — все зоны дальше радиуса, комната стоит чистой.
 */
export function nearestZoneLight(
  point: { x: number; y: number },
  zones: readonly { key: string; rect: ZoneRect }[],
): ZoneLight | null {
  let bestKey: string | null = null;
  let bestDistance = Infinity;
  for (const zone of zones) {
    const distance = distanceToZone(point, zone.rect);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestKey = zone.key;
    }
  }
  if (bestKey === null) return null;
  const strength = proximityStrength(bestDistance);
  return strength > 0 ? { key: bestKey, strength } : null;
}
