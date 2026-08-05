import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { rooms, roomsContract, zoneInfo, zoneKeysWithoutCatalogEntry } from "../src/config/design";

// Контракт дизайн-пакета: эти числа зафиксированы в handoff/README.md.
// Если тест упал — кто-то тронул rooms.json или изображения. Это баг процесса,
// а не повод поправить ожидания.
//
// Раунд 2 (2026-08-05): карта зон достроена с 84 до 130 — по 12 зон + деньги
// на комнату. Проверяем СЫРОЙ контракт (roomsContract.rooms, все 130), а не
// то, что рендерит продукт: продукт зону `money` прячет, потому что её нет в
// справочнике zones.json (см. блок «дырка money» ниже и ADR-0003).
const contractRooms = roomsContract.rooms;

/** Все зоны контракта с адресом вида "cream/fashion" — для внятных падений. */
const allZones = contractRooms.flatMap((room) =>
  room.zones.map((zone) => ({ id: `${room.id}/${zone.key}`, room, zone })),
);

describe("design handoff contract", () => {
  it("10 комнат", () => {
    expect(contractRooms).toHaveLength(10);
  });

  it("130 зон суммарно, по 13 в каждой комнате", () => {
    const total = contractRooms.reduce((n, room) => n + room.zones.length, 0);
    expect(total).toBe(130);
    for (const room of contractRooms) {
      expect(room.zones.length, `${room.id}: 12 зон набора + деньги`).toBe(13);
    }
  });

  it("ключи зон внутри комнаты не повторяются", () => {
    for (const room of contractRooms) {
      const keys = room.zones.map((zone) => zone.key);
      expect(new Set(keys).size, `${room.id}: ${keys.join(",")}`).toBe(keys.length);
    }
  });

  it("у каждой комнаты есть roomLightness в диапазоне 0…1", () => {
    for (const room of contractRooms) {
      expect(typeof room.roomLightness, `${room.id}`).toBe("number");
      expect(room.roomLightness, `${room.id}`).toBeGreaterThanOrEqual(0);
      expect(room.roomLightness, `${room.id}`).toBeLessThanOrEqual(1);
    }
  });

  it("у каждой зоны есть bloomAR (30…120) и bloomRot", () => {
    for (const { id, zone } of allZones) {
      expect(typeof zone.bloomAR, `${id} bloomAR`).toBe("number");
      expect(zone.bloomAR, `${id} bloomAR`).toBeGreaterThanOrEqual(30);
      expect(zone.bloomAR, `${id} bloomAR`).toBeLessThanOrEqual(120);
      expect(typeof zone.bloomRot, `${id} bloomRot`).toBe("number");
      expect(Number.isFinite(zone.bloomRot), `${id} bloomRot`).toBe(true);
    }
  });

  it("bloomAR выведен из w/h по формуле пакета (AR = w/h · 58, зажим 30…120)", () => {
    // tokens.json → zoneMarker.bloom.ellipseAspect.default. Форма светового
    // пятна не размечается руками — она считается из прямоугольника, поэтому
    // расхождение значит, что кто-то правил числа мимо скрипта дизайна.
    for (const { id, zone } of allZones) {
      const expected = Math.min(120, Math.max(30, Math.round((zone.rect.w / zone.rect.h) * 58)));
      expect(zone.bloomAR, `${id}`).toBe(expected);
    }
  });

  it("каждая зона лежит в границах телефонной сцены 430×352", () => {
    const { w, h } = roomsContract.scene.phone;
    for (const { id, zone } of allZones) {
      expect(zone.rect.x, `${id} x`).toBeGreaterThanOrEqual(0);
      expect(zone.rect.y, `${id} y`).toBeGreaterThanOrEqual(0);
      expect(zone.rect.w, `${id} w`).toBeGreaterThan(0);
      expect(zone.rect.h, `${id} h`).toBeGreaterThan(0);
      expect(zone.rect.x + zone.rect.w, `${id} правый край`).toBeLessThanOrEqual(w);
      expect(zone.rect.y + zone.rect.h, `${id} нижний край`).toBeLessThanOrEqual(h);
    }
  });

  it("кадры комнат и кадры «открыто» существуют в design/package", () => {
    const pkg = resolve(__dirname, "../design/package");
    for (const room of contractRooms) {
      expect(existsSync(resolve(pkg, room.base)), room.base).toBe(true);
      for (const zone of room.zones) {
        if (zone.openFrame) {
          expect(existsSync(resolve(pkg, zone.openFrame)), zone.openFrame).toBe(true);
        }
      }
    }
    // Раскрытие требует отдельной съёмки — кадров по-прежнему 30, по три на комнату.
    const withFrame = allZones.filter(({ zone }) => zone.openFrame);
    expect(withFrame).toHaveLength(30);
  });

  it("tokens.css сгенерирован из tokens.json и содержит базовые токены", () => {
    const css = readFileSync(resolve(__dirname, "../src/styles/tokens.css"), "utf8");
    expect(css).toContain("--color-surface-app-ground");
    expect(css).toContain("--color-text-primary");
    expect(css).toContain("--font-display");
    // Раунд 2: блоки, на которые опираются тикеты 23 (метки), 24 (раскладка), 27 (выбор).
    expect(css).toContain("--zone-bloom-rest");
    expect(css).toContain("--zone-vignette-weight");
    expect(css).toContain("--imm-top-veil");
    expect(css).toContain("--state-choice-ar");
  });
});

