// Фикстуры шести РФ-магазинов (решение гриллинга №1): на каждой должны
// извлекаться title + price + image; каскад JSON-LD → OG → эвристики
// покрыт разными площадками (WB и ЗЯ — без JSON-LD, DNS — чистые эвристики).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHtml } from "../../src/server/parser";

const FIXTURES_DIR = resolve(__dirname, "../../src/server/parser/__fixtures__");
const load = (name: string) => readFileSync(resolve(FIXTURES_DIR, name), "utf8");

const CASES = [
  {
    shop: "Ozon (JSON-LD)",
    fixture: "ozon.html",
    url: "https://www.ozon.ru/product/smartfon-samsung-galaxy-s24-8-256-gb-grafitovyy-1466100001/?utm_source=share&utm_medium=link",
    title: "Смартфон Samsung Galaxy S24 8/256 ГБ графитовый",
    price: "74990",
    currency: "RUB",
    image: "https://cdn1.ozone.ru/s3/multimedia-1-w/7044991234.jpg",
    zone: "tech",
    confidence: 0.9,
    domain: "ozon.ru",
    canonicalUrl:
      "https://www.ozon.ru/product/smartfon-samsung-galaxy-s24-8-256-gb-grafitovyy-1466100001/",
  },
  {
    shop: "Wildberries (только OG)",
    fixture: "wildberries.html",
    url: "https://www.wildberries.ru/catalog/166222333/detail.aspx",
    title: "Платье женское вечернее миди с разрезом",
    price: "2690",
    currency: "RUB",
    image: "https://basket-10.wbbasket.ru/vol1662/part166222/166222333/images/big/1.webp",
    zone: "fashion",
    confidence: 0.7,
    domain: "wildberries.ru",
    canonicalUrl: "https://www.wildberries.ru/catalog/166222333/detail.aspx",
  },
  {
    shop: "Яндекс Маркет (JSON-LD @graph, цена числом)",
    fixture: "yandex-market.html",
    url: "https://market.yandex.ru/product--trevozhnye-liudi/998877665",
    title: "Тревожные люди. Бакман Фредрик",
    price: "1265",
    currency: "RUB",
    image: "https://avatars.mds.yandex.net/get-mpic/5235334/img_id5678901234.jpeg/orig",
    zone: "books",
    confidence: 0.9,
    domain: "market.yandex.ru",
    canonicalUrl: "https://market.yandex.ru/product--trevozhnye-liudi/998877665",
  },
  {
    shop: "Lamoda (JSON-LD массив + PriceSpecification)",
    fixture: "lamoda.html",
    url: "https://www.lamoda.ru/p/mp002xw1g7o5/clothes-befree-kurtka-uteplennaia/",
    title: "Куртка утепленная Befree",
    price: "12499.00",
    currency: "RUB",
    image: "https://a.lmcdn.ru/img600x866/M/P/MP002XW1G7O5_22861704_1_v1.jpg",
    zone: "fashion",
    confidence: 0.9,
    domain: "lamoda.ru",
    canonicalUrl: "https://www.lamoda.ru/p/mp002xw1g7o5/clothes-befree-kurtka-uteplennaia/",
  },
  {
    shop: "Золотое Яблоко (OG без цены + ₽ в вёрстке)",
    fixture: "goldapple.html",
    url: "https://goldapple.ru/19760012345-oud-wood",
    title: "TOM FORD Oud Wood, парфюмерная вода",
    price: "14950",
    currency: "RUB",
    image: "https://pcdn.goldapple.ru/p/p/19760012345/web/696d6f31.jpg",
    zone: "perfume",
    confidence: 0.5,
    domain: "goldapple.ru",
    canonicalUrl: "https://goldapple.ru/19760012345-oud-wood",
  },
  {
    shop: "DNS (битый JSON-LD → чистые эвристики)",
    fixture: "dns-shop.html",
    url: "https://www.dns-shop.ru/product/8b2ed58622a1ed20/besprovodnye-naushniki-sony-wh-1000xm5-chernyy/",
    title: "Наушники беспроводные Sony WH-1000XM5 черный",
    price: "29999",
    currency: "RUB",
    image: "https://www.dns-shop.ru/thumb/st4/fit/500/500/e0deca6a49b0/wh1000xm5-black.jpg",
    zone: "tech",
    confidence: 0.5,
    domain: "dns-shop.ru",
    canonicalUrl:
      "https://www.dns-shop.ru/product/8b2ed58622a1ed20/besprovodnye-naushniki-sony-wh-1000xm5-chernyy/",
  },
] as const;

describe("parseHtml на фикстурах РФ-магазинов", () => {
  for (const kase of CASES) {
    describe(kase.shop, () => {
      const product = parseHtml(load(kase.fixture), kase.url);

      it("title + price + image извлечены (acceptance тикета)", () => {
        expect(product.title).toBe(kase.title);
        expect(product.price).toBe(kase.price);
        expect(product.imageUrl).toBe(kase.image);
      });

      it("валюта ISO, цена — строка-Decimal", () => {
        expect(product.currency).toBe(kase.currency);
        expect(product.price).toMatch(/^\d+(\.\d+)?$/);
        expect(typeof product.price).toBe("string");
      });

      it("canonicalUrl нормализован, domain без www", () => {
        expect(product.canonicalUrl).toBe(kase.canonicalUrl);
        expect(product.domain).toBe(kase.domain);
        expect(product.canonicalUrl).not.toContain("utm");
      });

      it("подсказка зоны и confidence соответствуют источнику данных", () => {
        expect(product.zoneHint).toBe(kase.zone);
        expect(product.confidence).toBe(kase.confidence);
      });
    });
  }

  it("описание подтягивается, когда оно есть в разметке", () => {
    const ozon = parseHtml(load("ozon.html"), CASES[0].url);
    expect(ozon.description).toContain("Флагманский смартфон");
    const wb = parseHtml(load("wildberries.html"), CASES[1].url);
    expect(wb.description).toContain("вечернее платье");
  });

  it("страница без товарных данных → честная карточка с низким confidence", () => {
    const empty = parseHtml("<html><head></head><body>ничего</body></html>", "https://shop.ru/x");
    expect(empty.title).toBeUndefined();
    expect(empty.price).toBeUndefined();
    expect(empty.confidence).toBeLessThanOrEqual(0.1);
    expect(empty.domain).toBe("shop.ru");
  });
});
