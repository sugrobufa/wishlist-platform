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
  /**
   * Раунд 4 переопределил смысл: `verified` теперь машинное «прямоугольник не
   * попал под обрезку правого края» (`x + w < 400`), а НЕ «дизайн посмотрел
   * глазами». Разбор — `handoff/coords-fix.md`.
   */
  verified?: boolean;
  /** Кадр «открыто» прошёл порог приёмки раунда 3 (49 зон из 130). */
  accepted?: boolean;
  /** Кадр «открыто» порог не прошёл и ждёт пересъёмки (81 зона, openFrame: null). */
  reshoot?: boolean;
  /**
   * Прямоугольник прижат к правому краю окна 430 и, скорее всего, показывает не
   * на тот предмет: настоящий стоит правее, в невидимой окну трети кадра.
   * 36 зон; переразметка — на стороне дизайна, кодом не чиним (раунд 4).
   */
  clamped?: boolean;
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
  /**
   * Раунд 4 пометил блок УСТАРЕВШИМ и убрал ключ `desktop`: источник истины по
   * масштабу наезда — `motion.json → cameraScale` (формула с потолком 2.05),
   * на неё сцена перешла ещё в тикете 22. Здесь остались `phone: 1.72` и
   * прежний десктопный множитель под именем `desktopLegacy` — как эталон того,
   * от чего ушли; в расчётах сцены не участвуют.
   */
  cameraScale: {
    note: string;
    phone: number;
    desktopLegacy: number;
    desktopCeiling: number;
  };
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
 * Раунд 4 дописал единственный ключ, которого не хватало (`money`), так что
 * сейчас справочник покрывает все 130 зон и фильтр никого не отсеивает.
 * Правило оставлено: следующая недостающая запись снова спрячет зону, а не
 * выведет на экран подпись, выдуманную кодом.
 *
 * Решение зафиксировано в docs/adr/0003-design-package-round-2.md.
 */
export function zoneHasCatalogEntry(key: string): boolean {
  return Object.hasOwn(zonesContract.keys, key);
}

/** Ключи зон из rooms.json, которых нет в zones.json (после раунда 4 — пусто). */
export const zoneKeysWithoutCatalogEntry: readonly string[] = [
  ...new Set(
    roomsContract.rooms
      .flatMap((room) => room.zones.map((zone) => zone.key))
      .filter((key) => !zoneHasCatalogEntry(key)),
  ),
].sort();

/**
 * Зоны, которые продукт не показывает по решению ВЛАДЕЛЬЦА, а не из-за дырки
 * в контракте.
 *
 * `money` («Просто деньги») — PRD §12а: «Деньги через сервис не ходят никогда»
 * (гриллинг 2026-08-04). Платёжного провайдера нет ни в какой фазе, экрана
 * складчины нет, пула демо-вещей у зоны нет. До раунда 4 зона не показывалась
 * сама собой — ключа не было в справочнике; раунд 4 ключ дописал, и без этого
 * списка тринадцатая полка включилась бы молча: человек нажал бы на конверт и
 * упёрся в пустоту.
 *
 * Снимается ровно тем же способом, каким поставлена, — решением владельца:
 * убрать ключ из списка, и зона появится во всех десяти комнатах (кадры
 * «открыто» для неё уже приняты и лежат в refs/).
 */
export const zoneKeysHiddenByProduct: readonly string[] = ["money"];

/**
 * Комнаты, для которых кадры пакета НЕ приняты: базовый кадр разошёлся с
 * нынешним сильнее порога композиции 0.05 — мебель поехала, значит все 13
 * прямоугольников комнаты к новым кадрам не подходят.
 *
 * Замер (`scripts/refs-from-masters.mjs`, средний модуль разности яркости с
 * нынешним кадром, оба в сером 1200×670): warm 0.0727, loft 0.0685 — против
 * 0.029…0.045 у восьми принятых. Глазами видно то же: в warm ваза с пионами
 * выросла и закрыла вертушку с креслом, в loft уехали стеллаж и стол.
 *
 * Поэтому у этих двух комнат ни базовый кадр, ни «открыто» из пакета не
 * подключены: кроссфейд между кадрами РАЗНЫХ комплектов — это и есть «вся
 * комната поплыла», что контракт прямо запрещает. Зона без обещания честнее.
 * Разбор и числа — docs/adr/0005-design-package-round-4.md.
 */
