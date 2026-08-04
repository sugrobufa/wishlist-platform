// ParserCache: кэш по canonicalUrl (TTL 24 ч), token-bucket per-domain,
// graceful-деградация при недоступном Redis.

import { describe, expect, it } from "vitest";
import { CACHE_TTL_SECONDS, ParserCache } from "../../src/server/parser/cache";
import type { ParsedProduct } from "../../src/server/parser/types";
import { FakeRedis } from "./fakeRedis";

const PRODUCT: ParsedProduct = {
  title: "Тестовый товар",
  price: "1990",
  currency: "RUB",
  domain: "shop.example",
  canonicalUrl: "https://shop.example/item/42",
  confidence: 0.9,
};

class ThrowingRedis {
  calls = 0;
  private fail(): never {
    this.calls += 1;
    throw new Error("ECONNREFUSED");
  }
  async get(): Promise<string | null> {
    return this.fail();
  }
  async set(): Promise<unknown> {
    return this.fail();
  }
  async eval(): Promise<unknown> {
    return this.fail();
  }
}

describe("ParserCache: кэш продукта", () => {
  it("roundtrip с TTL 24 часа", async () => {
    const redis = new FakeRedis();
    const cache = new ParserCache({ redis });
    await cache.setProduct(PRODUCT);
    expect(await cache.getProduct(PRODUCT.canonicalUrl)).toEqual(PRODUCT);
    const entry = [...redis.store.values()][0];
    expect(entry?.ttl).toBe(CACHE_TTL_SECONDS);
    expect(CACHE_TTL_SECONDS).toBe(86_400);
  });

  it("алиас (URL до редиректа) пишется вторым ключом", async () => {
    const redis = new FakeRedis();
    const cache = new ParserCache({ redis });
    await cache.setProduct(PRODUCT, "https://clck.ru/3AbCdE");
    expect(redis.store.size).toBe(2);
    expect(await cache.getProduct("https://clck.ru/3AbCdE")).toEqual(PRODUCT);
  });

  it("битый JSON в кэше — просто промах, не исключение", async () => {
    const redis = new FakeRedis();
    const cache = new ParserCache({ redis });
    await cache.setProduct(PRODUCT);
    for (const key of redis.store.keys()) {
      redis.store.set(key, { value: "{сломано", ttl: 1 });
    }
    expect(await cache.getProduct(PRODUCT.canonicalUrl)).toBeNull();
  });

  it("redis: null → кэша нет, но методы не падают", async () => {
    const cache = new ParserCache({ redis: null });
    await cache.setProduct(PRODUCT);
    expect(await cache.getProduct(PRODUCT.canonicalUrl)).toBeNull();
  });
});

describe("ParserCache: token-bucket per-domain", () => {
  it("через Redis: eval 1 → разрешено, 0 → отказ; ключ содержит домен", async () => {
    const redis = new FakeRedis();
    const cache = new ParserCache({ redis });
    redis.evalResults = [1, 0];
    expect(await cache.takeToken("ozon.ru")).toBe(true);
    expect(await cache.takeToken("ozon.ru")).toBe(false);
    expect(redis.evalCalls[0]?.numKeys).toBe(1);
    expect(String(redis.evalCalls[0]?.args[0])).toContain("ozon.ru");
    expect(redis.evalCalls[0]?.args[1]).toBe(10); // capacity N=10/мин из тикета
  });

  it("in-memory ветка: 10 запросов проходят, 11-й нет, через минуту токены натекают", async () => {
    let now = 0;
    const cache = new ParserCache({ redis: null, now: () => now });
    for (let i = 0; i < 10; i += 1) {
      expect(await cache.takeToken("wildberries.ru"), `запрос №${i + 1}`).toBe(true);
    }
    expect(await cache.takeToken("wildberries.ru")).toBe(false);
    now += 6_100; // ~1 токен натёк (10/мин ≈ 1 токен в 6 с)
    expect(await cache.takeToken("wildberries.ru")).toBe(true);
    expect(await cache.takeToken("wildberries.ru")).toBe(false);
    now += 60_000;
    for (let i = 0; i < 10; i += 1) {
      expect(await cache.takeToken("wildberries.ru")).toBe(true);
    }
  });

  it("домены не мешают друг другу", async () => {
    const now = 0;
    const cache = new ParserCache({ redis: null, capacity: 1, now: () => now });
    expect(await cache.takeToken("a.ru")).toBe(true);
    expect(await cache.takeToken("a.ru")).toBe(false);
    expect(await cache.takeToken("b.ru")).toBe(true);
  });

  it("Redis упал → фолбэк в память + кулдаун без повторных ударов в Redis", async () => {
    let now = 0;
    const redis = new ThrowingRedis();
    const cache = new ParserCache({ redis, now: () => now });
    expect(await cache.takeToken("dns-shop.ru")).toBe(true); // упало → память
    expect(redis.calls).toBe(1);
    expect(await cache.takeToken("dns-shop.ru")).toBe(true); // кулдаун: Redis не трогаем
    expect(redis.calls).toBe(1);
    expect(await cache.getProduct("https://x.ru/")).toBeNull();
    expect(redis.calls).toBe(1);
    now += 31_000; // кулдаун истёк — пробуем Redis снова
    expect(await cache.takeToken("dns-shop.ru")).toBe(true);
    expect(redis.calls).toBe(2);
  });
});
