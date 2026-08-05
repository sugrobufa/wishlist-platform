// Типизированный доступ к handoff-контрактам дизайн-пакета.
// Значения не копируются в код — импортируются из единственного источника.
import roomsJson from "@design/rooms.json";
import zonesJson from "@design/zones.json";
import motionJson from "@design/motion.json";

export type ZoneRect = { x: number; y: number; w: number; h: number };

export type RoomZone = {
  key: string;
  label: string;
  pool: string;
  rect: ZoneRect;
  /** Кадр «открыто»; null у зон, которым отдельной фотографии не снимали. */
  openFrame?: string | null;
  openVerb?: string | null;
  /**
   * Форма светового пятна метки зоны (пакет раунда 2, tokens.json → zoneMarker):
   * AR — «вытянутость» эллипса в процентах (30…120), Rot — поворот в градусах.
   * Выведены дизайном из w/h; рисует их тикет 23.
   */
  bloomAR: number;
  bloomRot: number;
  /**
   * Как размещён прямоугольник: `"composition"` — по формуле композиции кадра,
   * без замера по картинке (28 зон раунда 2, сверка — тикет 26). Отсутствие
   * поля означает измеренную зону.
   */
  placedBy?: "composition";
  /** Метка дизайна «прямоугольник сверен с кадром». */
  verified?: boolean;
};

export type Room = {
  id: string;
  name: string;
  sex: "F" | "M";
  accent: string;
  ink: string;
  base: string;
  /**
   * Светлота интерьера 0…1 (пакет раунда 2). Одно число на комнату решает,
   * чем метка зоны обозначается: светом (тёмная комната) или тенью вокруг
   * предмета (светлая). Формулы весов — tokens.json → zoneMarker.lightnessMix.
   */
  roomLightness: number;
  zones: RoomZone[];
};

type RoomsContract = {
  scene: {
    phone: { w: number; h: number; image: { w: number; h: number; x: number; y: number } };
    desktop: { w: number; h: number; factorFromPhone: number };
  };
  cameraScale: { phone: number; desktop: number };
  hitTargetMin: number;
  rooms: Room[];
};

export const roomsContract = roomsJson as unknown as RoomsContract;

// ---------- Справочник зон (zones.json) ----------

type ZonesContract = {
  note: string;
  format: string;
  keys: Record<string, [string, string, string, string, string]>;
};

const zonesContract = zonesJson as unknown as ZonesContract;

/**
 * Зона существует для продукта только если она есть в справочнике zones.json:
 * там живут подпись, глагол раскрытия и ключ пула демо-вещей.
 *
 * Раунд 2 добавил в каждую комнату 13-ю зону `money` («Просто деньги»), но
 * записи в zones.json для неё нет — ни глагола, ни пула, а денежных переводов
 * в продукте пока нет вовсе. Показать её значило бы пообещать человеку то,
 * чего за ней не стоит: зона без единой вещи и без ответа на вопрос «а что
 * дальше». Поэтому такие зоны не рендерятся нигде — ни в сцене, ни в
 * настройках, ни у гостя. Контракт при этом не тронут: как только дизайн
 * допишет ключ в zones.json, зона появится сама, без единой правки кода.
 *
 * Решение зафиксировано в docs/adr/0003-design-package-round-2.md.
 */
export function zoneHasCatalogEntry(key: string): boolean {
  return Object.hasOwn(zonesContract.keys, key);
}

/** Ключи зон из rooms.json, которых нет в zones.json (сейчас — только `money`). */
export const zoneKeysWithoutCatalogEntry: readonly string[] = [
  ...new Set(
    roomsContract.rooms
      .flatMap((room) => room.zones.map((zone) => zone.key))
      .filter((key) => !zoneHasCatalogEntry(key)),
  ),
].sort();

/**
 * Комнаты, как их видит продукт: полный контракт минус зоны без записи в
 * справочнике. Сырой контракт (все 130 зон) — `roomsContract.rooms`; он нужен
 * тестам контракта и сверке прямоугольников, но не рендеру.
 */
