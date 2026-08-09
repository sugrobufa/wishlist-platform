// Свет и время суток (тикет 96, доска Б6 · турн 11e; матрица пересчёта —
// тикет 107, турн 33a).
//
// Что здесь защищается:
// - РОДНОЕ время суток базы даёт ЧИСТУЮ identity: ни фильтра, ни слоя. Иначе
//   комната «как снято» перестала бы быть кадром дизайна, а кадры
//   неприкосновенны. Родное — своё у каждой базы: дневная только cottage,
//   пять сумеречных, четыре ночных;
// - рецепты перенесены из спецификации дословно;
// - время суток входит в светлоту, по которой считаются веса меток зон, —
//   в ночной комнате метка обязана светить сильнее;
// - цвет света на веса НЕ влияет, только на тон свечения;
// - мусор из БД читается как родное положение, а не роняет экран.
import { describe, expect, it } from "vitest";
import {
  asLightColor,
  asTimeOfDay,
  bloomTint,
  effectiveLightness,
  gradingFilter,
  gradingLayers,
  EMPTY_ROOM_FILTER,
  EMPTY_ROOM_VEIL,
  sceneFilter,
  sceneLayers,
  LIGHT_COLORS,
  NATIVE_LIGHT_COLOR,
  NATIVE_TIME_OF_DAY,
  TIMES_OF_DAY,
  TOD_FACTOR,
} from "../src/components/scene/grading";
import { markerWeights } from "../src/components/scene/zone-marker";
import { rooms } from "../src/config/design";

describe("родные положения — чистая identity", () => {
  it("выбранное = родное: ни фильтра, ни слоёв — кроме ночи у ночной базы", () => {
    for (const native of TIMES_OF_DAY) {
      if (native === "night") continue; // у неё свой рецепт, см. тикет 112
      expect(gradingFilter(native, "warm", native), native).toBe("none");
      expect(gradingLayers(native, "warm", native), native).toEqual([]);
    }
  });

  it("каждая НЕночная комната в СВОЁМ родном положении показана как снята", () => {
    // Тикет 107: до него «день» был identity для всех, и ночная база в
    // положении «ночь» получала ночь вторым слоем — замер давал 0.095
    // светлоты у gamer при 0.183 у самого кадра.
    for (const room of rooms.filter((candidate) => candidate.tod !== "night")) {
      expect(gradingFilter(room.tod, "warm", room.tod), room.id).toBe("none");
      expect(gradingLayers(room.tod, "warm", room.tod), room.id).toEqual([]);
    }
  });

  it("у ночной базы ВСЕ четыре положения светлее кадра (тикет 112)", () => {
    // Ловит возврат к «ночь всегда гасит». Ночь у ночной базы тоже светлее
    // единицы: она перестала быть идентичностью — слово владельца про
    // «слишком тёмную комнату» победило чистоту правила.
    for (const target of TIMES_OF_DAY) {
      const filter = gradingFilter(target, "warm", "night");
      const brightness = Number(/brightness\(([\d.]+)\)/.exec(filter)?.[1] ?? "1");
      expect(brightness, `night → ${target}`).toBeGreaterThan(1);
    }
  });

  it("ночь — ДВА слоя: синее окно сверху и тёплые лампы снизу (тикет 112)", () => {
    for (const native of ["day", "dusk", "night"] as const) {
      const layers = gradingLayers("night", "warm", native);
      expect(layers, native).toHaveLength(2);
      // Верхний — окно: синий на multiply. Нижний — лампы: тёплое пятно
      // радиальным градиентом на screen, центр тяжести у нижнего края.
      expect(layers[0]?.blend, native).toBe("multiply");
      expect(layers[0]?.overlay, native).toContain("52,72,118");
      expect(layers[1]?.blend, native).toBe("screen");
      expect(layers[1]?.overlay, native).toContain("radial-gradient");
      expect(layers[1]?.overlay, native).toContain("255,186,112");
      expect(layers[1]?.overlay, native).toContain("at 50% 100%");
    }
  });

  it("родные положения названы теми же словами, что и дефолты схемы", () => {
    expect(NATIVE_TIME_OF_DAY).toBe("day");
    expect(NATIVE_LIGHT_COLOR).toBe("warm");
  });
});

