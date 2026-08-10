/**
 * ТРИ ПУСТЫХ МЕСТА на сцене пустой комнаты (тикет 142, пакет раунда 34,
 * `places.json`, доска — турн 42a).
 *
 * Комната без вещей стоит тёмной (тикет 104) и не говорит, куда класть первую
 * вещь. Места — это подсказка: три открытых уголка на предметах интерьера,
 * «сюда встанет вещь». Тап по месту = наезд на его зону; сцена при этом
 * остаётся картой — зона без места наезжает ровно так же.
 *
 * НИ ОДНОЙ СВОЕЙ КООРДИНАТЫ. Дизайн прислал не список мест, а ПРАВИЛО: какие
 * три зоны и как из прямоугольника зоны считается прямоугольник места. Второй
 * карты координат не появилось (CLAUDE.md: «координаты зон — только из
 * rooms.json»), и появиться не может: всё, что здесь есть, выводится из
 * `rooms.json` формулами `places.json`.
 *
 * ЧИСЛА ЧИТАЮТСЯ ИЗ КОНТРАКТА, А НЕ ПЕРЕПИСЫВАЮТСЯ. Геометрия приходит строкой
 * формулы («min(max(round(0.62 * zone.w), 34), 120, zone.w)»), и мы разбираем
 * её регуляркой — как `zone-marker.ts` разбирает фигуры меток и `design.ts`
 * партитуру. Дизайн подвинет коэффициент — правка доедет сама; перепишет
 * формулу иначе — упадём громко, а не подставим молча своё число.
 *
 * ТАБЛИЦА ПРИЁМКИ ПАКЕТА (`places.json → receipt`) ОЖИДАНИЕМ НЕ СЛУЖИТ.
 * Дизайн прогнал правило по снимку `rooms.json` ДО переразметок раундов 8 и
 * старше: его `zoneRect` для `cream/beauty`, `lux/travel` и `cottage/music`
 * посимвольно равны нашему полю `rectOld`. На нынешних координатах правило
 * даёт другие тройки в четырёх комнатах из десяти (`cream`, `lux`, `cottage`,
 * `study`) — и это не наш баг: правило у нас и у дизайна ОДНО, разошёлся вход.
 * Считаем по нынешнему `rooms.json` (CLAUDE.md), расхождение выписано дизайну
 * письмом, а тест сторожит НАШ снимок результата — чтобы будущая переразметка
 * зоны не переставила места молча.
 */
import placesJson from "@design/places.json";
import type { ZoneRect } from "@/config/design";
import { round4 } from "./camera";

type PlacesContract = {
  frame: { w: number; h: number };
  rule: {
    window: { x0: number; x1: number; why: string };
    candidate: string;
    thirds: { bounds: [number, number]; assign: string };
    pick: string;
    primary: string;
  };
  placeGeometry: { w: string; h: string; center: string; hitTarget: string };
  visual: {
    corners: { count: number; armPx: number; armSmall: string; strokePx: number; cap: string };
    color: string;
    opacity: {
      primary: { breath: [number, number]; period: string; reducedMotion: number };
      others: number;
    };
    fill: string;
    units: string;
    noLightLine: string;
    noCaption: string;
  };
  behavior: { tap: string; dismiss: string };
  notDashed: string;
  receipt: Record<
    string,
    {
      places: { zone: string; label: string; zoneRect: ZoneRect; place: ZoneRect; primary?: boolean }[];
      fallbackThirds: string[];
    }
  >;
};

export const placesContract = placesJson as unknown as PlacesContract;

function requireMatch(value: string, re: RegExp, what: string): RegExpMatchArray {
  const match = value.match(re);
  if (!match) throw new Error(`design/places.json: не удалось разобрать ${what}: "${value}"`);
  return match;
}