export const rooms: Room[] = roomsContract.rooms.map((room) =>
  room.zones.every((zone) => zoneHasCatalogEntry(zone.key))
    ? room
    : { ...room, zones: room.zones.filter((zone) => zoneHasCatalogEntry(zone.key)) },
);

export const scene = roomsContract.scene;
export const cameraScale = roomsContract.cameraScale;
export const zoneCatalog = zonesJson as Record<string, unknown>;
export const motion = motionJson as Record<string, unknown>;

/** Десктопные координаты выводятся, отдельной карты не существует (контракт). */
export function toDesktopRect(rect: ZoneRect): ZoneRect {
  const f = roomsContract.scene.desktop.factorFromPhone;
  return {
    x: (rect.x + Math.abs(roomsContract.scene.phone.image.x)) * f,
    y: rect.y * f,
    w: rect.w * f,
    h: rect.h * f,
  };
}

/** Минимальная цель нажатия из rooms.json (px). */
export const hitTargetMin = roomsContract.hitTargetMin;

export type ZoneInfo = {
  label: string;
  subtitle: string;
  openVerb: string;
  pool: string;
  moreLabel: string;
};

/** Подпись/глагол раскрытия зоны из zones.json (формат [label, subtitle, openVerb, poolKey, moreLabel]). */
export function zoneInfo(key: string): ZoneInfo | null {
  const row = zonesContract.keys[key];
  if (!row) return null;
  const [label, subtitle, openVerb, pool, moreLabel] = row;
  return { label, subtitle, openVerb, pool, moreLabel };
}

// ---------- Партитура движения (motion.json) ----------

type Ms = number | { phone: number; desktop: number };

type OpenPhase = {
  at: Ms;
  what: string;
  prop?: string;
  duration?: Ms;
  easing?: string;
  from?: string;
  to?: string;
  step?: number;
  perTile?: { opacity: number; transform: number };
};

type MotionContract = {
  easing: { out: string; walk: string; settle: string };
  cameraScale: {
    formula: string;
    phone: { min: number; max: number; sceneW: number };
    desktop: { min: number; max: number; sceneW: number };
  };
  openZone: OpenPhase[];
  closeZone: { at: Ms; what: string; duration?: Ms; easing?: string }[];
  ambient: {
    drift: { duration: { phone: number; desktop: number }; amplitude: string; amplitudeZoomed: number };
    pulse: { duration: number; stagger: number };
  };
  hover: { glow: { duration: number } };
  reducedMotion: { transitions: string };
};

const motionContract = motionJson as unknown as MotionContract;

function requireMatch(value: string, re: RegExp, what: string): RegExpMatchArray {
  const match = value.match(re);
  if (!match) {
    // Значения не копируются в код — если строка пакета изменилась, падаем громко.
    throw new Error(`design/motion.json: не удалось разобрать ${what}: "${value}"`);
  }
  return match;
}

/**
 * Фаза партитуры ищется по имени (`what`), а не по индексу.
 *
 * Раунд 2 переписал `openZone` с 4 фаз на 7 и переставил их местами: код,
 * который брал `openZone[1]` как «периферия темнеет», получил бы «шаг: масштаб»
 * и разъехался бы молча. Поиск по имени либо находит фазу, либо падает громко
 * при следующей правке контракта — второе честнее тихого разъезда.
 */
function phase(list: { what: string }[], what: string): OpenPhase {
  const found = list.find((item) => item.what === what);
  if (!found) {
    throw new Error(
      `design/motion.json: не найдена фаза «${what}» (есть: ${list.map((i) => i.what).join(" · ")})`,
    );
  }
  return found as OpenPhase;
}

function pair(value: Ms | undefined, what: string): { phone: number; desktop: number } {
  if (typeof value === "number") return { phone: value, desktop: value };
  if (value) return value;
  throw new Error(`design/motion.json: у фазы ${what} нет длительности`);
}

