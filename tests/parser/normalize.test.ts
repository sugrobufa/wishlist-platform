// normalize: канонический вид URL (ключ кэша и дедупликации по спеке)
// и разворот коротких ссылок через safeFetch с моками сети.

import { describe, expect, it } from "vitest";
import {
  domainOf,
  expandUrl,
  isRussianTld,
  isShortUrl,
  normalizeUrl,
} from "../../src/server/parser/normalize";
import { ParserError } from "../../src/server/parser/types";
import { fakeFetch, publicLookup } from "./testUtils";

describe("normalizeUrl", () => {
  it("вычищает трекинг: utm_*, ref, refRID, spm, _openstat, yclid, fbclid, gclid", () => {
    expect(
      normalizeUrl(
        "https://www.ozon.ru/product/tovar-123/?utm_source=share&utm_medium=link&ref=abc&refRID=X1&spm=a2g0o&_openstat=ZGlyZWN0&yclid=111&fbclid=222&gclid=333",
      ),
    ).toBe("https://www.ozon.ru/product/tovar-123/");
  });

  it("сохраняет значимые параметры и сортирует их для стабильного ключа", () => {
    expect(normalizeUrl("https://shop.ru/item?size=42&color=red&utm_campaign=x")).toBe(
      "https://shop.ru/item?color=red&size=42",
    );
  });

  it("добавляет https без схемы и поднимает http", () => {
    expect(normalizeUrl("ozon.ru/product/1")).toBe("https://ozon.ru/product/1");
    expect(normalizeUrl("http://ozon.ru/product/1")).toBe("https://ozon.ru/product/1");
  });

  it("хост в нижний регистр, без завершающей точки, fragment отбрасывается", () => {
    expect(normalizeUrl("https://WWW.Lamoda.RU./p/abc/#reviews")).toBe(
      "https://www.lamoda.ru/p/abc/",
    );
  });

  it("явный дефолтный порт убирается", () => {
    expect(normalizeUrl("http://shop.ru:80/a")).toBe("https://shop.ru/a");
    expect(normalizeUrl("https://shop.ru:443/a")).toBe("https://shop.ru/a");
  });

  it("кириллический домен уходит в punycode", () => {
    expect(normalizeUrl("https://магазин.рф/товар")).toContain("xn--");
  });

  it("мусор и не-http(s) схемы → ParserError(invalid-url)", () => {
    for (const bad of ["", "   ", "не ссылка вообще", "ftp://files.ru/x", "mailto:a@b.ru"]) {
      expect(() => normalizeUrl(bad)).toThrowError(ParserError);
    }
  });
});

describe("domainOf / isRussianTld / isShortUrl", () => {
  it("domainOf срезает www", () => {
    expect(domainOf("https://www.dns-shop.ru/product/1")).toBe("dns-shop.ru");
    expect(domainOf("https://goldapple.ru/123")).toBe("goldapple.ru");
  });

  it("isRussianTld: .ru и .рф (punycode)", () => {
    expect(isRussianTld("ozon.ru")).toBe(true);
    expect(isRussianTld(domainOf(normalizeUrl("https://золотоеяблоко.рф/x")))).toBe(true);
    expect(isRussianTld("amazon.com")).toBe(false);
  });

  it("isShortUrl узнаёт известные сокращатели", () => {
    expect(isShortUrl("https://clck.ru/3AbCdE")).toBe(true);
    expect(isShortUrl("https://vk.cc/xyz")).toBe(true);
    expect(isShortUrl("https://www.wildberries.ru/catalog/1/detail.aspx")).toBe(false);
  });
});

describe("expandUrl", () => {
  it("разворачивает короткую ссылку HEAD-запросом и нормализует результат", async () => {
    const { impl, calls } = fakeFetch({
      "https://clck.ru/3AbCdE": {
        status: 301,
        headers: { location: "https://www.ozon.ru/product/tovar-1/?utm_source=clck" },
      },
      "https://www.ozon.ru/product/tovar-1/?utm_source=clck": {
        contentType: "text/html",
        body: "",
      },
    });
    const result = await expandUrl("https://clck.ru/3AbCdE", {
      fetchImpl: impl,
      lookupImpl: publicLookup,
    });
    expect(result.url).toBe("https://www.ozon.ru/product/tovar-1/");
    expect(result.redirectsUsed).toBe(1);
    expect(calls.every((call) => call.method === "HEAD")).toBe(true);
  });

  it("при 405 на HEAD пробует GET", async () => {
    const { impl, calls } = fakeFetch({
      "https://clck.ru/NoHead": { status: 405 },
    });
    // GET по тому же URL вернёт 405 и body null → ok:false, но URL финальный
    const result = await expandUrl("https://clck.ru/NoHead", {
      fetchImpl: impl,
      lookupImpl: publicLookup,
    });
    expect(result.url).toBe("https://clck.ru/NoHead");
    expect(calls.map((call) => call.method)).toEqual(["HEAD", "GET"]);
  });

  it("редирект короткой ссылки в приватный адрес — ошибка, а не запрос", async () => {
    const { impl, calls } = fakeFetch({
      "https://clck.ru/Evil": {
        status: 302,
        headers: { location: "http://192.168.1.1/admin" },
      },
    });
    await expect(
      expandUrl("https://clck.ru/Evil", { fetchImpl: impl, lookupImpl: publicLookup }),
    ).rejects.toMatchObject({ code: "blocked-host" });
    expect(calls).toHaveLength(1);
  });
});