/**
 * Формула стороны места словами контракта:
 * `min(max(round(0.62 * zone.w), 34), 120, zone.w)` — доля стороны зоны,
 * зажатая снизу и сверху и в любом случае не больше самой зоны.
 *
 * Верхний зажим у ширины и высоты РАЗНЫЙ (120 против 110), нижний общий (34) —
 * поэтому разбираем обе строки, а не одну «на всякий случай».
 */
type SideFormula = { factor: number; min: number; max: number };

function sideFormula(source: string, what: string): SideFormula {
  const m = requireMatch(
    source,
    /min\(max\(round\(([\d.]+)\s*\*\s*zone\.[wh]\),\s*([\d.]+)\),\s*([\d.]+),\s*zone\.[wh]\)/u,
    what,
  );
  return { factor: Number(m[1]), min: Number(m[2]), max: Number(m[3]) };
}

const SIDE_W = sideFormula(placesContract.placeGeometry.w, "placeGeometry.w");
const SIDE_H = sideFormula(placesContract.placeGeometry.h, "placeGeometry.h");

/** Окно правила: центральные 420 кадр-px (105…525). Экранная ширина в нём не участвует. */
export const PLACE_WINDOW = placesContract.rule.window;

/** Границы третей по горизонтали (245 и 385): треть решает ЦЕНТР прямоугольника зоны. */
export const THIRD_BOUNDS = placesContract.rule.thirds.bounds;

/** Римские имена третей — ими контракт называет пустые трети в receipt. */
export const THIRD_NAMES = ["I", "II", "III"] as const;

function side(zoneSide: number, f: SideFormula): number {
  return Math.min(Math.max(Math.round(f.factor * zoneSide), f.min), f.max, zoneSide);
}

/**
 * Прямоугольник МЕСТА из прямоугольника зоны — в тех же координатах кадра
 * 630×351 (ADR-0006). Центр общий с зоной, поэтому место всегда лежит ВНУТРИ
 * своей зоны: `w ≤ zone.w` и `h ≤ zone.h` держит третий аргумент `min`.
 *
 * Из этого свойства следует и всё поведение: своей кнопки месту не нужно —
 * под ним лежит кнопка зоны того же центра, и её хит-цель (`hitTargetMin`,
 * 44 px от центра) накрывает место целиком.
 */
export function placeRect(zone: ZoneRect): ZoneRect {
  const w = side(zone.w, SIDE_W);
  const h = side(zone.h, SIDE_H);
  return {
    x: Math.round(zone.x + (zone.w - w) / 2),
    y: Math.round(zone.y + (zone.h - h) / 2),
    w,
    h,
  };
}

/** Кандидат: прямоугольник зоны ЦЕЛИКОМ в окне правила. */
export function isPlaceCandidate(zone: ZoneRect): boolean {
  return zone.x >= PLACE_WINDOW.x0 && zone.x + zone.w <= PLACE_WINDOW.x1;
}

/** Треть по центру прямоугольника: 0 — I (105…245), 1 — II, 2 — III (385…525). */
export function placeThird(zone: ZoneRect): 0 | 1 | 2 {
  const center = zone.x + zone.w / 2;
  if (center < THIRD_BOUNDS[0]) return 0;
  if (center < THIRD_BOUNDS[1]) return 1;
  return 2;
}

export type EmptyPlace = {
  /** Ключ зоны, на которой стоит место, — тап ведёт в неё. */
  key: string;
  /** Прямоугольник МЕСТА в координатах кадра 630×351. */
  rect: ZoneRect;
  /** Прямоугольник ЗОНЫ, из которого место посчитано (нужен тестам и сверке). */
  zoneRect: ZoneRect;
  /** Главное место — наибольшая площадь МЕСТА из трёх; оно одно дышит. */
  primary: boolean;
};

export type PlacesRun = {
  places: EmptyPlace[];
  /** Трети, в которых кандидатов не нашлось, — их закрыл добор по площади. */
  fallbackThirds: string[];
};

