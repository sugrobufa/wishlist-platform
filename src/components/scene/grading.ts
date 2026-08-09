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

type Recipe = { filter: string | null; layers: GradeLayer[] };
const IDENTITY: Recipe = { filter: null, layers: [] };

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
/**
 * НОЧЬ V2 — два слоя (тикет 112, доска 34a; числа дословно из
 * `task18.json → nightRecipeV2`).
 *
 * Владелец: «комната ночью слишком тёмная, надо добавить мягкий свет».
 * Диагноз дизайна: ночь одним синим слоем — это окно без ламп. Стало два:
 * сверху синее окно (слабее прежнего, multiply), снизу тёплое пятно ламп
 * (radial, screen, центр тяжести у нижнего края).
 *
 * Ночь применяется ко ВСЕМ родным tod, включая ночные базы: у них она
 * перестала быть идентичностью. Это сознательное отступление от правила
 * «родное = как снято» — его сделал сам дизайн, потому что «слово владельца
 * важнее чистоты правила». Кадр при этом не тронут: свет лампы — слой.
 */
const NIGHT_V2: Record<"day" | "dusk" | "night", Recipe> = {
  day: {
    filter: "brightness(.6) saturate(.82)",
    layers: [
      {
        overlay:
          "linear-gradient(180deg,rgba(52,72,118,.26),rgba(52,72,118,.10) 55%,rgba(52,72,118,.04))",
        blend: "multiply",
      },
      {
        overlay: "radial-gradient(120% 85% at 50% 100%,rgba(255,186,112,.30),rgba(255,186,112,0) 62%)",
        blend: "screen",
      },
    ],
  },
  dusk: {
    filter: "brightness(.68) saturate(.84)",
    layers: [
      {
        overlay:
          "linear-gradient(180deg,rgba(52,72,118,.20),rgba(52,72,118,.08) 55%,rgba(52,72,118,.03))",
        blend: "multiply",
      },
      {
        overlay: "radial-gradient(120% 85% at 50% 100%,rgba(255,186,112,.26),rgba(255,186,112,0) 60%)",
        blend: "screen",
      },
    ],
  },
  night: {
    filter: "brightness(1.12) saturate(1.02)",
    layers: [
      {
        overlay: "linear-gradient(180deg,rgba(52,72,118,.10),rgba(52,72,118,0) 50%)",
        blend: "multiply",
      },
      {
        overlay: "radial-gradient(120% 85% at 50% 100%,rgba(255,186,112,.20),rgba(255,186,112,0) 58%)",
        blend: "screen",
      },
    ],
  },
};

const TRANSITION: Record<TimeOfDay, Partial<Record<TimeOfDay, Recipe>>> = {
  // База снята днём.
  day: {
    morning: {
      filter: "brightness(1.05) saturate(.88)",
      layers: [
        {
          overlay: "linear-gradient(180deg,rgba(255,213,168,.16),rgba(255,213,168,0) 60%)",
          blend: "screen",
        },
      ],
    },
    dusk: {
      filter: "brightness(.8) saturate(1.08)",
      layers: [
        {
          overlay: "linear-gradient(180deg,rgba(214,118,74,.18),rgba(214,118,74,.04))",
          blend: "multiply",
        },
      ],
    },
    night: NIGHT_V2.day,
  },
  // База снята в сумерках: день и утро добираются встречным светлым слоем.
  dusk: {
    morning: {
      filter: "brightness(1.34) saturate(.86)",
      layers: [
        {
          overlay: "linear-gradient(180deg,rgba(255,213,168,.16),rgba(210,225,242,.08) 60%)",
          blend: "screen",
        },
      ],
    },
    day: {
      filter: "brightness(1.3) saturate(.9)",
      layers: [
        {
          overlay: "linear-gradient(180deg,rgba(210,225,242,.13),rgba(210,225,242,.04))",
          blend: "screen",
        },
      ],
    },
    night: NIGHT_V2.dusk,
  },
  // База снята ночью: утро, день и сумерки СВЕТЛЕЕ родного.
  night: {
    morning: {
      filter: "brightness(1.62) saturate(.8)",
      layers: [
        {
          overlay: "linear-gradient(180deg,rgba(255,213,168,.18),rgba(210,225,242,.09) 60%)",
          blend: "screen",
        },
      ],
    },
    day: {
      filter: "brightness(1.55) saturate(.84)",
      layers: [
        {
          overlay: "linear-gradient(180deg,rgba(210,225,242,.15),rgba(210,225,242,.05))",
          blend: "screen",
        },
      ],
    },
    dusk: {
      filter: "brightness(1.24) saturate(1.02)",
      layers: [
        {
          overlay: "linear-gradient(180deg,rgba(214,118,74,.10),rgba(214,118,74,.03))",
          blend: "screen",
        },
      ],
    },
    // Ночь у ночной базы БОЛЬШЕ НЕ IDENTITY (тикет 112, турн 34a). Правило
    // «родное положение — кадр как снят» здесь уступило слову владельца:
    // «комната ночью слишком тёмная, добавить мягкий свет». Кадр всё равно
    // не тронут — свет лампы кладётся слоем поверх, как и всё остальное.
    night: NIGHT_V2.night,
  },
  // Утренних баз нет ни одной (проверено дизайном глазами, раунд 21).
  // Строка оставлена, чтобы тип был полным, а не чтобы ею пользовались.
  morning: {},
};

