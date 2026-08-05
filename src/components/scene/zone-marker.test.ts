import { describe, it, expect } from "vitest";
import { rooms } from "@/config/design";
import {
  bloomShape,
  focusOutline,
  labelAboveZone,
  markerWeights,
  vignetteShape,
} from "./zone-marker";

// Метка зоны (тикет 23). Проверяем не «как нарисовано», а два места, где легко
// разъехаться с контрактом молча: арифметику весов света против тени и
// подстановку в шаблоны фигур. Ожидания взяты из самого пакета
// (tokens.json → zoneMarker.lightnessMix.examples), а не придуманы здесь.

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`не найдено: ${what}`);
  return value;
}

const cream = must(
  rooms.find((room) => room.id === "cream"),
  "комната cream",
);
const bold = must(
  rooms.find((room) => room.id === "bold"),
  "комната bold",
);

describe("веса метки зоны из светлоты комнаты", () => {
  it("кремовая (0.82) держится тенью — пакет обещает свет 0.39 против тени 0.87", () => {
    expect(cream.roomLightness).toBe(0.82);
    // Точные значения формулы; пакет в примерах округляет их до 0.39 и 0.87.
    expect(markerWeights(cream.roomLightness)).toEqual({ bloom: 0.385, vignette: 0.865 });
  });

  it("неоновая «Дерзкая» (0.15) держится светом — пакет обещает 0.89 против 0.36", () => {
    expect(bold.roomLightness).toBe(0.15);
    expect(markerWeights(bold.roomLightness)).toEqual({ bloom: 0.8875, vignette: 0.3625 });
  });

  it("одна ветка на все комнаты: свет убывает со светлотой, тень растёт", () => {
    // Если кто-то заведёт `if` для светлых комнат, монотонность сломается
    // первой — это и есть проверка «механизм один и тот же».
    const sorted = [...rooms].sort((a, b) => a.roomLightness - b.roomLightness);
    const weights = sorted.map((room) => markerWeights(room.roomLightness));
    for (let i = 1; i < weights.length; i += 1) {
      const prev = must(weights[i - 1], "предыдущая комната");
      const next = must(weights[i], "следующая комната");
      expect(next.bloom).toBeLessThanOrEqual(prev.bloom);
      expect(next.vignette).toBeGreaterThanOrEqual(prev.vignette);
    }
  });

  it("веса всегда положительны — ни один слой не выключается целиком", () => {
    for (const room of rooms) {
      const w = markerWeights(room.roomLightness);
      expect(w.bloom, room.id).toBeGreaterThan(0);
      expect(w.vignette, room.id).toBeGreaterThan(0);
    }
  });
});

describe("фигуры метки собираются из шаблонов контракта", () => {
  it("пятно вытянуто по bloomAR зоны, акцент — переменной комнаты", () => {
    const zone = must(
      cream.zones.find((z) => z.key === "fashion"),
      "зона cream/fashion",
    );
    const shape = bloomShape(zone.bloomAR);
    expect(shape).toContain(`ellipse ${zone.bloomAR}%`);
    expect(shape).toContain("var(--accent)");
    // Многоточие прозы («края растворяются») не должно уехать в CSS.
    expect(shape).not.toContain("…");
    expect(shape).not.toMatch(/\{[a-z]+\}/u);
  });

  it("вес тени уходит в альфу цвета виньетки, а не в прозрачность слоя", () => {
    const shape = vignetteShape(markerWeights(cream.roomLightness));
    expect(shape).toContain("0.865");
    expect(shape).not.toMatch(/\{[a-z]+\}/u);
  });

  it("рамка фокуса — пунктир акцентом", () => {
    expect(focusOutline()).toBe("1px dashed var(--accent)");
  });

  it("шаблон пятна собирается для всех 120 зон рендера", () => {
    for (const room of rooms) {
      for (const zone of room.zones) {
        expect(bloomShape(zone.bloomAR), `${room.id}/${zone.key}`).not.toMatch(/\{[a-z]+\}/u);
      }
    }
  });
});

describe("переворот подписи зоны", () => {
  it("зона в верхней части кадра — подпись под ней", () => {
    expect(labelAboveZone({ top: 10, height: 30 })).toBe(false);
  });

  it("зона, уходящая ниже 70% высоты, — подпись над ней", () => {
    expect(labelAboveZone({ top: 55, height: 40 })).toBe(true);
  });

  it("высокая зона решает по нижней границе, а не по верхней", () => {
    // Шкаф во всю стену: верх высоко, но подпись рисуется под низом — значит
    // и переворот обязан считаться от низа.
    expect(labelAboveZone({ top: 20, height: 75 })).toBe(true);
  });
});
