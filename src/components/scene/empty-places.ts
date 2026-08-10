/**
 * ТРИ ПУСТЫХ МЕСТА на сцене пустой комнаты (тикет 142, приёмка `places-v3`
 * пакета раунда 37 — тикет 157; доска — турн 45c).
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
 * формулу иначе — упадём громко, а не подставим молча своё число. Раунд 37 это
 * и проверил: `armSmall` переписан формулой, и разбор упал на импорте — ровно
 * так, как задумано.
 *
 * ТАБЛИЦА ПРИЁМКИ ПАКЕТА (`places.json → receipt`) ОЖИДАНИЕМ НЕ СЛУЖИТ — И
 * ПОСЛЕ ТОГО, КАК СОШЛАСЬ. В раунде 34 дизайн прогонял правило по снимку
 * `rooms.json` до переразметок (его `zoneRect` были равны нашему полю
 * `rectOld`), и тройки расходились в четырёх комнатах из десяти. Раунд 37
 * пересчитан по нашему дампу карты, и приёмка теперь воспроизводится вся:
 * 30 прямоугольников из 30, те же тройки и то же дышащее место. Ожиданием она
 * всё равно не становится: 19 из 30 выбранных зон помечены на пересъёмку, и
 * когда карта поедет, тройки обязаны переехать вместе с ней — сторожит их НАШ
 * снимок на сегодняшнем `rooms.json`, чтобы переразметка не переставила места
 * молча.
 */
// `@design/places.json` — ЖИВОЙ контракт мест под стабильным именем; сегодня в
// нём лежит `places-v3` раунда 37 дословно. Присланный пакет целиком (README,
// CHANGES, places-v3.json, zones-130.json) хранится рядом в `handoff/round37/`:
// папка входящих живёт на машине владельца и не переживает следующего пакета —
// на round36 это уже проверено потерей.
import placesJson from "@design/places.json";
import type { ZoneRect } from "@/config/design";
import { round4 } from "./camera";
import { phoneWindowOnFrame } from "./immersive-layout";

