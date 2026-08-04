// Лимит POST /api/v1/parse — 10/мин на userId (spec Phase 1: «parse — по
// userId»). Переиспользуем RateLimiter тикета 08 (src/server/rate-limit):
// token-bucket в Redis по REDIS_URL, без Redis — корзина в памяти процесса.
// Своё пространство ключей rl:v1:parse — с корзиной брони не пересекается.
//
// Это второй эшелон ПОВЕРХ парсерного bucket'а per-domain (тот бережёт
// магазины, этот — нас от одного увлёкшегося пользователя).

import { RateLimiter, type RateLimitRedis } from "@/server/rate-limit";

const PARSE_PREFIX = "rl:v1:parse";

let parseLimiter: RateLimiter | null = null;

/** Ленивый синглтон (паттерн getBookingLimiter из src/server/rate-limit). */
export async function getParseLimiter(): Promise<RateLimiter> {
  if (parseLimiter) return parseLimiter;
  const url = process.env.REDIS_URL;
  if (!url) {
    parseLimiter = new RateLimiter({ redis: null, prefix: PARSE_PREFIX });
    return parseLimiter;
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
    parseLimiter = new RateLimiter({
      redis: client as unknown as RateLimitRedis,
      prefix: PARSE_PREFIX,
    });
  } catch {
    parseLimiter = new RateLimiter({ redis: null, prefix: PARSE_PREFIX });
  }
  return parseLimiter;
}
