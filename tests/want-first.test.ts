// ПЕРЕПИСАН ЦЕЛИКОМ ТИКЕТОМ 124.
//
// Файл защищал правило тикета 78: «Хочу» первым и по умолчанию — во вкладках
// зоны и в фильтре списка комнаты. Довод был продуктовый: площадка про
// подарки, и открывать зону витриной «Люблю» значило показывать первым делом
// то, что подарить нельзя.
//
// Правило растворилось вместе с состояниями. Владелец 09.08.2026: «убираем
// полностью концепцию хочу и люблю». Ставить «Хочу» первым больше негде — в
// комнате ВСЁ есть желание, делить сетку и список нечем. Но само требование
// никуда не делось, оно просто стало сильнее: не «хочу первым», а «выбора
// между состояниями нет вовсе». Именно это здесь и сторожим — чтобы вкладки
// и чипы не вернулись молча следующей правкой.
//
// Тест смотрит на ИСХОДНИКИ, а не рендерит компоненты: и вкладки, и чипы были
// видны в коде однозначно — их отсутствие видно так же.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const zoneGrid = read("../src/components/zone/ZoneGrid.tsx");
const roomList = read("../src/components/room-list/room-list-view.tsx");
const ownerGrid = read("../src/app/room/zone/[zone]/owner-zone-grid.tsx");

describe("сетка зоны: вкладок «Хочу/Люблю» больше нет", () => {
  it("массива вкладок и переключателя вкладки не существует", () => {
    expect(zoneGrid).not.toMatch(/key: "(LOVE|WANT)"/u);
    expect(zoneGrid).not.toContain('role="tablist"');
    expect(zoneGrid).not.toContain('role="tab"');
    expect(zoneGrid).not.toContain("setTab");
  });

  it("сетка показывает ВСЕ пришедшие вещи одним списком", () => {
    // Единственный источник того, что рисуется, — сами `items`: никакого
    // отбора по состоянию между входом и разметкой не осталось.
    expect(zoneGrid).toContain("const shown = items;");
  });
});

describe("список комнаты: чипов состояния больше нет", () => {
  it("ряд «Хочу · Люблю · Все» снят, тип Filter не существует", () => {
    expect(roomList).not.toMatch(/type Filter/u);
    expect(roomList).not.toMatch(/\["(all|want|love)", t\(/u);
    expect(roomList).not.toContain("setFilter");
  });

  it("«Только свободные» остался — он про брони, а не про состояния", () => {
    expect(roomList).toContain("freeOnly");
    expect(roomList).toMatch(/items\.filter\(\(item\) => !takenIds\.has\(item\.id\)\)/u);
  });
});

describe("ни один экран не спрашивает у вещи состояние", () => {
  it("в сетке, списке и зоне хозяйки нет обращений к item.state", () => {
    for (const [name, source] of [
      ["ZoneGrid", zoneGrid],
      ["room-list-view", roomList],
      ["owner-zone-grid", ownerGrid],
    ] as const) {
      expect(source, `${name}: обращение к item.state`).not.toMatch(/item\.state/u);
    }
  });
});