type PlacesContract = {
  mapSnapshot: { version: string; date: string; source: string; note: string };
  rule: {
    window: { x0: number; x1: number; why: string; keptBecause: string };
    candidate: string;
    thirds: { bounds: [number, number]; assign: string };
    pick: string;
    primary: string;
    primaryWholeAtRest: string;
    drawIfWhole: string;
  };
  placeGeometry: { w: string; h: string; center: string; hitTarget: string };
  visual: {
    corners: { count: number; armPx: number; armSmall: string; strokePx: number; cap: string };
    color: string;
    fill: string;
    layer: string;
    units: string;
    noLightLine: string;
    noCaption: string;
  };
  states: {
    rest: { othersOpacity: number; primary: string };
    hover: { opacity: number; arm: string; stroke: number; transition: string; note: string };
    press: { opacity: number; arm: string; stroke: number; transition: string; noScale: string };
    focusVisible: { arm: string; stroke: number; glow: string; dashed: string };
  };
  behavior: {
    tap: string;
    onCameraMove: string;
    dismiss: string;
    a11y: {
      role: string;
      name: string;
      order: string;
      group: string;
      breathNotAnnounced: string;
      hidden: string;
    };
  };
  notDashed: string;
  receipt: Record<
    string,
    {
      candidates: number;
      fallbackThirds: string[];
      places: {
        zone: string;
        zoneRect: ZoneRect;
        place: ZoneRect;
        arm: number;
        phoneAtRest: string;
        primary?: boolean;
      }[];
      phoneVisibleCount: number;
      primaryWholeAtRest: boolean;
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

/**
 * ВИДИМАЯ ПОЛОСА КАДРА — не окно правила (105…525), а то, что устройство
 * показывает на самом деле. Их путают охотнее всего, поэтому они и лежат рядом:
 * окно правила выбирает ЗОНЫ (одно на все устройства, карта одна), полоса
 * решает, РИСОВАТЬ ли выбранное место (у каждого устройства своя).
 *
 * Числа не наши и не дизайна: телефонная полоса — это `phoneWindowOnFrame(0)`,
 * то есть 12…442 из ADR-0006, а десктопная — весь кадр (там `cover`, кадр виден
 * целиком, тикет 42). Обе считаются из `scene.phone.image`, второй правды о
 * кадре не заводим.
 */
export const PLACE_BAND_PHONE_REST = phoneWindowOnFrame(0);

/**
 * `drawIfWhole` (`places-v3`, новая строка правила): место рисуется, ТОЛЬКО
 * если целиком лежит в видимой полосе. Обрезанных мест не бывает — прижать
 * уголки к кромке нельзя (они уедут с предмета, и место соврёт), нарисовать «Г»
 * тоже нельзя: две четверти рамки — дословная подпись умершей плитки «хочу».
 *
 * Полоса ЕДЕТ ВМЕСТЕ С ОКНОМ (пан, тикет 55): третье место не потеряно, оно
 * приезжает, когда окно 430 сдвинулось по кадру. Поэтому в разметке эта
 * проверка живёт формулой в CSS (`--place-off`, scene.module.css) и считает
 * текущую полосу; здесь — то же правило числами, для покоя и для тестов.
 */
export function placeWholeInBand(rect: ZoneRect, band: { left: number; right: number }): boolean {
  return rect.x >= band.left && rect.x + rect.w <= band.right;
}

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
 * зоны. Ничья — по порядку зон в `rooms.json` (`places-v3`: «при полном
 * равенстве — порядок зон, та же цепочка, что у выбора зоны»), а не по порядку
 * победителей третей: до раунда 37 ничью решал он, и это было тихое
 * расхождение — площади мест часто равны, их зажимает 34.
 *
 * ДЫШИТ ТОЛЬКО ЦЕЛИКОМ ВИДИМОЕ МЕСТО (`primaryWholeAtRest`, новая строка
 * `places-v3`): если наибольшее по площади в покое телефона обрезано, дышит
 * следующее по площади из целиком видимых. Полоса берётся ТЕЛЕФОННАЯ и на
 * десктопе тоже — дышащее место у комнаты одно на все устройства, как и карта.
 * Сегодня правило не двигает ничего: у всех десяти комнат наибольшее место и
 * так лежит в покое целиком (тест сторожит).
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

  const ranked = winners.map((zone) => {
    const rect = placeRect(zone.rect);
    const place: EmptyPlace = { key: zone.key, rect, zoneRect: zone.rect, primary: false };
    return { place, index: zone.index, area: rect.w * rect.h };
  });

  // Кто дышит: сперва целиком видимые в покое телефона (`primaryWholeAtRest`),
  // и только если таких нет — все три. Внутри — площадь МЕСТА, ничья по порядку
  // зон в rooms.json (`index`).
  const byPlaceArea = (a: (typeof ranked)[number], b: (typeof ranked)[number]) =>
    b.area - a.area || a.index - b.index;
  const wholeAtRest = ranked.filter((r) => placeWholeInBand(r.place.rect, PLACE_BAND_PHONE_REST));
  const primary = (wholeAtRest.length ? wholeAtRest : [...ranked]).sort(byPlaceArea)[0];
  if (primary) primary.place.primary = true;

  return { places: ranked.map((r) => r.place), fallbackThirds };
}

// ---------- Вид места: числа контракта в CSS-переменные ---------------------

const CORNERS = placesContract.visual.corners;

/**
 * Плечо уголка в ЭКРАННЫХ px, формулой контракта:
 * `max(6, min(11, round(0.35 * min(place.w, place.h))))`.
 *
 * ЧТО ИЗМЕНИЛ РАУНД 37. Прежде это была проза («35% меньшей стороны, если она
 * < 32 px»), и плечо выходило дробным: у музыки «Коттеджа» (40×27) — 9.45.
 * Теперь у формулы обычное округление и ПОЛ 6 («короче уголок перестаёт быть
 * уголком»), и то же место даёт ровно 9. Порога «< 32» больше нет вовсе: его
 * роль играет верхний зажим 11 — при стороне 32 и больше `round(0.35 · сторона)`
 * и так не меньше 11.
 *
 * ПОЧЕМУ МЕРИМ СТОРОНУ В КАДР-px, А НЕ В ЭКРАННЫХ. Плечо и толщина заданы в
 * экранных px («с прямоугольником не масштабируются»), а сама сторона места
 * существует только в координатах кадра — на экране она разная у телефона и
 * десктопа, и зажимы стали бы устройство-зависимыми. Контракт этой разницы не
 * разводит; берём сторону в кадр-px — в этих же единицах нарисован образец на
 * доске и посчитана приёмка (`receipt[].arm`: 11 у всех мест, 9 у музыки
 * «Коттеджа»).
 */
const ARM_SMALL = requireMatch(
  CORNERS.armSmall,
  /max\(\s*([\d.]+),\s*min\(\s*([\d.]+),\s*round\(\s*([\d.]+)\s*\*\s*min\(place\.w,\s*place\.h\)\s*\)\s*\)\s*\)/u,
  "visual.corners.armSmall",
);
const ARM_FLOOR = Number(ARM_SMALL[1]);
const ARM_CAP = Number(ARM_SMALL[2]);
const ARM_SHARE = Number(ARM_SMALL[3]);

export function placeArmPx(rect: ZoneRect): number {
  const smallSide = Math.min(rect.w, rect.h);
  return Math.max(ARM_FLOOR, Math.min(ARM_CAP, Math.round(ARM_SHARE * smallSide)));
}

/** Толщина уголка, экранные px. Срез прямой — его даёт сама граница CSS. */
export const PLACE_STROKE_PX = CORNERS.strokePx;

/** Сколько углов у места — четыре; число сторожит тест, разметка его повторяет. */
export const PLACE_CORNER_COUNT = CORNERS.count;

/**
 * АЛЬФЫ ПЕРЕЕХАЛИ ИЗ `visual.opacity` В `states.rest` (раунд 37): у покоя,
 * наведения, нажатия и фокуса теперь общий дом `states`. Число там одно —
 * `othersOpacity`; размах дыхания, партитура и статика reduced-motion лежат
 * ОДНОЙ СТРОКОЙ («дыхание .55 → .85, 3.6s ease-in-out infinite alternate;
 * prefers-reduced-motion: 0.7 без анимации»), и мы разбираем её тем же приёмом,
 * что и формулы геометрии, — переписать четыре числа в код значило бы завести
 * вторую правду о них.
 */
const REST = placesContract.states.rest;
const BREATH = requireMatch(
  REST.primary,
  /дыхание\s+((?:\d*\.)?\d+)\s*→\s*((?:\d*\.)?\d+),\s*([^;]+);\s*prefers-reduced-motion:\s*((?:\d*\.)?\d+)/u,
  "states.rest.primary",
);

/** Альфы: покой обычного места, размах дыхания главного и статика reduced-motion. */
export const PLACE_OPACITY = {
  others: REST.othersOpacity,
  breathFrom: Number(BREATH[1]),
  breathTo: Number(BREATH[2]),
  reduced: Number(BREATH[4]),
} as const;

/**
 * Партитура дыхания строкой контракта — «3.6s ease-in-out infinite alternate».
 * Уезжает в CSS как хвост `animation`, поэтому своих длительностей у сцены не
 * появляется (числа мест не лежат в motion.json — это вид, а не движение
 * камеры).
 */
export const PLACE_BREATH = (BREATH[3] ?? "").trim();

/**
 * МЕСТО ГАСНЕТ НА ВРЕМЯ НАЕЗДА (`behavior.onCameraMove`, новая строка раунда
 * 37): с началом наезда все три уходят за 140 мс и возвращаются при отходе за
 * 200 мс, без сдвига — только прозрачность.
 *
 * Это ответ на наш вопрос о единицах. Плечо и толщина заданы в ЭКРАННЫХ px и с
 * прямоугольником не масштабируются; в наезде масштаб уже не 1, и уголки
 * поехали бы относительно предмета. Дизайн снял вопрос поведением: место
 * рисуется только в покое, где масштаб единица, и обратного масштаба на кадр не
 * нужно ни на телефоне, ни на десктопе.
 *
 * У НАС «НАЕЗД» — ЭТО РОВНО ОТКРЫТАЯ ЗОНА. Других движений с масштабом у слоя
 * мест нет: пан окна (тикет 55) — чистый сдвиг, а дыхание кадра (`drift`) живёт
 * ВНУТРИ стопки камеры, куда слой хотспотов не входит. Поэтому гасит места тот
 * же класс, что прячет хотспоты, — просто теперь двумя длительностями
 * контракта вместо общей `--glow-ms`.
 */
const CAMERA_FADE = requireMatch(
  placesContract.behavior.onCameraMove,
  /гаснут за\s*(\d+)\s*мс[\s\S]*?возвращаются[^\d]*?(\d+)\s*мс/u,
  "behavior.onCameraMove",
);

export const PLACE_CAMERA_FADE = {
  outMs: Number(CAMERA_FADE[1]),
  backMs: Number(CAMERA_FADE[2]),
} as const;

/**
 * ФОКУС МЕСТА — ТЕПЕРЬ ЧИСЛА ДИЗАЙНА (`states.focusVisible`). До раунда 37 их в
 * контракте не было вовсе, и вид фокуса был нашим нейтральным дефолтом (плечо
 * без прибавки, толщина ×2, свечение 6px при 45%). Дизайн принял саму находку —
 * «у места фокус свой, пунктира нет» — и дал ей свои числа: плечо +2, контур 2,
 * свечение `0 0 10px accent при .5`.
 *
 * Находка была вот в чём: единственный законный пунктир у нас — рамка фокуса
 * метки зоны (`1px dashed {accent}`), и на тёмной пустой сцене вокруг акцентных
 * уголков она читается ровно умершей плиткой «хочу» (инвариант №3 отменён
 * целиком, тикет 124). Контракт это записал: «dashed: НЕТ».
 */
const FOCUS = placesContract.states.focusVisible;
const FOCUS_ARM = requireMatch(FOCUS.arm, /\+\s*([\d.]+)/u, "states.focusVisible.arm");
const FOCUS_GLOW = requireMatch(
  FOCUS.glow,
  /^(\d+)\s+(\d+)\s+([\d.]+)px\s+accent\s+при\s+((?:\d*\.)?\d+)$/u,
  "states.focusVisible.glow",
);

export const PLACE_FOCUS = {
  /** Прибавка к плечу в экранных px: «+2 (11 → 13)». */
  armPlusPx: Number(FOCUS_ARM[1]),
  /** Толщина контура в фокусе — ЧИСЛО контракта, а не «толщина покоя ×2». */
  strokePx: FOCUS.stroke,
} as const;

/**
 * Свечение фокуса: `0 0 10px accent при .5` → `drop-shadow`. Цвет словом
 * `accent` подставляем через `color-mix` — тот же приём, что у заливки.
 */
export function placeFocusGlow(): string {
  const alphaPct = round4(Number(FOCUS_GLOW[4]) * 100);
  return (
    `drop-shadow(${FOCUS_GLOW[1]} ${FOCUS_GLOW[2]} ${FOCUS_GLOW[3]}px ` +
    `color-mix(in srgb, var(--place-accent) ${alphaPct}%, transparent))`
  );
}

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
