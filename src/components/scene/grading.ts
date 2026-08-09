// Свет и время суток (тикет 96, доска Б6 · турн 11e, `task15.json →
// lightAndTime`). Доска: «если у всех одинаковая комната, метафора умирает» —
// из четырёх ручек у нас было две (интерьер и набор зон), эти две последние.
//
// ПРИНЦИП, который нельзя нарушить: кадры НЕ ПЕРЕГЕНЕРИРУЮТСЯ (CLAUDE.md,
// изображения комнат неприкосновенны). Время суток и цвет света — грейдинг-
// слой ПОВЕРХ фотографии: фильтр на самом кадре плюс один-два градиента с
// блендом. Тонируется только сцена: текст, вуали, кнопки и таб-бар вне слоя.
//
// Модуль намеренно чистый — без React и без БД: рецепты проверяются тестом,
// а не прокликиванием комнаты.

export const TIMES_OF_DAY = ["morning", "day", "dusk", "night"] as const;
export const LIGHT_COLORS = ["warm", "white", "candle"] as const;

export type TimeOfDay = (typeof TIMES_OF_DAY)[number];
export type LightColor = (typeof LIGHT_COLORS)[number];

/** Родное положение: кадр «как снято». Слоёв нет, identity. */
export const NATIVE_TIME_OF_DAY: TimeOfDay = "day";
export const NATIVE_LIGHT_COLOR: LightColor = "warm";

/** Строка из БД → положение; мусор читается как родное, а не падает. */
export function asTimeOfDay(value: unknown): TimeOfDay {
  return TIMES_OF_DAY.includes(value as TimeOfDay) ? (value as TimeOfDay) : NATIVE_TIME_OF_DAY;
}

export function asLightColor(value: unknown): LightColor {
  return LIGHT_COLORS.includes(value as LightColor) ? (value as LightColor) : NATIVE_LIGHT_COLOR;
}

/**
 * Один слой грейдинга: градиент и его бленд. Фильтр живёт отдельно.
 * Бленд типизирован строго — иначе рецепт с опечаткой доедет до разметки и
 * молча превратится в `normal`.
 */
export type BlendMode = "screen" | "multiply" | "soft-light";
export type GradeLayer = { overlay: string; blend: BlendMode };

type Recipe = { filter: string | null; layer: GradeLayer | null };
const IDENTITY: Recipe = { filter: null, layer: null };

/**
 * Матрица пересчёта времени суток — ДОСЛОВНО из `task17.json →
 * transitionTable` (раунд 21, турн 33a). Девять рецептов: по три на каждое
 * РОДНОЕ время суток базы.
 *
 * ЗАЧЕМ ОНА. До раунда 21 мы считали все десять баз дневными и «ночь»
 * накладывали одинаково. Дизайн пересмотрел базы глазами: дневная только
 * `cottage`, пять сумеречных, четыре ночные. То есть ночной комнате мы
 * добавляли ночь ВТОРОЙ раз — замер по кадрам: `gamer` при собственной
 * светлоте 0.183 уходил в 0.095, `emerald` из 0.214 в 0.111. Именно это
 * владелец и увидел словами «комната ночью слишком тёмная».
 *
 * ПРИНЦИП (его же формулировка): identity — родное положение базы;
 * остальные три — слой поверх. Вычитания нет: недневная база к светлым
 * положениям идёт ВСТРЕЧНЫМ слоем (`screen`), а не снятием своего.
 */