const ROOMS_WITHOUT_ACCEPTED_FRAMES: readonly string[] = ["warm", "loft"];

/**
 * Путь кадра из контракта (`refs-2x/cream/v4-cream.jpg`) → путь раздачи
 * (`refs/v4-cream.jpg`).
 *
 * Пакет раскладывает кадры по папкам комнат, а продукт раздаёт их плоским
 * списком из `design/package/refs` (`src/app/rooms/[image]/route.ts`: имя без
 * слэшей, обход каталога невозможен по построению). Имя файла в обеих схемах
 * одно и то же, поэтому перевод — это отбрасывание папок, а не своя карта имён.
 */
export function framePath(ref: string): string {
  return `refs/${ref.slice(ref.lastIndexOf("/") + 1)}`;
}

/**
 * Комнаты, как их видит продукт: полный контракт минус скрытые зоны, с путями
 * кадров, приведёнными к схеме раздачи, и без кадров «открыто» у комнат, чьи
 * кадры не приняты. Сырой контракт (все 130 зон, пути пакета) —
 * `roomsContract.rooms`; он нужен тестам контракта и сверке прямоугольников,
 * но не рендеру.
 */
export const rooms: Room[] = roomsContract.rooms.map((room) => {
  const framesAccepted = !ROOMS_WITHOUT_ACCEPTED_FRAMES.includes(room.id);
  return {
    ...room,
    base: framePath(room.base),
    zones: room.zones
      .filter((zone) => zoneHasCatalogEntry(zone.key) && !zoneKeysHiddenByProduct.includes(zone.key))
      .map((zone) => ({
        ...zone,
        openFrame: zone.openFrame && framesAccepted ? framePath(zone.openFrame) : null,
      })),
  };
});

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
  /** Точка вращения слоя; вернулась в контракт в раунде 4 (см. CAMERA_ORIGIN). */
  origin?: string;
  /** Формула сдвига камеры словами контракта (фаза «Шаг: сдвиг к зоне»). */
  dx?: string;
  dy?: string;
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
 * В раунде 1 она приезжала из контракта (`openZone[0].origin`); раунд 2 поле
 * убрал вместе со старой первой фазой, и код держал значение константой
 * (ADR-0003 §4) — с обещанием прочитать из контракта, как только поле вернут.
 * Раунд 4 вернул `origin` во все четыре фазы камеры, обещание исполнено.
 * Запасное значение то же самое: если поле снова исчезнет, поведение не
 * изменится, а расхождение не будет тихим — про него написано здесь.
 */
const CAMERA_ORIGIN = stepMove.origin ?? "50% 50%";

/**
 * Формула сдвига камеры словами контракта — и признак того самого деления,
 * из-за которого зона не доезжала до центра.
 *
 * Раунды 1–3 писали `… * 100 / scale`, а браузер тем же `scale` сдвиг домножал:
 * камера приезжала ровно в S раз короче нужного (разбор — ADR-0002). Код считал
 * без деления, и это было наше единственное расхождение с пакетом. Раунд 4
 * формулу исправил и приписал `dxNote` со ссылкой на наш ADR — расхождения
 * больше нет, а флаг ниже сторожит, чтобы деление не вернулось молча.
 */
const panFormula = {
  dx: stepMove.dx ?? "",
  dy: stepMove.dy ?? "",
  dividesByScale: /\/\s*scale/u.test(`${stepMove.dx ?? ""} ${stepMove.dy ?? ""}`),
} as const;
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
    /** Формула сдвига из контракта; `dividesByScale` — сторож отступления ADR-0002. */
    panFormula,
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