/**
 * ПРАВИЛО ЦЕЛИКОМ: какие три зоны получают места.
 *
 * В каждой трети побеждает кандидат наибольшей ПЛОЩАДИ ПРЯМОУГОЛЬНИКА ЗОНЫ
 * (а не места: у зажатого места площадь перестаёт различать зоны — три полки
 * подряд дали бы одинаковые 34×34). Пустая треть закрывается добором
 * оставшихся кандидатов по той же площади, поэтому мест всегда три — пока
 * кандидатов хотя бы трое. Ничья — порядок зон в rooms.json, отсюда `index`
 * во втором ключе сортировки.
 *
 * ПОРЯДОК РЕЗУЛЬТАТА — победители третей слева направо, потом добор: ровно
 * так перечисляет места receipt пакета, и тест сверяет список целиком.
 *
 * ГЛАВНОЕ МЕСТО считается ПОСЛЕ выбора и по площади МЕСТА, а не зоны: так
 * написано в контракте («наибольшая площадь МЕСТА из трёх»). Разница не
 * теоретическая — зажимы 120/110 могут перевернуть порядок у очень вытянутой
 * зоны.
 *
 * КОМНАТА С МЕНЬШИМ ЧИСЛОМ КАНДИДАТОВ. Контракт говорит «мест всегда три» и
 * молчит о том, что делать, если кандидатов меньше (у нас так бывает: зона
 * может быть скрыта продуктом или выключена хозяйкой). Нейтральный дефолт —
 * отдать столько мест, сколько нашлось: выдумывать зону под место нечем, а
 * пустая сцена и так честна. На нынешней разметке минимум — четыре кандидата
 * (`sport`, `study`), так что до этой ветки дело не доходит.
 *
 * ОТСТУПЛЕНИЕ ОТ БУКВЫ КОНТРАКТА: ЗОНЫ БЕЗ ПРЕДМЕТА В КАНДИДАТЫ НЕ ИДУТ.
 * `places.json` пишет «выключенные зоны в rooms.json отсутствуют, исключать
 * нечего» — про наш файл это неверно: восемь зон стоят в нём с пометкой
 * `objectAbsent` (предмета нет в интерьере этой комнаты), и продукт их не
 * показывает (CLAUDE.md, инвариант №9: 122 зоны из 130). Место на такой зоне
 * встало бы уголками на пустую стену и повело бы камеру в никуда. Сам дизайн,
 * впрочем, считал так же: тройка «Спорта» в его receipt воспроизводится
 * ТОЛЬКО с выброшенными `watches` и `gaming` — то есть неверна фраза, а не
 * прогон. Фильтр стоит здесь, а не только у вызова: правило обязано быть
 * верным само по себе, кто бы его ни позвал.
 */
export function emptyPlaces(
  zones: readonly { key: string; rect: ZoneRect; objectAbsent?: boolean }[],
): PlacesRun {
  const candidates = zones
    .filter((zone) => !zone.objectAbsent)
    .map((zone, index) => ({
      key: zone.key,
      rect: zone.rect,
      index,
      area: zone.rect.w * zone.rect.h,
      third: placeThird(zone.rect),
    }))
    .filter((zone) => isPlaceCandidate(zone.rect));

  const byArea = (a: (typeof candidates)[number], b: (typeof candidates)[number]) =>
    b.area - a.area || a.index - b.index;

  const winners: typeof candidates = [];
  const fallbackThirds: string[] = [];
  for (const third of [0, 1, 2] as const) {
    const best = candidates.filter((zone) => zone.third === third).sort(byArea)[0];
    if (best) winners.push(best);
    else fallbackThirds.push(THIRD_NAMES[third]);
  }
  for (const zone of candidates.filter((zone) => !winners.includes(zone)).sort(byArea)) {
    if (winners.length >= 3) break;
    winners.push(zone);
  }

  const places: EmptyPlace[] = winners.map((zone) => ({
    key: zone.key,
    rect: placeRect(zone.rect),
    zoneRect: zone.rect,
    primary: false,
  }));
  let primary: EmptyPlace | null = null;
  for (const place of places) {
    const area = place.rect.w * place.rect.h;
    if (!primary || area > primary.rect.w * primary.rect.h) primary = place;
  }
  if (primary) primary.primary = true;

  return { places, fallbackThirds };
}

