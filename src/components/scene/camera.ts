// Чистая математика наезда камеры. Координаты приходят ТОЛЬКО из rooms.json
// (через src/config/design), партитура — motion.json → openZone: масштаб,
// длительности, кривые. Ничего не задаётся руками; десктоп — тот же
// расчёт через factorFromPhone (1.7778).
//
// СИСТЕМА КООРДИНАТ (раунд 4 пакета, тикет 40). Прямоугольники зон заданы в
// координатах КАДРА 630×351. Сцена — это окно, в котором кадр стоит: на
// телефоне 430×352 со сдвигом −12 (видно кадр с 12 по 442, окно ездит по
// кадру), на десктопе 1120×625 — кадр целиком от нуля. Весь перевод собран в
// `zoneRectFor`; прежняя система жила в координатах окна и требовала `+12` на
// десктопе. Разбор — ADR-0006.
//
// Тикет 22 («походка»): наезд разложен на вложенные слои — у масштаба и сдвига
// разные длительности, в один transform это не собирается. Порядок слоёв и
// вытекающий из него множитель scale в смещении — в `computeZoneCamera` ниже;
// масштаб считается формулой motion.json (`zoneCameraScale`), числа
// `rooms.json → cameraScale` в сцене больше не участвуют (ADR-0002, ADR-0003).
import { scene, sceneMotion, toDesktopRect, zoneCameraScale, type ZoneRect } from "@/config/design";

export type SceneView = "phone" | "desktop";

export type CameraTransform = {
  /** Масштаб наезда этой зоны — формула motion.json, а не число rooms.json. */
  scale: number;
  /**
   * Значения translate как они уходят в CSS: проценты ШИРИНЫ/ВЫСОТЫ слоя
   * сдвига (он равен вьюпорту сцены). Слой сдвига лежит СНАРУЖИ слоя масштаба,
   * поэтому браузер их ни на что не домножает — множитель scale уже внутри
   * (см. вывод в `computeZoneCamera`).
   */
  dx: number;
  dy: number;
  /** transform слоя `.pan` — «Шаг: сдвиг к зоне». */
  pan: string;
  /** transform слоя `.zoom` — «Шаг: масштаб» (цель без перелёта). */
  zoom: string;
};

/** Габариты сцены вида: телефон 430×352, десктоп 1120×625 (rooms.json → scene). */
export function sceneSize(view: SceneView): { w: number; h: number } {
  return view === "phone"
    ? { w: scene.phone.w, h: scene.phone.h }
    : { w: scene.desktop.w, h: scene.desktop.h };
}

/**
 * Прямоугольник зоны из координат КАДРА (630×351, `rooms.json`) в координаты
 * СЦЕНЫ вида — единственное место, где эти два пространства встречаются.
 *
 *   телефон  сцена 430×352, кадр стоит в ней со сдвигом `image.x = −12`
 *            ⟹ x_сцены = x_кадра − 12  (окно показывает кадр с 12 по 442
 *              и ЕЗДИТ по нему; всё, что правее 442, пальцем в покое не
 *              достать — туда ведёт указатель зон, тикет 34);
 *   десктоп  кадр показывается целиком, 630 · 1.7778 = 1120 = ширина сцены
 *            ⟹ x_сцены = x_кадра · 1.7778, без слагаемого (`toDesktopRect`).
 *
 * ЗНАК. До раунда 4 разметка жила в координатах ОКНА, и перевод шёл в другую
 * сторону: телефон брал прямоугольник как есть, а десктоп прибавлял `+12`.
 * Перепутать знак здесь стоит 24 px кадра, и тесты центровки этого НЕ поймают:
 * они требуют, чтобы зона приехала в середину экрана, а не чтобы она стояла на
 * предмете — приедет ровно так же, только не туда. Проверка одна: смотреть на
 * кадр. Разбор и замеры — ADR-0006.
 */
