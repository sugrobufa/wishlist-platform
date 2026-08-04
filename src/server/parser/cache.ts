// Redis-кэш результатов парсинга (ключ — canonicalUrl, TTL 24 ч) и
// token-bucket per-domain (10 запросов/мин к одному магазину).
// Redis недоступен → работаем без кэша, bucket считается в памяти процесса
// (graceful degradation, парсинг не ломается).

import { createHash } from "node:crypto";
import type { ParsedProduct } from "./types";

/** Узкий интерфейс — ровно то, что нужно от ioredis; в тестах — фейк. */
export interface RedisLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ex: "EX", ttlSeconds: number): Promise<unknown>;
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
}

export const CACHE_TTL_SECONDS = 24 * 60 * 60;
export const BUCKET_CAPACITY = 10;
export const BUCKET_REFILL_PER_MINUTE = 10;

/** Сколько миллисекунд не трогаем Redis после ошибки (чтобы не молотить мёртвое соединение). */
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

function cacheKey(canonicalUrl: string): string {
  return `parser:v1:product:${createHash("sha256").update(canonicalUrl).digest("hex")}`;
}

function bucketKey(domain: string): string {
  return `parser:v1:bucket:${domain}`;
}

export interface ParserCacheOptions {
  /** null — Redis нет вообще (тесты, dev без docker); undefined недопустим — передавайте null явно. */
  redis: RedisLike | null;
  now?: () => number;
  capacity?: number;
  refillPerMinute?: number;
  ttlSeconds?: number;
}

interface MemoryBucket {
  tokens: number;
  ts: number;
}

export class ParserCache {
  private readonly redis: RedisLike | null;
  private readonly now: () => number;
  private readonly capacity: number;
  private readonly refillPerMs: number;
  private readonly ttlSeconds: number;
  private redisDownUntil = 0;
  private readonly memoryBuckets = new Map<string, MemoryBucket>();

  constructor(options: ParserCacheOptions) {
    this.redis = options.redis;
    this.now = options.now ?? Date.now;
    this.capacity = options.capacity ?? BUCKET_CAPACITY;
    this.refillPerMs = (options.refillPerMinute ?? BUCKET_REFILL_PER_MINUTE) / 60_000;
    this.ttlSeconds = options.ttlSeconds ?? CACHE_TTL_SECONDS;
  }

  private redisAvailable(): boolean {
    return this.redis !== null && this.now() >= this.redisDownUntil;
  }

  private markRedisDown(): void {
    this.redisDownUntil = this.now() + REDIS_COOLDOWN_MS;
  }

  /** Кэшированный результат по canonicalUrl (или его алиасу до редиректов). */
  async getProduct(canonicalUrl: string): Promise<ParsedProduct | null> {
    if (!this.redisAvailable() || this.redis === null) return null;
    try {
      const raw = await this.redis.get(cacheKey(canonicalUrl));
      if (raw === null) return null;
      const parsed: unknown = JSON.parse(raw);
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        typeof (parsed as ParsedProduct).canonicalUrl === "string" &&
        typeof (parsed as ParsedProduct).domain === "string"
      ) {
        return parsed as ParsedProduct;
      }
      return null;
    } catch {
      this.markRedisDown();
      return null;
    }
  }

  /**
   * Сохраняет результат под canonicalUrl; aliasUrl (нормализованный URL
   * ДО разворота редиректов) пишется вторым ключом, чтобы короткая ссылка
   * попадала в кэш без повторного похода в сеть.
   */
  async setProduct(product: ParsedProduct, aliasUrl?: string): Promise<void> {
    if (!this.redisAvailable() || this.redis === null) return;
    const payload = JSON.stringify(product);
    try {
      await this.redis.set(cacheKey(product.canonicalUrl), payload, "EX", this.ttlSeconds);
      if (aliasUrl && aliasUrl !== product.canonicalUrl) {
        await this.redis.set(cacheKey(aliasUrl), payload, "EX", this.ttlSeconds);
      }
    } catch {
      this.markRedisDown();
    }
  }

  /** true — запрос к домену разрешён; false — бюджет 10/мин исчерпан. */
  async takeToken(domain: string): Promise<boolean> {
    if (this.redisAvailable() && this.redis !== null) {
      try {
        const allowed = await this.redis.eval(
          TOKEN_BUCKET_LUA,
          1,
          bucketKey(domain),
          this.capacity,
          this.refillPerMs,
          this.now(),
        );
        return allowed === 1 || allowed === "1";
      } catch {
        this.markRedisDown();
        // проваливаемся в память
      }
    }
    return this.takeMemoryToken(domain);
  }

  private takeMemoryToken(domain: string): boolean {
    const now = this.now();
    const bucket = this.memoryBuckets.get(domain) ?? { tokens: this.capacity, ts: now };
    const elapsed = Math.max(0, now - bucket.ts);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillPerMs);
    bucket.ts = now;
    let allowed = false;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      allowed = true;
    }
    this.memoryBuckets.set(domain, bucket);
    if (this.memoryBuckets.size > 10_000) this.memoryBuckets.clear(); // предохранитель
    return allowed;
  }
}

// ---------------------------------------------------------------------------
// Ленивый синглтон для продакшн-пути (REDIS_URL из env; ioredis уже в deps)
// ---------------------------------------------------------------------------

let defaultCache: ParserCache | null = null;

/**
 * Кэш по умолчанию: подключается к REDIS_URL лениво, без offline-очереди и
 * бесконечных ретраев; любые ошибки Redis гасятся внутри ParserCache.
 * ВАЖНО: в тестах сюда не ходим — тесты передают свой ParserCache/фейк.
 */
export async function getDefaultCache(): Promise<ParserCache> {
  if (defaultCache) return defaultCache;
  const url = process.env.REDIS_URL;
  if (!url) {
    defaultCache = new ParserCache({ redis: null });
    return defaultCache;
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
    // ioredis шире нашего RedisLike (overload-сигнатуры) — сужаем явно
    defaultCache = new ParserCache({ redis: client as unknown as RedisLike });
  } catch {
    defaultCache = new ParserCache({ redis: null });
  }
  return defaultCache;
}