function flat(value: Ms | undefined, what: string): number {
  if (typeof value === "number") return value;
  throw new Error(`design/motion.json: у фазы ${what} ожидалось одно число, пришло ${JSON.stringify(value)}`);
}

const lead = phase(motionContract.openZone, "Вес переносится назад");
const stepScale = phase(motionContract.openZone, "Шаг: масштаб");
const stepMove = phase(motionContract.openZone, "Шаг: сдвиг к зоне");
const settle = phase(motionContract.openZone, "Оседание");
const veilPhase = phase(motionContract.openZone, "Периферия темнеет");
const openFramePhase = phase(motionContract.openZone, "Мебель раскрывается");
const gridPhase = phase(motionContract.openZone, "Вещи встают в сетку");
const closeGridPhase = phase(motionContract.closeZone, "Сетка гаснет");

// "translate ±1.1%, scale 1.10→1.13"
const driftAmplitude = requireMatch(
  motionContract.ambient.drift.amplitude,
  /translate\s*±\s*([\d.]+)%.*scale\s*([\d.]+)\s*→\s*([\d.]+)/u,
  "ambient.drift.amplitude",
);
// "duration → 120ms"
const reducedTransition = requireMatch(
  motionContract.reducedMotion.transitions,
  /([\d.]+)\s*ms/u,
  "reducedMotion.transitions",
);
// "scale(target * 1.03)" — перелёт шага, ткань «походки» (тикет 22).
const overshoot = requireMatch(
  stepScale.to ?? "",
  /\*\s*([\d.]+)\s*\)/u,
  "openZone «Шаг: масштаб».to (множитель перелёта)",
);
// "scale = clamp(sceneW / (zone.w * 2.4), min, max)" — делитель ширины зоны.
const scaleDivisor = requireMatch(
  motionContract.cameraScale.formula,
  /zone\.w\s*\*\s*([\d.]+)/u,
  "cameraScale.formula",
);

/**
 * Точка, вокруг которой браузер крутит scale камеры.
 *
 * В раунде 1 она приезжала из контракта (`openZone[0].origin: "50% 50%"`);
 * раунд 2 поле убрал вместе со старой первой фазой. Центр сцены — то же
 * значение, что было, и единственное, при котором арифметика центровки
 * ADR-0002 остаётся верной. Зафиксировано в ADR-0003.
 */
const CAMERA_ORIGIN = "50% 50%";
const cameraOriginPct = requireMatch(
  CAMERA_ORIGIN,
  /^\s*([\d.]+)%\s+([\d.]+)%\s*$/u,
  "transform-origin камеры",
);