const TRANSITION: Record<TimeOfDay, Partial<Record<TimeOfDay, Recipe>>> = {
  // База снята днём — рецепты те же, что были у нас с тикета 96.
  day: {
    morning: {
      filter: "brightness(1.05) saturate(.88)",
      layer: {
        overlay: "linear-gradient(180deg,rgba(255,213,168,.16),rgba(255,213,168,0) 60%)",
        blend: "screen",
      },
    },
    dusk: {
      filter: "brightness(.8) saturate(1.08)",
      layer: {
        overlay: "linear-gradient(180deg,rgba(214,118,74,.18),rgba(214,118,74,.04))",
        blend: "multiply",
      },
    },
    night: {
      filter: "brightness(.52) saturate(.7)",
      layer: {
        overlay: "linear-gradient(180deg,rgba(52,72,118,.32),rgba(52,72,118,.14))",
        blend: "multiply",
      },
    },
  },
  // База снята в сумерках: день и утро добираются встречным светлым слоем.
  dusk: {
    morning: {
      filter: "brightness(1.34) saturate(.86)",
      layer: {
        overlay: "linear-gradient(180deg,rgba(255,213,168,.16),rgba(210,225,242,.08) 60%)",
        blend: "screen",
      },
    },
    day: {
      filter: "brightness(1.3) saturate(.9)",
      layer: {
        overlay: "linear-gradient(180deg,rgba(210,225,242,.13),rgba(210,225,242,.04))",
        blend: "screen",
      },
    },
    night: {
      filter: "brightness(.6) saturate(.76)",
      layer: {
        overlay: "linear-gradient(180deg,rgba(52,72,118,.26),rgba(52,72,118,.12))",
        blend: "multiply",
      },
    },
  },
  // База снята ночью: сюда добавлять темноту больше нечего — все три
  // положения СВЕТЛЕЕ родного.
  night: {
    morning: {
      filter: "brightness(1.62) saturate(.8)",
      layer: {
        overlay: "linear-gradient(180deg,rgba(255,213,168,.18),rgba(210,225,242,.09) 60%)",
        blend: "screen",
      },
    },
    day: {
      filter: "brightness(1.55) saturate(.84)",
      layer: {
        overlay: "linear-gradient(180deg,rgba(210,225,242,.15),rgba(210,225,242,.05))",
        blend: "screen",
      },
    },
    dusk: {
      filter: "brightness(1.24) saturate(1.02)",
      layer: {
        overlay: "linear-gradient(180deg,rgba(214,118,74,.10),rgba(214,118,74,.03))",
        blend: "screen",
      },
    },
  },
  // Утренних баз нет ни одной (проверено дизайном глазами, раунд 21).
  // Строка оставлена, чтобы тип был полным, а не чтобы ею пользовались.
  morning: {},
};

/**
 * Рецепт перехода: из РОДНОГО времени суток базы в выбранное ручкой.
 * Совпали — идентичность, кадр показывается как снят.
 */
function todRecipe(native: TimeOfDay, target: TimeOfDay): Recipe {
  if (native === target) return IDENTITY;
  return TRANSITION[native][target] ?? IDENTITY;
}

/** Рецепты цвета света. `warm` = как снято = identity. */
const LIGHT_RECIPES: Record<LightColor, { filter: string | null; layer: GradeLayer | null }> = {
  warm: { filter: null, layer: null },
  white: {
    filter: "saturate(.8)",
    layer: { overlay: "rgba(233,237,242,.12)", blend: "soft-light" },
  },
  candle: {
    filter: "saturate(1.06)",
    layer: { overlay: "rgba(232,168,106,.18)", blend: "soft-light" },
  },
};

/**
 * Насколько время суток гасит комнату. Число НЕ про показ: по нему считаются
 * веса меток зон — в ночной комнате метка обязана светить сильнее, иначе она
 * пропадает вместе с интерьером.
 */
export const TOD_FACTOR: Record<TimeOfDay, number> = {
  morning: 1.06,
  day: 1,
  dusk: 0.78,
  night: 0.5,
};

/**
 * Светлота комнаты с учётом времени суток. Кламп из спецификации: ниже .08
 * метка перестаёт отличать предмет от фона, выше .95 её не видно вовсе.
 * Цвет света на веса НЕ влияет — только на тон свечения (`bloomTint`).
 */
export function effectiveLightness(roomLightness: number, tod: TimeOfDay): number {
  const value = roomLightness * TOD_FACTOR[tod];
  return Math.min(0.95, Math.max(0.08, value));
}

