// Юнит-тесты rate limit брони (тикет 08): token bucket 10/мин по ключу (IP),
// Redis-путь и graceful-путь в памяти. Часы инъектируются — тесты мгновенные.
import { describe, expect, it, vi } from "vitest";
import {
  BOOKING_BUCKET_CAPACITY,
  clientIp,
  RateLimiter,
  type RateLimitRedis,
} from "../src/server/rate-limit";

/** Ручные часы: тест сам двигает время. */
function makeClock(start = 1_000_000) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe("RateLimiter (память, без Redis)", () => {
  it("даёт ровно capacity запросов подряд, следующий режет", async () => {
    const clock = makeClock();
    const limiter = new RateLimiter({ redis: null, now: clock.now });

    for (let i = 0; i < BOOKING_BUCKET_CAPACITY; i += 1) {
      expect(await limiter.allow("ip-1")).toBe(true);
    }
    expect(await limiter.allow("ip-1")).toBe(false);
  });

  it("корзина пополняется со временем: 10/мин = 1 токен в 6 секунд", async () => {
    const clock = makeClock();
    const limiter = new RateLimiter({ redis: null, now: clock.now });

    for (let i = 0; i < BOOKING_BUCKET_CAPACITY; i += 1) await limiter.allow("ip-1");
    expect(await limiter.allow("ip-1")).toBe(false);

    clock.advance(6_000); // один токен натёк
    expect(await limiter.allow("ip-1")).toBe(true);
    expect(await limiter.allow("ip-1")).toBe(false); // а второго ещё нет
  });

  it("ключи независимы: сосед по NAT не съедает чужой бюджет", async () => {
    const clock = makeClock();
    const limiter = new RateLimiter({ redis: null, now: clock.now });

    for (let i = 0; i < BOOKING_BUCKET_CAPACITY; i += 1) await limiter.allow("ip-1");
    expect(await limiter.allow("ip-1")).toBe(false);
    expect(await limiter.allow("ip-2")).toBe(true);
  });

  it("capacity и скорость пополнения настраиваются", async () => {
    const clock = makeClock();
    const limiter = new RateLimiter({
      redis: null,
      capacity: 2,
      refillPerMinute: 60, // токен в секунду
      now: clock.now,
    });

    expect(await limiter.allow("k")).toBe(true);
    expect(await limiter.allow("k")).toBe(true);
    expect(await limiter.allow("k")).toBe(false);
    clock.advance(1_000);
    expect(await limiter.allow("k")).toBe(true);
  });
});

describe("RateLimiter (Redis-путь)", () => {
  it("верит ответу Lua-скрипта: 1 — можно, 0 — нельзя", async () => {
    const evalMock = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const redis: RateLimitRedis = { eval: evalMock };
    const limiter = new RateLimiter({ redis, prefix: "rl:test" });

    expect(await limiter.allow("ip-9")).toBe(true);
    expect(await limiter.allow("ip-9")).toBe(false);
    expect(evalMock).toHaveBeenCalledTimes(2);
    // Ключ собран из префикса и ключа вызова.
    expect(evalMock.mock.calls[0]?.[2]).toBe("rl:test:ip-9");
  });

  it("Redis упал → тихо переходит в память и не трогает Redis в кулдауне", async () => {
    const clock = makeClock();
    const evalMock = vi.fn().mockRejectedValue(new Error("redis down"));
    const limiter = new RateLimiter({
      redis: { eval: evalMock },
      capacity: 1,
      now: clock.now,
    });

    expect(await limiter.allow("ip-1")).toBe(true); // память подхватила
    expect(await limiter.allow("ip-1")).toBe(false); // и считает честно
    expect(evalMock).toHaveBeenCalledTimes(1); // кулдаун: Redis больше не трогали

    clock.advance(31_000); // кулдаун прошёл — снова пробуем Redis
    evalMock.mockResolvedValueOnce(1);
    expect(await limiter.allow("ip-1")).toBe(true);
    expect(evalMock).toHaveBeenCalledTimes(2);
  });
});

describe("clientIp", () => {
  it("первый адрес x-forwarded-for", () => {
    const headers = new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" });
    expect(clientIp(headers)).toBe("203.0.113.7");
  });

  it("без x-forwarded-for — x-real-ip; совсем без прокси — local", () => {
    expect(clientIp(new Headers({ "x-real-ip": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(new Headers())).toBe("local");
  });
});
