import { describe, it, expect } from "vitest";
import { rooms, scene } from "@/config/design";
import { zoneFramePercent } from "./camera";
import {
  bloomShape,
  distanceToZone,
  focusOutline,
  labelAboveZone,
  markerMask,
  markerWeights,
  nearestZoneLight,
  PROXIMITY_RADIUS,
  proximityStrength,
  TOUCH_REST_STRENGTH,
  VIGNETTE_BLEED_PCT,
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

// ---------- Тикет 50: метка без прямых краёв ---------------------------------

/** Последняя остановка градиента/маски: цвет и позиция в % (или null). */
function lastStop(gradient: string): { color: string; pct: number } | null {
  const stops = [...gradient.matchAll(/([#\w(),.]+?)\s+([\d.]+)%[,)]/gu)];
  const last = stops[stops.length - 1];
  return last ? { color: String(last[1]), pct: Number(last[2]) } : null;
}

describe("слои метки не обрезаются прямоугольником (тикет 50)", () => {
  it("виньетка завершается прозрачностью СТРОГО до края слоя", () => {
    // Жалоба владельца: контрактная фигура доводила тень до 100% луча, и весь
    // слой за эллипсом заливался конечным цветом — прямоугольник зоны резал
    // его коробкой. Теперь конечный цвет прозрачный и наступает до края:
    // резать больше нечего, прямых линий слой породить не может.
    const shape = vignetteShape(markerWeights(cream.roomLightness));
    const end = lastStop(shape);
    expect(end).not.toBeNull();
    expect(end?.color).toBe("transparent");
    expect(end?.pct).toBeLessThan(100);
  });

  it("замысел контракта в фигуре виньетки сохранён: центр освещён, вес — в альфе тени", () => {
    const shape = vignetteShape(markerWeights(cream.roomLightness));
    // Граница освещённого центра — по-прежнему из пакета (transparent 38%).
    expect(shape).toContain("transparent 38%");
    // Тень тем же цветом контракта, вес комнаты в альфе.
    expect(shape).toContain("rgba(24,14,6,0.865)");
  });

  it("маска пятна гаснет до края коробки — широкий bloomAR больше не режется", () => {
    // При bloomAR > ~69 (у «Геймера» — 120) угасание пятна не умещалось в
    // коробке и край зоны обрезал свет прямой кромкой.
    const end = lastStop(markerMask());
    expect(end).not.toBeNull();
    expect(end?.color).toBe("transparent");
    expect(end?.pct).toBeLessThan(100);
  });

  it("вынос виньетки за коробку — умеренный: кольцо у границы, не заливка соседей", () => {
    expect(VIGNETTE_BLEED_PCT).toBeGreaterThan(0);
    expect(VIGNETTE_BLEED_PCT).toBeLessThanOrEqual(30);
  });
});

describe("правило близости: свет по приближению (тикет 50)", () => {
  it("радиус задан числом в единицах кадра и меньше половины его высоты", () => {
    expect(PROXIMITY_RADIUS).toBeGreaterThan(0);
    expect(PROXIMITY_RADIUS).toBeLessThan(scene.phone.image.h / 2);
  });

  it("сила: 1 внутри зоны, 0 на радиусе и дальше, посередине — половина", () => {
    expect(proximityStrength(0)).toBe(1);
    expect(proximityStrength(-5)).toBe(1);
    expect(proximityStrength(PROXIMITY_RADIUS)).toBe(0);
    expect(proximityStrength(PROXIMITY_RADIUS * 3)).toBe(0);
    expect(proximityStrength(PROXIMITY_RADIUS / 2)).toBeCloseTo(0.5, 4);
  });

  it("расстояние до прямоугольника: внутри ноль, снаружи по перпендикуляру и диагонали", () => {
    const rect = { x: 100, y: 100, w: 50, h: 40 };
    expect(distanceToZone({ x: 125, y: 120 }, rect)).toBe(0);
    expect(distanceToZone({ x: 90, y: 120 }, rect)).toBe(10); // слева
    expect(distanceToZone({ x: 160, y: 120 }, rect)).toBe(10); // справа
    expect(distanceToZone({ x: 125, y: 150 }, rect)).toBe(10); // снизу
    expect(distanceToZone({ x: 97, y: 96 }, rect)).toBe(5); // угол, 3-4-5
  });

  it("загорается ровно ближайшая зона; дальше радиуса — никакая", () => {
    const zones = [
      { key: "a", rect: { x: 0, y: 0, w: 10, h: 10 } },
      { key: "b", rect: { x: 100, y: 0, w: 10, h: 10 } },
    ];
    expect(nearestZoneLight({ x: 30, y: 5 }, zones)?.key).toBe("a");
    expect(nearestZoneLight({ x: 90, y: 5 }, zones)?.key).toBe("b");
    expect(nearestZoneLight({ x: 5, y: 5 }, zones)).toEqual({ key: "a", strength: 1 });
    expect(nearestZoneLight({ x: 55, y: 300 }, zones)).toBeNull();
    expect(nearestZoneLight({ x: 5, y: 5 }, [])).toBeNull();
  });

  it("сила разгорания монотонно растёт по мере подхода", () => {
    let prev = 0;
    for (let d = PROXIMITY_RADIUS; d >= 0; d -= PROXIMITY_RADIUS / 8) {
      const s = proximityStrength(d);
      expect(s).toBeGreaterThanOrEqual(prev);
      prev = s;
    }
  });

  it("тач-подсказка тише полного наведения, но не выключена", () => {
    expect(TOUCH_REST_STRENGTH).toBeGreaterThan(0);
    expect(TOUCH_REST_STRENGTH).toBeLessThan(1);
  });
});

describe("область нажатия и координаты зон не изменились (тикет 50)", () => {
  it("прямоугольник хотспота — дословно rect зоны в долях кадра, без выноса", () => {
    // Вынос (bleed) и маска живут на ВИЗУАЛЬНЫХ слоях; коробка нажатия обязана
    // считаться только из rooms.json. Числа пересчитаны руками от rect
    // cream/fashion {134, 91, 83, 191} и кадра 630×351.
    const zone = must(
      cream.zones.find((z) => z.key === "fashion"),
      "зона cream/fashion",
    );
    expect(zone.rect).toEqual({ x: 134, y: 91, w: 83, h: 191 });
    expect(zoneFramePercent(zone.rect)).toEqual({
      left: 21.2698,
      top: 25.9259,
      width: 13.1746,
      height: 54.416,
    });
  });
});