/**
 * Фильтр на сам кадр: рецепты времени и света складываются в одну строку
 * (CSS-фильтры композируются слева направо). `none` — обе ручки родные.
 */
export function gradingFilter(tod: TimeOfDay, color: LightColor, native: TimeOfDay): string {
  const parts = [todRecipe(native, tod).filter, LIGHT_RECIPES[color].filter].filter(
    (part): part is string => part !== null,
  );
  return parts.length === 0 ? "none" : parts.join(" ");
}

/**
 * Слои-градиенты поверх кадра — по одному на ручку, у каждого свой бленд.
 * Пусто, когда обе ручки родные: лишнего узла в разметке не появляется.
 */
export function gradingLayers(
  tod: TimeOfDay,
  color: LightColor,
  native: TimeOfDay,
): GradeLayer[] {
  return [todRecipe(native, tod).layer, LIGHT_RECIPES[color].layer].filter(
    (layer): layer is GradeLayer => layer !== null,
  );
}

/**
 * Пустая комната — ТЕМНОТА, а не чужие вещи-примеры (тикет 104, решение
 * владельца 09.08.2026 вслед за вердиктом дизайна: пунктирный контур кодирует
 * «хочу», и на чужом примере читается как чужое желание).
 *
 * Числа — `task15.json → emptyStates.emptyRoom.scene`. Это тот же механизм,
 * что у времени суток: фильтр на кадре плюс вуаль сверху. Кадр не тронут —
 * свет включится сам, как только появится первая вещь.
 */
export const EMPTY_ROOM_FILTER = "brightness(.42) saturate(.72)";
export const EMPTY_ROOM_VEIL: GradeLayer = {
  overlay: "linear-gradient(0deg,rgba(11,8,6,.78),rgba(11,8,6,.1) 52%)",
  blend: "multiply",
};

/**
 * Гасит ли пустая комната кадр ЕЩЁ и фильтром — или только вуалью.
 *
 * Темнота пустоты и темнота ночи перемножаются, и это видно числом: `gamer`
 * при собственной светлоте 0.183 и ночном рецепте давал 0.095, а с пустотой
 * сверху — **0.040**, то есть почти чёрный экран (замер по кадрам, 09.08).
 *
 * Правило, а не подобранное число: затемнение пустоты существует, чтобы
 * сказать «свет ещё не включали». В комнате, которая УЖЕ показана
 * невключённой — выбрана ночь либо база ночная, — это сказано кадром, и
 * второй раз гасить нечего. Вуаль остаётся: она несёт ту же мысль, но не
 * умножает яркость.
 */
function emptyDarkensFilter(tod: TimeOfDay, native: TimeOfDay): boolean {
  return tod !== "night" && native !== "night";
}

/** Фильтр кадра с учётом пустоты комнаты: темнота копится поверх грейдинга. */
export function sceneFilter(
  tod: TimeOfDay,
  color: LightColor,
  empty: boolean,
  native: TimeOfDay,
): string {
  const graded = gradingFilter(tod, color, native);
  if (!empty || !emptyDarkensFilter(tod, native)) return graded;
  return graded === "none" ? EMPTY_ROOM_FILTER : `${graded} ${EMPTY_ROOM_FILTER}`;
}

/** Слои сцены: грейдинг плюс вуаль пустоты последней (она поверх всего). */
export function sceneLayers(
  tod: TimeOfDay,
  color: LightColor,
  empty: boolean,
  native: TimeOfDay,
): GradeLayer[] {
  const layers = gradingLayers(tod, color, native);
  return empty ? [...layers, EMPTY_ROOM_VEIL] : layers;
}

/** Тон свечения метки зоны: тёплый берёт акцент комнаты, остальные — свой. */
export function bloomTint(color: LightColor, accent: string): string {
  if (color === "white") return "#EDEAE4";
  if (color === "candle") return "#E8A96B";
  return accent;
}