/** Партитура сцены, распакованная для SceneStage (тикет 02) и сетки вещей (тикет 03). */
export const sceneMotion = {
  easingOut: motionContract.easing.out,
  /** Кривые «походки» (раунд 2): шаг и оседание. Применяет тикет 22. */
  easingWalk: motionContract.easing.walk,
  easingSettle: motionContract.easing.settle,
  /** Камера: длительность одного слитного наезда, origin и transform покоя. */
  camera: {
    /**
     * Пока камера — один слой с одним transition, берём длительность сдвига:
     * именно он довозит зону до центра и он же длиннее масштаба. Разложить
     * наезд на вложенные слои — тикет 22, ему нужен `walk` целиком.
     */
    durationMs: pair(stepMove.duration, "Шаг: сдвиг к зоне"),
    origin: CAMERA_ORIGIN,
    /** Тот же origin числом (проценты сцены) — вход в расчёт наезда. */
    originPct: { x: Number(cameraOriginPct[1]), y: Number(cameraOriginPct[2]) },
    restTransform: lead.from ?? "scale(1.02)",
  },
  /**
   * Партитура «походки» целиком — семь фаз раунда 2, для тикета 22.
   * Сейчас код её не воплощает: наезд остаётся однослойным.
   */
  walk: {
    lead: {
      durationMs: flat(lead.duration, "Вес переносится назад"),
      easing: lead.easing ?? "out",
      from: lead.from ?? "",
      to: lead.to ?? "",
    },
    scale: {
      atMs: flat(stepScale.at, "Шаг: масштаб"),
      durationMs: pair(stepScale.duration, "Шаг: масштаб"),
      easing: stepScale.easing ?? "walk",
      /** Перелёт: подъезжаем на 3% ближе, потом оседаем. */
      overshoot: Number(overshoot[1]),
    },
    translate: {
      atMs: flat(stepMove.at, "Шаг: сдвиг к зоне"),
      durationMs: pair(stepMove.duration, "Шаг: сдвиг к зоне"),
      easing: stepMove.easing ?? "walk",
    },
    settle: {
      atMs: pair(settle.at, "Оседание"),
      durationMs: flat(settle.duration, "Оседание"),
      easing: settle.easing ?? "settle",
    },
  },
  /**
   * Масштаб наезда формулой (раунд 2): фиксированное ×1.72 дизайн признал
   * ошибкой — зоны шириной от 20 до 269 px требуют разного приближения.
   * Числа `rooms.json → cameraScale` пока остаются действующими, переключение
   * на формулу — тикет 22 (ADR-0003).
   */
  cameraScaleFormula: {
    divisor: Number(scaleDivisor[1]),
    phone: motionContract.cameraScale.phone,
    desktop: motionContract.cameraScale.desktop,
  },
  /** «Периферия темнеет» — радиальная вуаль. Старт сдвинут: темнота идёт следом за шагом. */
  veil: {
    delayMs: flat(veilPhase.at, "Периферия темнеет"),
    durationMs: flat(veilPhase.duration, "Периферия темнеет"),
  },
  /** «Мебель раскрывается» — кроссфейд в кадр «открыто». */
  openFrame: {
    delayMs: pair(openFramePhase.at, "Мебель раскрывается"),
    durationMs: flat(openFramePhase.duration, "Мебель раскрывается"),
  },
  /** «Вещи встают в сетку» — тикету 03. */
  gridEnter: {
    atMs: pair(gridPhase.at, "Вещи встают в сетку"),
    stepMs: gridPhase.step ?? 0,
    perTileMs: gridPhase.perTile ?? { opacity: 0, transform: 0 },
    from: gridPhase.from ?? "",
  },
  /** closeZone «Сетка гаснет» (камера отходит следом). */
  closeGrid: { durationMs: flat(closeGridPhase.duration, "Сетка гаснет") },
  drift: {
    durationMs: motionContract.ambient.drift.duration,
    translatePct: Number(driftAmplitude[1]),
    scaleFrom: Number(driftAmplitude[2]),
    scaleTo: Number(driftAmplitude[3]),
    /** Вблизи размах дыхания срезается до 45% — иначе кадр качает (раунд 2). */
    zoomedFactor: motionContract.ambient.drift.amplitudeZoomed,
  },
  pulse: {
    durationMs: motionContract.ambient.pulse.duration,
    staggerMs: motionContract.ambient.pulse.stagger,
  },
  hoverGlow: { durationMs: motionContract.hover.glow.duration },
  reducedTransitionMs: Number(reducedTransition[1]),
} as const;

/**
 * Масштаб наезда по формуле motion.json → cameraScale:
 * `clamp(sceneW / (zone.w * 2.4), min, max)`. Ширина зоны — в координатах
 * телефонной сцены (обе раскладки считаются от неё, `sceneW: 430`).
 *
 * В сцене пока НЕ применяется: действуют числа rooms.json (ADR-0003).
 * Переключение — тикет 22.
 */
export function zoneCameraScale(rect: ZoneRect, view: "phone" | "desktop"): number {
  const { divisor } = sceneMotion.cameraScaleFormula;
  const { min, max, sceneW } = sceneMotion.cameraScaleFormula[view];
  return Math.min(max, Math.max(min, sceneW / (rect.w * divisor)));
}
