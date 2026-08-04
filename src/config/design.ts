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
  openFrame?: string;
  openVerb?: string;
};

export type Room = {
  id: string;
  name: string;
  sex: "F" | "M";
  accent: string;
  ink: string;
  base: string;
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
export const rooms = roomsContract.rooms;
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

// ---------- Справочник зон (zones.json) ----------

type ZonesContract = {
  note: string;
  format: string;
  keys: Record<string, [string, string, string, string, string]>;
};

const zonesContract = zonesJson as unknown as ZonesContract;

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

type MotionContract = {
  easing: { out: string };
  openZone: [
    { duration: { phone: number; desktop: number }; origin: string; from: string },
    { duration: number },
    { at: { phone: number; desktop: number }; duration: number },
    {
      at: { phone: number; desktop: number };
      step: number;
      perTile: { opacity: number; transform: number };
      from: string;
    },
  ];
  closeZone: [{ duration: number }, { at: number; duration: { phone: number; desktop: number } }];
  ambient: {
    drift: { duration: { phone: number; desktop: number }; amplitude: string };
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

/** Партитура сцены, распакованная для SceneStage (тикет 02) и сетки вещей (тикет 03). */
export const sceneMotion = {
  easingOut: motionContract.easing.out,
  /** openZone[0] «Камера идёт к зоне»: длительность, origin и transform покоя. */
  camera: {
    durationMs: motionContract.openZone[0].duration,
    origin: motionContract.openZone[0].origin,
    restTransform: motionContract.openZone[0].from,
  },
  /** openZone[1] «Периферия темнеет» — радиальная вуаль. */
  veil: { durationMs: motionContract.openZone[1].duration },
  /** openZone[2] «Мебель раскрывается» — кроссфейд в кадр «открыто». */
  openFrame: {
    delayMs: motionContract.openZone[2].at,
    durationMs: motionContract.openZone[2].duration,
  },
  /** openZone[3] «Вещи встают в сетку» — тикету 03. */
  gridEnter: {
    atMs: motionContract.openZone[3].at,
    stepMs: motionContract.openZone[3].step,
    perTileMs: motionContract.openZone[3].perTile,
    from: motionContract.openZone[3].from,
  },
  /** closeZone[0] «Сетка гаснет» (камера отъезжает следом, closeZone[1]). */
  closeGrid: { durationMs: motionContract.closeZone[0].duration },
  drift: {
    durationMs: motionContract.ambient.drift.duration,
    translatePct: Number(driftAmplitude[1]),
    scaleFrom: Number(driftAmplitude[2]),
    scaleTo: Number(driftAmplitude[3]),
  },
  pulse: {
    durationMs: motionContract.ambient.pulse.duration,
    staggerMs: motionContract.ambient.pulse.stagger,
  },
  hoverGlow: { durationMs: motionContract.hover.glow.duration },
  reducedTransitionMs: Number(reducedTransition[1]),
} as const;
