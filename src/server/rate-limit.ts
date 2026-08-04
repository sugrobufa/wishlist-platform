// Rate limit по IP для действий гостя с бронью (тикет 08, spec: token-bucket
// в Redis, 10/мин). Redis недоступен → корзина в памяти процесса (graceful
// degradation: бронь не ломается без docker'а).
//
// НЕ трогает parser/cache.ts: у парсера СВОЯ корзина per-domain со своим
// пространством ключей; здесь — отдельная, per-IP, prefix `rl:v1`.

/** Узкий интерфейс — ровно то, что нужно от ioredis; в тестах — фейк. */
export interface RateLimitRedis {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export const BOOKING_BUCKET_CAPACITY = 10;
export const BOOKING_REFILL_PER_MINUTE = 10;

/** Сколько миллисекунд не трогаем Redis после ошибки (не молотим мёртвое соединение). */
const REDIS_COOLDOWN_MS = 30_000;

// Классический token bucket на Lua: атомарно в Redis, состояние в HASH.
const TOKEN_BUCKET_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refillPerMs = tonumber(ARGV[2])
local now = tonumber(ARGV[3])
local state = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(state[1])
local ts = tonumber(state[2])
if tokens == nil or ts == nil then
  tokens = capacity
  ts = now
end
local elapsed = now - ts
if elapsed < 0 then elapsed = 0 end
tokens = tokens + elapsed * refillPerMs
if tokens > capacity then tokens = capacity end
local allowed = 0
if tokens >= 1 then
  tokens = tokens - 1
  allowed = 1
end
redis.call('HMSET', key, 'tokens', tokens, 'ts', now)
redis.call('PEXPIRE', key, 120000)
return allowed
`;

export interface RateLimiterOptions {
  /** null — Redis нет вообще (тесты, dev без docker); undefined недопустим — передавайте null явно. */
  redis: RateLimitRedis | null;
  capacity?: number;
  refillPerMinute?: number;
  /** Пространство ключей: `${prefix}:${key}`. */
  prefix?: string;
  now?: () => number;
}

interface MemoryBucket {
  tokens: number;
  ts: number;
}

/**
 * Token bucket по строковому ключу (у брони — IP гостя): capacity запросов
 * разом, пополнение refillPerMinute в минуту. Redis-путь атомарный (Lua);
 * при ошибке Redis — кулдаун 30 с и корзина в памяти процесса.
 */
export class RateLimiter {
  private readonly redis: RateLimitRedis | null;
  private readonly now: () => number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly prefix: string;
  private redisDownUntil = 0;
  private readonly memoryBuckets = new Map<string, MemoryBucket>();

  constructor(options: RateLimiterOptions) {
    this.redis = options.redis;
    this.now = options.now ?? Date.now;
    this.capacity = options.capacity ?? BOOKING_BUCKET_CAPACITY;
    this.refillPerMs = (options.refillPerMinute ?? BOOKING_REFILL_PER_MINUTE) / 60_000;
    this.prefix = options.prefix ?? "rl:v1";
  }

  /** true — действие разрешено; false — бюджет исчерпан (ответ 429). */
  async allow(key: string): Promise<boolean> {
    const bucketKey = `${this.prefix}:${key}`;
    if (this.redis !== null && this.now() >= this.redisDownUntil) {
      try {
        const allowed = await this.redis.eval(
          TOKEN_BUCKET_LUA,
          1,
          bucketKey,
          this.capacity,
          this.refillPerMs,
          this.now(),
        );
        return allowed === 1 || allowed === "1";
      } catch {
        this.redisDownUntil = this.now() + REDIS_COOLDOWN_MS;
        // проваливаемся в память
      }
    }
    return this.allowFromMemory(bucketKey);
  }

  private allowFromMemory(bucketKey: string): boolean {
    const now = this.now();
    const bucket = this.memoryBuckets.get(bucketKey) ?? { tokens: this.capacity, ts: now };
    const elapsed = Math.max(0, now - bucket.ts);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerMs);
    bucket.ts = now;
    let allowed = false;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      allowed = true;
    }
    this.memoryBuckets.set(bucketKey, bucket);
    if (this.memoryBuckets.size > 10_000) this.memoryBuckets.clear(); // предохранитель
    return allowed;
  }
}

/**
 * IP гостя из заголовков запроса: первый адрес x-forwarded-for (его ставит
 * прокси перед Next), запасной x-real-ip, без прокси (dev) — "local".
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = headers.get("x-real-ip")?.trim();
  if (real) return real;
  return "local";
}

// ---------------------------------------------------------------------------
// Ленивый синглтон для продакшн-пути (REDIS_URL из env; ioredis уже в deps)
// ---------------------------------------------------------------------------

let bookingLimiter: RateLimiter | null = null;

async function getBookingLimiter(): Promise<RateLimiter> {
  if (bookingLimiter) return bookingLimiter;
  const url = process.env.REDIS_URL;
  if (!url) {
    bookingLimiter = new RateLimiter({ redis: null, prefix: "rl:v1:booking" });
    return bookingLimiter;
  }
  try {
    const { default: IORedis } = await import("ioredis");
    const client = new IORedis(url, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      retryStrategy: () => null,
      connectTimeout: 1_000,
    });
    // без обработчика 'error' ioredis роняет процесс unhandled-ошибкой
    client.on("error", () => undefined);
    // ioredis шире нашего RateLimitRedis (overload-сигнатуры) — сужаем явно
    bookingLimiter = new RateLimiter({
      redis: client as unknown as RateLimitRedis,
      prefix: "rl:v1:booking",
    });
  } catch {
    bookingLimiter = new RateLimiter({ redis: null, prefix: "rl:v1:booking" });
  }
  return bookingLimiter;
}

/**
 * Бюджет действий с бронью для одного IP: 10/мин на бронь+отмену+«куплено»
 * вместе (одна корзина — spec Phase 1, Implementation Decisions).
 */
export async function allowBookingAction(ip: string): Promise<boolean> {
  const limiter = await getBookingLimiter();
  return limiter.allow(ip);
}
