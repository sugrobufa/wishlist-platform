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

/**
 * Рецепты времени суток — ДОСЛОВНО из `task15.json → lightAndTime.recipes`.
 * `day` пуст: все наши базы сняты дневными, и «день» — это identity.
 *
 * TODO (когда в контракте появится родной `tod` комнаты): для недневной базы
 * положение её родного tod становится identity, а день — обратным рецептом
 * (`transitionTable` в спецификации). Считать это сейчас не из чего: поля
 * `tod` в `rooms.json` нет ни у одной из десяти комнат.
 */
const TOD_RECIPES: Record<TimeOfDay, { filter: string | null; layer: GradeLayer | null }> = {
  morning: {
    filter: "brightness(1.05) saturate(.88)",
    layer: {
      overlay: "linear-gradient(180deg,rgba(255,213,168,.16),rgba(255,213,168,0) 60%)",
      blend: "screen",
    },
  },
  day: { filter: null, layer: null },
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
};

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
export function gradingFilter(tod: TimeOfDay, color: LightColor): string {
  const parts = [TOD_RECIPES[tod].filter, LIGHT_RECIPES[color].filter].filter(
    (part): part is string => part !== null,
  );
  return parts.length === 0 ? "none" : parts.join(" ");
}

/**
 * Слои-градиенты поверх кадра — по одному на ручку, у каждого свой бленд.
 * Пусто, когда обе ручки родные: лишнего узла в разметке не появляется.
 */
export function gradingLayers(tod: TimeOfDay, color: LightColor): GradeLayer[] {
  return [TOD_RECIPES[tod].layer, LIGHT_RECIPES[color].layer].filter(
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

/** Фильтр кадра с учётом пустоты комнаты: темнота копится поверх грейдинга. */
export function sceneFilter(tod: TimeOfDay, color: LightColor, empty: boolean): string {
  const graded = gradingFilter(tod, color);
  if (!empty) return graded;
  return graded === "none" ? EMPTY_ROOM_FILTER : `${graded} ${EMPTY_ROOM_FILTER}`;
}

/** Слои сцены: грейдинг плюс вуаль пустоты последней (она поверх всего). */
export function sceneLayers(tod: TimeOfDay, color: LightColor, empty: boolean): GradeLayer[] {
  const layers = gradingLayers(tod, color);
  return empty ? [...layers, EMPTY_ROOM_VEIL] : layers;
}

/** Тон свечения метки зоны: тёплый берёт акцент комнаты, остальные — свой. */
export function bloomTint(color: LightColor, accent: string): string {
  if (color === "white") return "#EDEAE4";
  if (color === "candle") return "#E8A96B";
  return accent;
}
