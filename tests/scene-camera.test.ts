import { describe, it, expect } from "vitest";
import { cameraScale, rooms, roomsContract, sceneMotion } from "../src/config/design";
import {
  computeZoneCamera,
  frameCoversViewport,
  round4,
} from "../src/components/scene/camera";
import { visibleZones } from "../src/components/scene/zones";

// Сцена (тикет 02): наезд камеры считается формулой motion.json → openZone[0]
// из прямоугольников rooms.json — руками не задаётся. Если тест упал, кто-то
// тронул формулу или контракт; это баг процесса, а не повод поправить числа.

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`не найдено: ${what}`);
  return value;
}

const cream = must(
  rooms.find((room) => room.id === "cream"),
  "комната cream",
);
const fashion = must(
  cream.zones.find((zone) => zone.key === "fashion"),
  "зона cream/fashion",
);

describe("наезд камеры (формула motion.json → openZone[0])", () => {
  it("cream/fashion, телефон: transform совпадает с формулой", () => {
    const { w: sw, h: sh } = roomsContract.scene.phone;
    const scale = cameraScale.phone;
    const r = fashion.rect;
    const dx = (((sw / 2 - (r.x + r.w / 2)) / sw) * 100) / scale;
    const dy = (((sh / 2 - (r.y + r.h / 2)) / sh) * 100) / scale;

    const cam = computeZoneCamera(r, "phone");
    expect(cam.scale).toBe(scale);
    expect(cam.dx).toBeCloseTo(dx, 10);
    expect(cam.dy).toBeCloseTo(dy, 10);
    expect(cam.transform).toBe(`scale(${scale}) translate(${round4(dx)}%, ${round4(dy)}%)`);
  });

  it("десктоп: тот же расчёт через фактор 1.7778, без отдельной карты", () => {
    const f = roomsContract.scene.desktop.factorFromPhone;
    const { w: sw, h: sh } = roomsContract.scene.desktop;
    const scale = cameraScale.desktop;
    const imageShift = Math.abs(roomsContract.scene.phone.image.x); // 12

    const r = fashion.rect;
    const x = (r.x + imageShift) * f;
    const y = r.y * f;
    const w = r.w * f;
    const h = r.h * f;
    const dx = (((sw / 2 - (x + w / 2)) / sw) * 100) / scale;
    const dy = (((sh / 2 - (y + h / 2)) / sh) * 100) / scale;

    const cam = computeZoneCamera(r, "desktop");
    expect(cam.scale).toBe(scale);
    expect(cam.dx).toBeCloseTo(dx, 10);
    expect(cam.dy).toBeCloseTo(dy, 10);
    expect(cam.transform).toBe(`scale(${scale}) translate(${round4(dx)}%, ${round4(dy)}%)`);
  });

  it("экранный сдвиг никогда не превышает полкадра (обе платформы, все 84 зоны)", () => {
    // translate стоит внутри scale() → экранный сдвиг = dx·scale. Формула
    // центрирует центр зоны, а он всегда внутри сцены — сдвиг < 50%.
    for (const room of rooms) {
      for (const zone of room.zones) {
        for (const view of ["phone", "desktop"] as const) {
          const cam = computeZoneCamera(zone.rect, view);
          expect(
            Math.abs(cam.dx * cam.scale),
            `${room.id}/${zone.key} ${view} dx`,
          ).toBeLessThanOrEqual(50);
          expect(
            Math.abs(cam.dy * cam.scale),
            `${room.id}/${zone.key} ${view} dy`,
          ).toBeLessThanOrEqual(50);
        }
      }
    }
  });

  it("краевые зоны (x=0) не выносят кадр за пределы телефонной сцены", () => {
    const edgeZones = rooms.flatMap((room) =>
      room.zones.filter((zone) => zone.rect.x === 0).map((zone) => ({ room: room.id, zone })),
    );
    expect(edgeZones.length).toBeGreaterThan(0);
    for (const { room, zone } of edgeZones) {
      expect(frameCoversViewport(zone.rect, "phone"), `${room}/${zone.key}`).toBe(true);
    }
  });

  it("телефон: кадр накрывает вьюпорт после наезда для всех 84 зон", () => {
    // Гарантия держится на слое дрейфа под камерой (scale ≥ 1.10 из
    // motion.json → ambient.drift.amplitude) — он и распарсен в sceneMotion.
    for (const room of rooms) {
      for (const zone of room.zones) {
        expect(frameCoversViewport(zone.rect, "phone"), `${room.id}/${zone.key}`).toBe(true);
      }
    }
  });

  it("партитура распарсена из motion.json (дрейф, покой камеры, reduced motion)", () => {
    expect(sceneMotion.drift.translatePct).toBeCloseTo(1.1, 10);
    expect(sceneMotion.drift.scaleFrom).toBeCloseTo(1.1, 10);
    expect(sceneMotion.drift.scaleTo).toBeCloseTo(1.13, 10);
    expect(sceneMotion.camera.restTransform).toBe("scale(1.02)");
    expect(sceneMotion.reducedTransitionMs).toBe(120);
  });
});

describe("выключенные зоны (Room.zonesOff)", () => {
  it("зона из zonesOff не попадает в список рендера", () => {
    const visible = visibleZones(cream.zones, ["perfume", "bags"]);
    const keys = visible.map((zone) => zone.key);
    expect(keys).not.toContain("perfume");
    expect(keys).not.toContain("bags");
    expect(visible).toHaveLength(cream.zones.length - 2);
  });

  it("без zonesOff список полный и порядок сохранён", () => {
    const all = cream.zones.map((zone) => zone.key);
    expect(visibleZones(cream.zones, []).map((zone) => zone.key)).toEqual(all);
    expect(visibleZones(cream.zones, undefined).map((zone) => zone.key)).toEqual(all);
  });

  it("неизвестный ключ в zonesOff игнорируется, исходный массив не мутируется", () => {
    const before = [...cream.zones];
    const visible = visibleZones(cream.zones, ["no-such-zone"]);
    expect(visible).toHaveLength(cream.zones.length);
    expect(cream.zones).toEqual(before);
  });
});