// ---------- Вид места: числа контракта в CSS-переменные ---------------------

const CORNERS = placesContract.visual.corners;

/**
 * Плечо уголка в ЭКРАННЫХ px: 11, а у мелкого места — 35% его меньшей стороны.
 * Порог и доля читаются из прозы контракта («35% меньшей стороны, если меньшая
 * сторона места < 32 px»), а не переписываются числами.
 *
 * ПОЧЕМУ МЕРИМ СТОРОНУ В КАДР-px, А НЕ В ЭКРАННЫХ. Плечо и толщина заданы в
 * экранных px («с прямоугольником не масштабируются»), а сама сторона места
 * существует только в координатах кадра — на экране она разная у телефона и
 * десктопа, и порог «< 32» стал бы устройство-зависимым. Контракт этой разницы
 * не разводит; берём сторону в кадр-px — в этих же единицах нарисован образец
 * на доске 42a, где место 38×32 держит полное плечо 11, а место 42×27
 * («Коттедж», музыка) — укороченное.
 */
const ARM_SMALL = requireMatch(
  CORNERS.armSmall,
  /([\d.]+)\s*%[^<]*<\s*([\d.]+)\s*px/u,
  "visual.corners.armSmall",
);
const ARM_SMALL_SHARE = Number(ARM_SMALL[1]) / 100;
const ARM_SMALL_BELOW = Number(ARM_SMALL[2]);

export function placeArmPx(rect: ZoneRect): number {
  const smallSide = Math.min(rect.w, rect.h);
  if (smallSide >= ARM_SMALL_BELOW) return CORNERS.armPx;
  return Math.round(smallSide * ARM_SMALL_SHARE * 100) / 100;
}

/** Толщина уголка, экранные px. Срез прямой — его даёт сама граница CSS. */
export const PLACE_STROKE_PX = CORNERS.strokePx;

/** Сколько углов у места — четыре; число сторожит тест, разметка его повторяет. */
export const PLACE_CORNER_COUNT = CORNERS.count;

const OPACITY = placesContract.visual.opacity;

/** Альфы: покой обычного места, размах дыхания главного и статика reduced-motion. */
export const PLACE_OPACITY = {
  others: OPACITY.others,
  breathFrom: OPACITY.primary.breath[0],
  breathTo: OPACITY.primary.breath[1],
  reduced: OPACITY.primary.reducedMotion,
} as const;

/**
 * Партитура дыхания строкой контракта — «3.6s ease-in-out infinite alternate».
 * Уезжает в CSS как хвост `animation`, поэтому своих длительностей у сцены не
 * появляется (числа мест не лежат в motion.json — это вид, а не движение
 * камеры).
 */
export const PLACE_BREATH = placesContract.visual.opacity.primary.period;

/**
 * Заливка места — «linear-gradient(180deg, accent .08, transparent 75%)».
 * Контракт пишет `accent` словом; подставляем цвет комнаты через `color-mix`
 * (тот же приём, что у кромок сцены), альфу берём из строки.
 */
const FILL = requireMatch(
  placesContract.visual.fill,
  /linear-gradient\((\d+)deg,\s*accent\s*\.?([\d.]+),\s*transparent\s*([\d.]+)%\)/u,
  "visual.fill",
);

export function placeFill(): string {
  const angle = FILL[1];
  // `.08` → 8%. Умножение на 100 округляем: 0.08 * 100 в двоичной плавающей
  // даёт 8.000000000000002, и это число уехало бы в CSS как есть.
  const alphaPct = round4(Number(`0.${FILL[2]}`) * 100);
  return (
    `linear-gradient(${angle}deg, ` +
    `color-mix(in srgb, var(--place-accent) ${alphaPct}%, transparent), ` +
    `transparent ${FILL[3]}%)`
  );
}
