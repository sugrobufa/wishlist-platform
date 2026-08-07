// «Хочу» первым и по умолчанию (тикет 78, приёмка 07.08).
//
// Правило продуктовое, а не косметическое: площадка про подарки. Гость пришёл
// выбрать, что подарить; хозяйка завела комнату, чтобы её желания увидели.
// «Люблю» — витрина, она ничего не запускает, и открывать зону ею значило
// показывать первым делом то, что подарить нельзя.
//
// Тест смотрит на ИСХОДНИКИ, а не рендерит компоненты: обе точки — это
// начальное состояние `useState` и порядок массива вкладок, и оба видны в
// коде однозначно. Так правило не откатится молча при следующей правке.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const zoneGrid = read("../src/components/zone/ZoneGrid.tsx");
const roomList = read("../src/components/room-list/room-list-view.tsx");

describe("вкладки зоны", () => {
  it("«Хочу» стоит первым в массиве вкладок", () => {
    const order = [...zoneGrid.matchAll(/\{ key: "(LOVE|WANT)", label:/gu)].map((m) => m[1]);
    expect(order).toEqual(["WANT", "LOVE"]);
  });

  it("дефолт — «Хочу»; на «Люблю» падаем только когда «хочу» пусто, а «люблю» нет", () => {
    // Формула записана в одну строку, и её проверяем целиком: любая правка
    // порядка условий меняет смысл (например, `love.length > 0` первым снова
    // открывал бы витрину).
    expect(zoneGrid).toContain('want.length === 0 && love.length > 0 ? "LOVE" : "WANT"');
  });

  it("когда пусты обе вкладки, открыта «Хочу»", () => {
    // Проверяем саму формулу на всех четырёх сочетаниях — так понятнее, чем
    // читать тернарник глазами.
    const pick = (want: number, love: number) => (want === 0 && love > 0 ? "LOVE" : "WANT");
    expect(pick(0, 0)).toBe("WANT");
    expect(pick(3, 0)).toBe("WANT");
    expect(pick(3, 2)).toBe("WANT");
    expect(pick(0, 2)).toBe("LOVE");
  });
});

describe("фильтр экрана «вся комната списком»", () => {
  it("дефолт — «Хочу», а не «Все»", () => {
    expect(roomList).toContain('useState<Filter>("want")');
  });

  it("«Хочу» первым в списке положений", () => {
    const order = [...roomList.matchAll(/\["(all|want|love)", t\(/gu)].map((m) => m[1]);
    expect(order).toEqual(["want", "love", "all"]);
  });
});
