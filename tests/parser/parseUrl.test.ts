// parseUrl — конвейер целиком: normalize → кэш → rate limit → safeFetch →
// fastPath → кэш. Сеть и Redis — фейки; проверяем и деградацию (user story 9:
// парсинг не справился → честная карточка, вещь всё равно сохраняется).

import { describe, expect, it } from "vitest";
import { ParserCache } from "../../src/server/parser/cache";
import { parseUrl, ParserError } from "../../src/server/parser";
import { FakeRedis } from "./fakeRedis";
import { fakeFetch, publicLookup } from "./testUtils";

const PRODUCT_HTML = `<!DOCTYPE html><html lang="ru"><head>
<title>Тестовый товар — купить</title>
<script type="application/ld+json">
{"@context":"https://schema.org","@type":"Product","name":"Тестовый товар",
"image":"https://cdn.shop.example/1.jpg",
"offers":{"@type":"Offer","price":"1990","priceCurrency":"RUB"}}
</script>
</head><body><h1>Тестовый товар</h1></body></html>`;

function makeCache(redis = new FakeRedis()) {
  return { redis, cache: new ParserCache({ redis }) };
}

describe("parseUrl: конвейер", () => {
  it("нормализует вход, парсит страницу и кэширует результат", async () => {
    const { redis, cache } = makeCache();
    const { impl, calls } = fakeFetch({
      "https://shop.example/item/42": { contentType: "text/html; charset=utf-8", body: PRODUCT_HTML },
    });

    const product = await parseUrl("shop.example/item/42?utm_source=tg&fbclid=abc", {
      fetchImpl: impl,
      lookupImpl: publicLookup,
      cache,
    });

    expect(product.title).toBe("Тестовый товар");
    expect(product.price).toBe("1990");
    expect(product.currency).toBe("RUB");
    expect(product.canonicalUrl).toBe("https://shop.example/item/42");
    expect(product.domain).toBe("shop.example");
    expect(calls[0]?.url).toBe("https://shop.example/item/42"); // трекинг вырезан ДО запроса
    expect(redis.store.size).toBe(1); // canonical == alias → один ключ

    // повторный вызов — из кэша, без сети
    const again = await parseUrl("https://shop.example/item/42", {
      fetchImpl: impl,
      lookupImpl: publicLookup,
      cache,
    });
    expect(again).toEqual(product);
    expect(calls).toHaveLength(1);
  });

  it("редирект: canonicalUrl — финальный URL, алиас тоже кэшируется", async () => {
    const { redis, cache } = makeCache();
    const { impl } = fakeFetch({
      "https://shop.example/old-slug": {
        status: 301,
        headers: { location: "https://shop.example/new-slug" },
      },
      "https://shop.example/new-slug": { contentType: "text/html", body: PRODUCT_HTML },
    });

    const product = await parseUrl("https://shop.example/old-slug", {
      fetchImpl: impl,
      lookupImpl: publicLookup,
      cache,
    });
    expect(product.canonicalUrl).toBe("https://shop.example/new-slug");
    expect(redis.store.size).toBe(2); // canonical + алиас до редиректа
    expect(await cache.getProduct("https://shop.example/old-slug")).toEqual(product);
  });

  it("короткая ссылка разворачивается HEAD'ом, потом GET страницы", async () => {
    const { cache } = makeCache();
    const { impl, calls } = fakeFetch({
      "https://clck.ru/3AbCdE": {
        status: 301,
        headers: { location: "https://shop.example/item/42" },
      },
      "https://shop.example/item/42": { contentType: "text/html", body: PRODUCT_HTML },
    });

    const product = await parseUrl("https://clck.ru/3AbCdE", {
      fetchImpl: impl,
      lookupImpl: publicLookup,
      cache,
    });
    expect(product.title).toBe("Тестовый товар");
    expect(product.canonicalUrl).toBe("https://shop.example/item/42");
    expect(calls.map((call) => call.method)).toEqual(["HEAD", "HEAD", "GET"]);
  });

  it("HTTP 404 → честная карточка: domain + canonicalUrl + confidence 0.1", async () => {
    const { redis, cache } = makeCache();
    const { impl } = fakeFetch({
      "https://shop.example/gone": { status: 404, contentType: "text/html", body: "нет" },
    });
    const product = await parseUrl("https://shop.example/gone", {
      fetchImpl: impl,
      lookupImpl: publicLookup,
      cache,
    });
    expect(product).toEqual({
      domain: "shop.example",
      canonicalUrl: "https://shop.example/gone",
      confidence: 0.1,
    });
    expect(redis.store.size).toBe(0); // неудачи не кэшируем на 24 часа
  });

  it("SSRF-цель (127.0.0.1) не роняет конвейер: fetch не вызван, карточка честная", async () => {
    const { cache } = makeCache();
    const { impl, calls } = fakeFetch({});
    const product = await parseUrl("http://127.0.0.1/admin", {
      fetchImpl: impl,
      lookupImpl: publicLookup,
      cache,
    });
    expect(calls).toHaveLength(0);
    expect(product.confidence).toBe(0.1);
    expect(product.title).toBeUndefined();
  });

  it("не-HTML content-type → честная карточка", async () => {
    const { cache } = makeCache();
    const { impl } = fakeFetch({
      "https://shop.example/file.pdf": { contentType: "application/pdf", body: "%PDF-1.7" },
    });
    const product = await parseUrl("https://shop.example/file.pdf", {
      fetchImpl: impl,
      lookupImpl: publicLookup,
      cache,
    });
    expect(product.confidence).toBe(0.1);
    expect(product.domain).toBe("shop.example");
  });

  it("token-bucket домена: при исчерпании — ParserError(rate-limited)", async () => {
    let now = 0;
    const cache = new ParserCache({ redis: null, capacity: 2, now: () => now });
    const routes: Record<string, { contentType: string; body: string }> = {};
    for (let i = 0; i < 3; i += 1) {
      routes[`https://shop.example/i${i}`] = { contentType: "text/html", body: PRODUCT_HTML };
    }
    const { impl } = fakeFetch(routes);
    const options = { fetchImpl: impl, lookupImpl: publicLookup, cache };

    await parseUrl("https://shop.example/i0", options);
    await parseUrl("https://shop.example/i1", options);
    await expect(parseUrl("https://shop.example/i2", options)).rejects.toMatchObject({
      code: "rate-limited",
    });
    now += 60_000; // токены натекли обратно
    await expect(parseUrl("https://shop.example/i2", options)).resolves.toMatchObject({
      title: "Тестовый товар",
    });
  });

  it("мусорный вход → ParserError(invalid-url)", async () => {
    const { cache } = makeCache();
    await expect(
      parseUrl("не ссылка вообще", { fetchImpl: fakeFetch({}).impl, lookupImpl: publicLookup, cache }),
    ).rejects.toBeInstanceOf(ParserError);
  });

  it("Redis лежит → парсинг работает без кэша", async () => {
    const failing = {
      get: async () => {
        throw new Error("ECONNREFUSED");
      },
      set: async () => {
        throw new Error("ECONNREFUSED");
      },
      eval: async () => {
        throw new Error("ECONNREFUSED");
      },
    };
    const cache = new ParserCache({ redis: failing });
    const { impl } = fakeFetch({
      "https://shop.example/item/42": { contentType: "text/html", body: PRODUCT_HTML },
    });
    const product = await parseUrl("https://shop.example/item/42", {
      fetchImpl: impl,
      lookupImpl: publicLookup,
      cache,
    });
    expect(product.title).toBe("Тестовый товар");
  });
});
