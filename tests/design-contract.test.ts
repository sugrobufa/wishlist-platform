import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { rooms, roomsContract } from "../src/config/design";

// Контракт дизайн-пакета: эти числа зафиксированы в handoff/README.md.
// Если тест упал — кто-то тронул rooms.json или изображения. Это баг процесса,
// а не повод поправить ожидания.
describe("design handoff contract", () => {
  it("10 комнат", () => {
    expect(rooms).toHaveLength(10);
  });

  it("84 зоны суммарно", () => {
    const total = rooms.reduce((n, room) => n + room.zones.length, 0);
    expect(total).toBe(84);
  });

  it("каждая зона лежит в границах телефонной сцены 430×352", () => {
    const { w, h } = roomsContract.scene.phone;
    for (const room of rooms) {
      for (const zone of room.zones) {
        expect(zone.rect.x, `${room.id}/${zone.key} x`).toBeGreaterThanOrEqual(0);
        expect(zone.rect.y, `${room.id}/${zone.key} y`).toBeGreaterThanOrEqual(0);
        expect(zone.rect.x + zone.rect.w, `${room.id}/${zone.key} правый край`).toBeLessThanOrEqual(
          w,
        );
        expect(zone.rect.y + zone.rect.h, `${room.id}/${zone.key} нижний край`).toBeLessThanOrEqual(
          h,
        );
      }
    }
  });

  it("кадры комнат и кадры «открыто» существуют в design/package", () => {
    const pkg = resolve(__dirname, "../design/package");
    for (const room of rooms) {
      expect(existsSync(resolve(pkg, room.base)), room.base).toBe(true);
      for (const zone of room.zones) {
        if (zone.openFrame) {
          expect(existsSync(resolve(pkg, zone.openFrame)), zone.openFrame).toBe(true);
        }
      }
    }
  });

  it("tokens.css сгенерирован из tokens.json и содержит базовые токены", () => {
    const css = readFileSync(resolve(__dirname, "../src/styles/tokens.css"), "utf8");
    expect(css).toContain("--color-surface-app-ground");
    expect(css).toContain("--color-text-primary");
    expect(css).toContain("--font-display");
  });
});