export function zoneRectFor(rect: ZoneRect, view: SceneView): ZoneRect {
  if (view !== "phone") return toDesktopRect(rect);
  const img = scene.phone.image;
  return { x: rect.x + img.x, y: rect.y + img.y, w: rect.w, h: rect.h };
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
 * ПОРЯДОК СЛОЁВ (тикет 22). Масштаб и сдвиг едут с разными длительностями
 * (620/720 телефон, 700/810 десктоп) — у одного свойства одна длительность на
 * всё, поэтому они разнесены по вложенным слоям, как требует контракт
 * (motion.json → todoForProduction): СНАРУЖИ сдвиг `.pan`, ВНУТРИ масштаб
 * `.zoom`. Ещё дальше наружу — три слоя «жеста» (вес, перелёт, оседание),
 * см. `walkScore`.
 *
 * ВЫВОД. Слои `inset: 0`, то есть РОВНО вьюпорт сцены (430×352 телефон /
 * 1120×625 десктоп); проценты translate считаются от размера слоя. Внешний
 * слой применяется последним, поэтому точка p уезжает в
 *   p' = T + o + S·(p − o),   T — сдвиг внешнего слоя в px, o — origin.
 * Экранный сдвиг равен T, браузер его масштабом уже НЕ домножает (раньше, в
 * однослойном `scale(S) translate(t)`, домножал). Центровка:
 *   c = T + o + S·(zc − o)   ⟹   T = (c − o) − S·(zc − o)
 *   при контрактном origin «50% 50%» (o = c)  ⟹  T = S·(c − zc).
 * То есть множитель S, который в однослойной записи давал браузер, теперь
 * стоит в расчёте руками. Прежний вывод ADR-0002 при этом не меняется: и там,
 * и тут экранный сдвиг равен S·(c − zc), а деления на scale из формулы
 * контракта нет — оно и было тем недоездом, который чинил тикет 20.
 *
 * ПОЧЕМУ ЦЕНТРОВКА ДЕРЖИТСЯ ПРИ ПЕРЕМЕННОМ ВО ВРЕМЕНИ МАСШТАБЕ. В T входит
 * ФИНАЛЬНЫЙ масштаб зоны. Перелёт (+3%) и оседание живут на слоях СНАРУЖИ
 * `.pan`: множитель k такого слоя даёт p' = o + k·(T + S·(p − o)), и в условии
 * центровки k сокращается целиком — зона на перелёте становится крупнее, но
 * с середины экрана не съезжает. Если бы перелёт стоял внутри сдвига, зону
 * уводило бы на (k−1)·S·|zc − c| — до 4.4% ширины на телефоне, вдвое больше
 * допуска приёмки в 2%.
 *
 * МАСШТАБ — формула motion.json (`zoneCameraScale`): clamp(sceneW/(w·2.4)).
 * Ширина зоны берётся в координатах ТЕЛЕФОННОЙ сцены на обоих видах — так
 * написано в контракте (`sceneW: 430` и у десктопа).
 */
export function computeZoneCamera(rect: ZoneRect, view: SceneView): CameraTransform {
  const scale = zoneCameraScale(rect, view);
  const { w, h } = sceneSize(view);
  const r = zoneRectFor(rect, view);
  const o = cameraOrigin(view);
  const c = viewportCenter(view);
  const tx = c.x - o.x - scale * (r.x + r.w / 2 - o.x);
  const ty = c.y - o.y - scale * (r.y + r.h / 2 - o.y);
  const dx = (tx / w) * 100;
  const dy = (ty / h) * 100;
  return {
    scale,
    dx,
    dy,
    pan: `translate(${round4(dx)}%, ${round4(dy)}%)`,
    zoom: `scale(${round4(scale)})`,
  };
}

/**
 * Где окажется центр зоны после наезда — в px координат сцены. Это модель того,
 * что делает браузер (p' = T + o + S·(p − o) при внешнем слое сдвига), а не
 * пересказ формулы: тест гоняет её по всем 120 зонам обеих раскладок и требует
 * попадания в центр вьюпорта. Слои «жеста» сюда не входят: их произведение к
 * концу походки равно единице (см. `walkScore`), а по дороге они сокращаются в
 * условии центровки. Дрейф кадра не входит намеренно: слой хотспотов живёт вне
 * камеры и вне дрейфа, поэтому «центр зоны» — это то место, куда человек ткнул.
 */
export function zoneCenterAfterCamera(rect: ZoneRect, view: SceneView): { x: number; y: number } {
  const { w, h } = sceneSize(view);
  const r = zoneRectFor(rect, view);
  const { scale, dx, dy } = computeZoneCamera(rect, view);
  const o = cameraOrigin(view);
  return {
    x: (dx / 100) * w + o.x + scale * (r.x + r.w / 2 - o.x),
    y: (dy / 100) * h + o.y + scale * (r.y + r.h / 2 - o.y),
  };
}

// ---------- Партитура «походки»: какой слой когда едет ----------------------

/** Кривая по имени из партитуры: «out» / «walk» / «settle» (motion.json → easing). */
const CURVES: Record<string, string> = {
  out: sceneMotion.easingOut,
  walk: sceneMotion.easingWalk,
  settle: sceneMotion.easingSettle,
};

function curve(name: string): string {
  const found = CURVES[name];
  if (!found) throw new Error(`motion.json: у фазы неизвестная кривая «${name}»`);
  return found;
}

/**
 * Число из строки вида «scale(1.008)». Партитура задаёт фазы веса абсолютными
 * значениями трансформа, а слои перемножаются — чтобы собрать множители, нужно
 * само число. Контракт при этом не парсится заново: строка приходит из уже
 * распакованного `sceneMotion.walk.lead` (тикет 21).
 */
function scaleValue(transform: string, what: string): number {
  const match = transform.match(/scale\(\s*([\d.]+)\s*\)/u);
  if (!match) throw new Error(`motion.json: не удалось прочитать масштаб ${what}: "${transform}"`);
  return Number(match[1]);
}

const LEAD_TO = scaleValue(sceneMotion.walk.lead.to, "фазы «Вес переносится назад»");
const OVERSHOOT = sceneMotion.walk.scale.overshoot;

export type WalkLayerTiming = {
  /** Задержка от нажатия (`at` фазы), мс. */
  atMs: number;
  durationMs: number;
  /** Готовая cubic-bezier. */
  easing: string;
};

export type WalkScore = {
  /** «Вес переносится назад» — слой `.camera`, абсолютные значения контракта. */
  lead: WalkLayerTiming & { rest: string; on: string };
  /** Перелёт +3% — слой `.over`, множитель поверх веса. */
  over: WalkLayerTiming & { on: string };
  /** «Оседание» — слой `.settle`, возврат перелёта. */
  settle: WalkLayerTiming & { on: string };
  /** «Шаг: сдвиг к зоне» — слой `.pan`, значение даёт computeZoneCamera. */
  pan: WalkLayerTiming;
  /** «Шаг: масштаб» — слой `.zoom`, значение даёт computeZoneCamera. */
  zoom: WalkLayerTiming;
  /** Вся походка от нажатия до конца оседания, мс. */
  totalMs: number;
};

/**
 * Партитура наезда, разложенная по слоям (тикет 22).
 *
 * Снаружи внутрь: `.camera` (вес) → `.over` (перелёт) → `.settle` (оседание)
 * → `.pan` (сдвиг) → `.zoom` (масштаб) → `.drift` (дыхание) → `.frame`.
 * У каждого слоя ОДНА смена значения, поэтому каждому хватает обычного
 * transition с задержкой — ни ключевых кадров, ни таймеров в JS, и прерванный
 * на полпути наезд разворачивается сам, откуда его застали.
 *
 * ТРИ СЛОЯ ЖЕСТА ВМЕСТО ОДНОГО. Контракт задаёт масштаб камеры абсолютными
 * значениями подряд: 1.02 (покой) → 1.008 (вес назад) → target·1.03 (перелёт)
 * → target (оседание). Это четыре значения одного свойства, а у свойства одна
 * длительность и одна кривая на переход. Разложение в произведение:
 *
 *   вес     1.02 → 1.008                (150 мс, out)
 *   перелёт 1    → 1.03/1.008           (620/700 мс, walk, с 150 мс)
 *   оседание 1   → 1/1.03               (420 мс, settle, с 770/850 мс)
 *   масштаб 1    → target               (620/700 мс, walk, с 150 мс)
 *
 * даёт ровно контрактные значения во всех четырёх узловых точках (проверено
 * тестом), а произведение трёх слоёв жеста к концу равно 1 — итоговый масштаб
 * камеры равен target, как и написано в «Оседании».
 *
 * ВСЕ ТРИ ЖЕСТА ЛЕЖАТ СНАРУЖИ СДВИГА — тогда они сокращаются в условии
 * центровки и перелёт не уводит зону с середины экрана (вывод —
 * в `computeZoneCamera`).
 */
export function walkScore(view: SceneView): WalkScore {
  const { lead, scale, translate, settle } = sceneMotion.walk;
  return {
    lead: {
      // Первая фаза партитуры, `at: 0` — задержки нет.
      atMs: 0,
      durationMs: lead.durationMs,
      easing: curve(lead.easing),
      rest: lead.from,
      on: lead.to,
    },
    // Множители перелёта и оседания НЕ округляются: их произведение с весом
    // обязано быть ровно единицей, иначе итоговый масштаб камеры разойдётся
    // с `target` из «Оседания» и центровка поедет на эту же долю.
    over: {
      atMs: scale.atMs,
      durationMs: scale.durationMs[view],
      easing: curve(scale.easing),
      on: `scale(${OVERSHOOT / LEAD_TO})`,
    },
    settle: {
      atMs: settle.atMs[view],
      durationMs: settle.durationMs,
      easing: curve(settle.easing),
      on: `scale(${1 / OVERSHOOT})`,
    },
    pan: {
      atMs: translate.atMs,
      durationMs: translate.durationMs[view],
      easing: curve(translate.easing),
    },
    zoom: {
      atMs: scale.atMs,
      durationMs: scale.durationMs[view],
      easing: curve(scale.easing),
    },
    totalMs: settle.atMs[view] + settle.durationMs,
  };
}

/**
 * Абсолютный масштаб камеры (произведение ВСЕХ слоёв) в узловой точке
 * партитуры — то, что контракт пишет одним числом. Нужен тестам: они сверяют
 * разложение по слоям с буквой `openZone`.
 */
export function walkScaleAt(
  scale: number,
  at: "rest" | "lead" | "peak" | "settled",
  view: SceneView = "phone",
): number {
  const score = walkScore(view);
  const lead = scaleValue(score.lead.rest, "покоя");
  const on = scaleValue(score.lead.on, "фазы веса");
  const over = scaleValue(score.over.on, "перелёта");
  const back = scaleValue(score.settle.on, "оседания");
  if (at === "rest") return lead;
  if (at === "lead") return on;
  if (at === "peak") return on * over * scale;
  return on * over * back * scale;
}

/**
 * Положение кадра 630×351 в координатах сцены вида: на телефоне со сдвигом
 * x = −12 (scene.phone.image), на десктопе — от нуля и во всю ширину сцены
 * (630 · 1.7778 = 1120). Ровно эти два числа и превращает `zoneRectFor`
 * координаты кадра в координаты сцены.
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
 * После раунда 4 это просто деление: карта `rooms.json` УЖЕ задана в
 * координатах кадра, переводить нечего. Прежде она жила в координатах окна, и
 * здесь стояло `(rect.x − img.x)` — то самое `+12`, что переводило окно в кадр
 * (ADR-0006).
 *
 * «Доля кадра» — единственная величина, одинаковая на всех ширинах экрана:
 * зона лежит на одном и том же участке картинки и на телефоне, и на десктопе,
 * и на 4K. Слой хотспотов в scene.module.css повторяет геометрию слоя кадра,
 * поэтому эти проценты уходят в CSS как есть — без множителей и медиазапросов.
 */
export function zoneFramePercent(rect: ZoneRect): RectPercent {
  const img = scene.phone.image;
  return {
    left: round4((rect.x / img.w) * 100),
    top: round4((rect.y / img.h) * 100),
    width: round4((rect.w / img.w) * 100),
    height: round4((rect.h / img.h) * 100),
  };
}

/**
 * Видно ли зону в покое, то есть попадает ли она в окно вида целиком.
 *
 * На десктопе окно равно кадру, поэтому видны все. На телефоне окно 430
 * показывает кадр с 12 по 442 — 32 зоны из 130 стоят правее и в покое пальцем
 * недостижимы. Это не дефект разметки: окно ездит по кадру, камера доезжает до
 * любой зоны, а дорога к «заоконным» зонам — указатель зон (тикет 34), который
 * строится по данным, а не по видимости.
 */
export function zoneInsideViewport(rect: ZoneRect, view: SceneView): boolean {
  const { w, h } = sceneSize(view);
  const r = zoneRectFor(rect, view);
  return r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h;
}

/**
 * То же положение, но в процентах СЦЕНЫ вида: «доля кадра × размещение кадра
 * в сцене» — ровно та композиция, которую делает браузер (.hotspots повторяет
 * .frame, хотспот внутри — проценты родителя). Отдельной десктопной карты не
 * появляется: десктоп получается из той же доли кадра.
 *
 * На телефоне проценты выходят и отрицательными, и больше 100 — у зон, которые
 * лежат левее и правее окна. Это не выход за границы разметки: `.viewport`
 * режет всё лишнее (`overflow: hidden`), а зона остаётся достижимой камерой и
 * указателем зон.
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
 * 40 из 120 зон телефона и 51 из 120 зон десктопа (до 30% размера), то есть
 * ровно тот баг, который чинится. Обоснование и цифры — ADR-0002.
 *
 * Дыхание здесь считается в полный размах (scaleMin 1.10, ±1.1%), хотя вблизи
 * оно срезано до 45% (`drift.zoomedFactor`): срез уменьшает ход, но не базовый
 * scale 1.10, а именно он и есть весь запас кадра — число остаётся худшим
 * случаем, а не средним.
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
  // Дрейф (scale m вокруг центра) под камерой (scale s вокруг центра + сдвиг
  // внешним слоем): точка p → c + s·m·(p − c) + T, где T = сдвиг в px. Сдвиг
  // масштабом уже не домножается — множитель s сидит внутри dx (тикет 22).
  const k = scale * ambient.scaleMin;
  const shiftX = (dx / 100) * sw;
  const shiftY = (dy / 100) * sh;
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