describe("рецепты — дословно из спецификации", () => {
  it("дневная база в ночь — числа рецепта v2 дословно", () => {
    expect(gradingFilter("night", "warm", "day")).toBe("brightness(.6) saturate(.82)");
    expect(gradingLayers("night", "warm", "day")[0]?.overlay).toBe(
      "linear-gradient(180deg,rgba(52,72,118,.26),rgba(52,72,118,.10) 55%,rgba(52,72,118,.04))",
    );
  });

  it("две ручки складываются: фильтры в одну строку, слои по одному на ручку", () => {
    expect(gradingFilter("dusk", "candle", "day")).toBe(
      "brightness(.8) saturate(1.08) saturate(1.06)",
    );
    const layers = gradingLayers("dusk", "candle", "day");
    expect(layers).toHaveLength(2);
    expect(layers[0]?.blend).toBe("multiply");
    expect(layers[1]?.blend).toBe("soft-light");
  });

  it("родная ручка своего слоя не добавляет", () => {
    expect(gradingLayers("morning", "warm", "day")).toHaveLength(1);
    expect(gradingLayers("day", "white", "day")).toHaveLength(1);
  });
});

describe("светлота и метки зон", () => {
  it("время суток гасит светлоту по своему множителю", () => {
    const cream = rooms.find((room) => room.id === "cream");
    if (!cream) throw new Error("нет пресета cream");
    expect(effectiveLightness(cream.roomLightness, "day")).toBe(cream.roomLightness);
    expect(effectiveLightness(cream.roomLightness, "night")).toBeCloseTo(
      cream.roomLightness * TOD_FACTOR.night,
      10,
    );
  });

  it("кламп держит края: тёмная комната ночью не проваливается ниже .08", () => {
    expect(effectiveLightness(0.15, "night")).toBe(0.08);
    expect(effectiveLightness(0.95, "morning")).toBe(0.95);
  });

  it("ночью метка светит СИЛЬНЕЕ, чем днём, в каждой из десяти комнат", () => {
    for (const room of rooms) {
      const day = markerWeights(effectiveLightness(room.roomLightness, "day"));
      const night = markerWeights(effectiveLightness(room.roomLightness, "night"));
      expect(night.bloom, room.id).toBeGreaterThanOrEqual(day.bloom);
    }
  });

  it("цвет света на веса не влияет — только на тон свечения", () => {
    const cream = rooms.find((room) => room.id === "cream");
    if (!cream) throw new Error("нет пресета cream");
    expect(bloomTint("warm", cream.accent)).toBe(cream.accent);
    expect(bloomTint("white", cream.accent)).toBe("#EDEAE4");
    expect(bloomTint("candle", cream.accent)).toBe("#E8A96B");
  });
});

describe("пустая комната — темнота (тикет 104)", () => {
  it("к родным положениям темнота приходит одна, без «none» в строке", () => {
    expect(sceneFilter("day", "warm", true, "day")).toBe(EMPTY_ROOM_FILTER);
    expect(sceneFilter("day", "warm", false, "day")).toBe("none");
  });

  it("к выбранному свету темнота ДОБАВЛЯЕТСЯ, а не заменяет его", () => {
    expect(sceneFilter("dusk", "warm", true, "day")).toBe(
      `brightness(.8) saturate(1.08) ${EMPTY_ROOM_FILTER}`,
    );
  });

  it("ночью пустота НЕ гасит второй раз — только вуаль (тикет 107)", () => {
    // Темнота пустоты и темнота ночи перемножались: gamer давал 0.040
    // светлоты, почти чёрный экран. Правило: комната, уже показанная
    // невключённой, второго затемнения не получает.
    expect(sceneFilter("night", "warm", true, "day")).toBe("brightness(.6) saturate(.82)");
    expect(sceneFilter("day", "warm", true, "night")).toBe(
      gradingFilter("day", "warm", "night"),
    );
    // Вуаль при этом на месте — она и несёт «свет ещё не включали».
    expect(sceneLayers("night", "warm", true, "day").at(-1)).toEqual(EMPTY_ROOM_VEIL);
  });

  it("вуаль пустоты кладётся ПОСЛЕДНИМ слоем — поверх грейдинга", () => {
    // Ночь v2 несёт два слоя, свеча — третий, вуаль пустоты — четвёртая.
    const layers = sceneLayers("night", "candle", true, "day");
    expect(layers).toHaveLength(4);
    expect(layers[3]).toEqual(EMPTY_ROOM_VEIL);
    expect(sceneLayers("night", "candle", false, "day")).toHaveLength(3);
  });
});

describe("чтение из БД — недоверчивое", () => {
  it("мусор и старые значения читаются как родное положение", () => {
    for (const bad of [null, undefined, "", "полдень", 42, {}, "DAY"]) {
      expect(asTimeOfDay(bad), JSON.stringify(bad) ?? "undefined").toBe(NATIVE_TIME_OF_DAY);
      expect(asLightColor(bad), JSON.stringify(bad) ?? "undefined").toBe(NATIVE_LIGHT_COLOR);
    }
  });

  it("каждое словарное положение читается собой", () => {
    for (const tod of TIMES_OF_DAY) expect(asTimeOfDay(tod)).toBe(tod);
    for (const color of LIGHT_COLORS) expect(asLightColor(color)).toBe(color);
  });
});
