// zoneHint: эвристика зоны по ключам zones.json — подсказка с confidence,
// не истина. Крошки сильнее URL, URL сильнее заголовка.

import { describe, expect, it } from "vitest";
import zonesJson from "../../design/package/handoff/zones.json";
import { zoneHintFor } from "../../src/server/parser/zoneHint";

describe("zoneHintFor", () => {
  it("возвращает только ключи из zones.json", () => {
    const keys = new Set(Object.keys((zonesJson as { keys: Record<string, unknown> }).keys));
    const samples = [
      { title: "Книга «Тревожные люди»" },
      { title: "Платье вечернее миди" },
      { title: "Парфюмерная вода Oud Wood" },
      { title: "Наушники Sony WH-1000XM5" },
      { title: "Кроссовки New Balance 574" },
      { title: "Букет пионов" },
    ];
    for (const sample of samples) {
      const hint = zoneHintFor(sample);
      expect(hint).not.toBeNull();
      expect(keys.has(hint!.zone)).toBe(true);
    }
  });

  it("примеры из тикета: книги/платье/куртка/парфюм/наушники/смартфон", () => {
    expect(zoneHintFor({ title: "Книга рецептов" })?.zone).toBe("books");
    expect(zoneHintFor({ title: "Платье летнее" })?.zone).toBe("fashion");
    expect(zoneHintFor({ title: "Куртка зимняя" })?.zone).toBe("fashion");
    expect(zoneHintFor({ title: "Парфюм с нотами сандала" })?.zone).toBe("perfume");
    expect(zoneHintFor({ title: "Аромат для дома? Нет, духи" })?.zone).toBe("perfume");
    expect(zoneHintFor({ title: "Наушники беспроводные" })?.zone).toBe("tech");
    expect(zoneHintFor({ title: "Смартфон Samsung" })?.zone).toBe("tech");
  });

  it("хлебные крошки весят больше заголовка", () => {
    const hint = zoneHintFor({
      title: "Тревожные люди", // стемов нет
      breadcrumbs: ["Книги", "Художественная литература"],
    });
    expect(hint?.zone).toBe("books");
    expect(hint?.confidence).toBeGreaterThanOrEqual(0.8);
  });

  it("путь URL распознаёт транслит", () => {
    expect(zoneHintFor({ url: "https://shop.ru/catalog/knigi/12345" })?.zone).toBe("books");
    expect(
      zoneHintFor({ url: "https://www.lamoda.ru/p/x/clothes-befree-kurtka-uteplennaia/" })?.zone,
    ).toBe("fashion");
    expect(zoneHintFor({ url: "https://shop.ru/smartfony/galaxy-s24" })?.zone).toBe("tech");
  });

  it("совпадение из нескольких источников усиливает confidence", () => {
    const single = zoneHintFor({ title: "Куртка утепленная" });
    const combined = zoneHintFor({
      title: "Куртка утепленная",
      url: "https://shop.ru/odezhda/kurtki/1",
      breadcrumbs: ["Одежда"],
    });
    expect(single?.zone).toBe("fashion");
    expect(combined?.zone).toBe("fashion");
    expect(combined!.confidence).toBeGreaterThan(single!.confidence);
  });

  it("обувь и рюкзаки — зона sneakers, а не sport", () => {
    expect(zoneHintFor({ title: "Кроссовки для бега" })?.zone).toBe("sneakers");
    expect(zoneHintFor({ title: "Рюкзак городской" })?.zone).toBe("sneakers");
  });

  it("нет сигнала → null, зону не выдумываем", () => {
    expect(zoneHintFor({ title: "Просто что-то" })).toBeNull();
    expect(zoneHintFor({})).toBeNull();
    expect(zoneHintFor({ url: "не-url" })).toBeNull();
  });

  it("ложные друзья не срабатывают: кедр, йогурт, пионер", () => {
    expect(zoneHintFor({ title: "Кедр сибирский, саженец" })).toBeNull();
    expect(zoneHintFor({ title: "Йогурт греческий" })).toBeNull();
    expect(zoneHintFor({ title: "Значок пионера" })).toBeNull();
  });
});
