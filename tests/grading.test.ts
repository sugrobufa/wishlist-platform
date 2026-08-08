// Свет и время суток (тикет 96, доска Б6 · турн 11e).
//
// Что здесь защищается:
// - родные положения дают ЧИСТУЮ identity: ни фильтра, ни слоя. Иначе комната
//   «как снято» перестала бы быть кадром дизайна, а кадры неприкосновенны;
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
  it("день + тёплый: ни фильтра, ни слоёв", () => {
    expect(gradingFilter("day", "warm")).toBe("none");
    expect(gradingLayers("day", "warm")).toEqual([]);
  });

  it("родные положения названы теми же словами, что и дефолты схемы", () => {
    expect(NATIVE_TIME_OF_DAY).toBe("day");
    expect(NATIVE_LIGHT_COLOR).toBe("warm");
  });
});

describe("рецепты — дословно из спецификации", () => {
  it("ночь: гасит и обесцвечивает, слой синий на multiply", () => {
    expect(gradingFilter("night", "warm")).toBe("brightness(.52) saturate(.7)");
    expect(gradingLayers("night", "warm")).toEqual([
      {
        overlay: "linear-gradient(180deg,rgba(52,72,118,.32),rgba(52,72,118,.14))",
        blend: "multiply",
      },
    ]);
  });

  it("две ручки складываются: фильтры в одну строку, слои по одному на ручку", () => {
    expect(gradingFilter("dusk", "candle")).toBe("brightness(.8) saturate(1.08) saturate(1.06)");
    const layers = gradingLayers("dusk", "candle");
    expect(layers).toHaveLength(2);
    expect(layers[0]?.blend).toBe("multiply");
    expect(layers[1]?.blend).toBe("soft-light");
  });

  it("родная ручка своего слоя не добавляет", () => {
    expect(gradingLayers("morning", "warm")).toHaveLength(1);
    expect(gradingLayers("day", "white")).toHaveLength(1);
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
    expect(sceneFilter("day", "warm", true)).toBe(EMPTY_ROOM_FILTER);
    expect(sceneFilter("day", "warm", false)).toBe("none");
  });

  it("к выбранному свету темнота ДОБАВЛЯЕТСЯ, а не заменяет его", () => {
    expect(sceneFilter("night", "warm", true)).toBe(
      `brightness(.52) saturate(.7) ${EMPTY_ROOM_FILTER}`,
    );
  });

  it("вуаль пустоты кладётся ПОСЛЕДНИМ слоем — поверх грейдинга", () => {
    const layers = sceneLayers("night", "candle", true);
    expect(layers).toHaveLength(3);
    expect(layers[2]).toEqual(EMPTY_ROOM_VEIL);
    expect(sceneLayers("night", "candle", false)).toHaveLength(2);
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