// ---------------------------------------------------------------------------
// Дырка `money`: зона есть во всех 10 комнатах, записи в zones.json нет.
// Продукт её не показывает (решение — ADR-0003). Контракт при этом не тронут:
// допишут ключ в zones.json — зона появится сама, без правок кода.
// ---------------------------------------------------------------------------
describe("справочник зон (zones.json)", () => {
  it("все ключи зон есть в справочнике — кроме известной дырки money", () => {
    const missing = [...new Set(allZones.filter(({ zone }) => !zoneInfo(zone.key)).map(({ zone }) => zone.key))];
    expect(missing.sort()).toEqual(["money"]);
    expect(zoneKeysWithoutCatalogEntry).toEqual(["money"]);
  });

  it("зона money есть в каждой комнате контракта и ни в одной — в рендере", () => {
    for (const room of contractRooms) {
      expect(room.zones.some((zone) => zone.key === "money"), `${room.id}`).toBe(true);
    }
    for (const room of rooms) {
      expect(room.zones.some((zone) => zone.key === "money"), `${room.id}`).toBe(false);
      expect(room.zones).toHaveLength(12);
    }
    expect(rooms.reduce((n, room) => n + room.zones.length, 0)).toBe(120);
  });

  it("у зоны money свой пул, кадра «открыто» нет — призраков не будет, и это норма", () => {
    // Не выдумываем содержимое пула money: это вопрос к дизайну. Проверяем лишь,
    // что мягкий фолбэк demo-pools отрабатывает молча (тест пула — items.demo).
    for (const room of contractRooms) {
      const money = room.zones.find((zone) => zone.key === "money");
      expect(money?.pool, `${room.id}`).toBe("money");
      expect(money?.openFrame ?? null, `${room.id}`).toBeNull();
      expect(money?.openVerb ?? null, `${room.id}`).toBeNull();
    }
  });
});

// ---------------------------------------------------------------------------
// Пересечения прямоугольников. README пакета утверждает «пересечений ноль —
// проверено попарно по всем 130». Это не так: 14 пар налезают друг на друга.
// Ниже — реестр долга, а не разрешение: список зафиксирован, чтобы новые
// пересечения падали, а исправленные заставляли список укоротить.
// Разбор и передача дизайну — тикет 26 (сверка зон с кадрами).
// ---------------------------------------------------------------------------
describe("пересечения прямоугольников зон", () => {
  /** Попарное пересечение зон одной комнаты: адрес и площадь наложения в px². */
  function overlapsIn(room: (typeof contractRooms)[number]): { id: string; area: number }[] {
    const found: { id: string; area: number }[] = [];
    for (const [i, first] of room.zones.entries()) {
      for (const second of room.zones.slice(i + 1)) {
        const a = first.rect;
        const b = second.rect;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 0 && oy > 0) {
          found.push({ id: `${room.id}/${first.key}×${second.key}`, area: ox * oy });
        }
      }
    }
    return found;
  }

  const overlaps = contractRooms.flatMap(overlapsIn);

  it("пересекаются ровно известные 14 пар и ни одной сверх того", () => {
    expect(overlaps.map((o) => o.id).sort()).toEqual(
      [
        "bold/flowers×money",
        "cottage/events×books",
        "cottage/music×flowers",
        "cottage/music×travel",
        "emerald/books×flowers",
        "emerald/events×books",
        "emerald/music×money",
        "gamer/events×music",
        "loft/events×watches",
        "loft/music×grooming",
        "loft/tech×grooming",
        "lux/events×flowers",
        "sport/anything×sport",
        "sport/grooming×gaming",
      ].sort(),
    );
  });

  it("ни одно пересечение не крупнее 600 px² — клик уводит в чужую зону не больше, чем на кромке", () => {
    // Худшие: sport/anything×sport 592 px² и lux/events×flowers 497 px² —
    // узкие вертикальные полосы, а не наложенные друг на друга зоны.
    for (const { id, area } of overlaps) {
      expect(area, id).toBeLessThanOrEqual(600);
    }
  });

  it("в рендере (без money) пересечений на две меньше", () => {
    const rendered = rooms.flatMap(overlapsIn);
    expect(rendered).toHaveLength(12);
    expect(rendered.some(({ id }) => id.includes("money"))).toBe(false);
  });
});