/**
 * Рецепт перехода: из РОДНОГО времени суток базы в выбранное ручкой.
 *
 * Рецепт для «своего» положения существует ровно один — ночь у ночной базы
 * (тикет 112, доска 34a). Во всех остальных совпадениях кадр показывается
 * как снят, и слоёв нет.
 */
function todRecipe(native: TimeOfDay, target: TimeOfDay): Recipe {
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
  return [...todRecipe(native, tod).layers, LIGHT_RECIPES[color].layer].filter(
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
 * Пустая ЗОНА — наезд в комнате (35b, раунд 23 · турн 25c; числа —
 * `task15.json → emptyStates.emptyZone.scene`).
 *
 * ЭТО ДРУГОЙ СЛОЙ, ЧЕМ ПУСТАЯ КОМНАТА, и место у него своё: панель зоны
 * раскрыта поверх кадра, и гаснет СЦЕНА ПОД НЕЙ — на время, пока человек
 * стоит у пустой полки. Дизайн назвал место сам, раундом 23: «недоразумение
 * моё — в task15 место слоя не было названо». Экран «зона списком» тут ни при
 * чём: сцены там нет, гасить нечего, и его мы не трогаем.
 *
 * Числа мягче комнатных (.56 против .42, .8 против .72) ровно потому, что
 * говорят меньше: не «свет ещё не включали во всей комнате», а «на этой полке
 * пока пусто».
 */
export const EMPTY_ZONE_FILTER = "brightness(.56) saturate(.8)";
export const EMPTY_ZONE_VEIL: GradeLayer = {
  overlay: "linear-gradient(0deg,rgba(11,8,6,.7),rgba(11,8,6,.05) 54%)",
  blend: "multiply",
};

/**
 * Гасит ли пустота кадр ЕЩЁ и фильтром — или только вуалью.
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
 *
 * ПРАВИЛО ОБЩЕЕ ДЛЯ ОБОИХ СЛОЁВ. Дизайн записал «не множится на ночь» рядом с
 * затемнением пустой ЗОНЫ (`emptyZoneSceneClarify.when`) — с той же мыслью и
 * с теми же последствиями: 0.268 средней ночи, умноженные на .56, дали бы
 * 0.150, а самая тёмная комната ушла бы с 0.200 в 0.112.
 */
function emptyDarkensFilter(tod: TimeOfDay, native: TimeOfDay): boolean {
  return tod !== "night" && native !== "night";
}

/**
 * Фильтр кадра с учётом пустоты: темнота копится поверх грейдинга.
 *
 * ДВЕ ПУСТОТЫ НЕ СКЛАДЫВАЮТСЯ. В пустой комнате пусты и все её зоны, и наезд
 * давал бы .42 × .56 = 0.235 от исходного — 0.075 средней светлоты по десяти
 * комнатам, то есть тот же чёрный экран, который чинил тикет 107. Довод тот же,
 * что у ночи: комната, уже показанная невключённой, второй раз не гаснет.
 * Поэтому фильтр пустой зоны берётся только там, где комнатного нет (решение
 * наше — дизайн назвал только ночь; вопрос ему выписан).
 *
 * ВУАЛИ РАЗВЕДЕНЫ ТАК ЖЕ. Вуаль пустой ЗОНЫ — отдельный слой сцены
 * (`SceneStage` → `.zoneDim`), и правило у него то же самое: ночью остаётся
 * (она несёт мысль, не трогая яркость), в пустой КОМНАТЕ его нет вовсе — две
 * вуали `multiply` перемножаются ровно как две яркости.
 */
export function sceneFilter(
  tod: TimeOfDay,
  color: LightColor,
  empty: boolean,
  native: TimeOfDay,
  emptyZone = false,
): string {
  const graded = gradingFilter(tod, color, native);
  let dim: string | null = null;
  if (emptyDarkensFilter(tod, native)) {
    if (empty) dim = EMPTY_ROOM_FILTER;
    else if (emptyZone) dim = EMPTY_ZONE_FILTER;
  }
  if (!dim) return graded;
  return graded === "none" ? dim : `${graded} ${dim}`;
}

/** Слои сцены: грейдинг плюс вуаль пустой комнаты последней (она поверх всего). */
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
