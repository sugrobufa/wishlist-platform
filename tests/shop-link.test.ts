// Ссылка наружу (тикет 37) — единственное место в продукте, откуда человек
// уходит на чужой сайт. Проверяется исходником, а не рендером: React в
// vitest здесь не поднимается (testing-library в зависимости не тащим), а
// требование простое и текстовое — атрибуты якоря.
//
// Зачем тест вообще: `rel="noopener noreferrer"` — не косметика. Без noopener
// чужая страница получает `window.opener` и может увести вкладку с комнатой
// куда угодно; без noreferrer магазин узнаёт адрес комнаты, то есть чужую
// share-ссылку (инвариант №7: комната живёт по ссылке и не индексируется).
// Инвариант №6 требует того же от любого чужого URL.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(__dirname, "../src/components/zone/shop-link.tsx"), "utf8");

describe("ShopLink — якорь наружу", () => {
  it("ровно один якорь на весь продукт: второй пришлось бы защищать заново", () => {
    expect(source.match(/<a[\s>]/g) ?? []).toHaveLength(1);
  });

  it('rel="noopener noreferrer" и target="_blank"', () => {
    expect(source).toContain('rel="noopener noreferrer"');
    expect(source).toContain('target="_blank"');
  });

  it("адрес приходит пропом, а не собирается из кусков внутри", () => {
    // href={url} и ничего больше: любая склейка здесь — место, где в чужой
    // адрес однажды попадёт наш (реферер уже отрезан, но собирать нечего).
    expect(source).toContain("href={url}");
  });
});
