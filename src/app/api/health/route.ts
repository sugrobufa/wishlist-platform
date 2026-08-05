// GET /api/health — единственная точка «жив ли выпуск» (деплой, тикет 28).
//
// Три потребителя, поэтому проверка живая, а не заглушка `{ok:true}`:
//   1. HEALTHCHECK контейнера app в docker-compose.prod.yml;
//   2. compose: caddy зависит от app с условием service_healthy — прокси не
//      поднимется раньше, чем приложение готово отвечать;
//   3. deploy/release.sh — по этому ответу решает, оставить выпуск или
//      откатиться на прошлый образ.
//
// КОНТРАКТ СТАТУСОВ (важен для отката, не менять молча):
//   - БД недоступна → HTTP 503, status "down". Приложение без Postgres не
//     умеет ничего: комната не читается, вход не работает.
//   - БД жива, Redis лежит → HTTP 200, status "degraded". Redis у нас —
//     очереди и rate-limit, и оба места переживают его отсутствие
//     (queues.ts возвращает false, rate-limit.ts падает в память). Ронять
//     контейнер (и уводить сайт в 502) из-за письма, которое подождёт, —
//     хуже, чем отдавать комнаты дальше. Поэтому контейнер здоров, а
//     release.sh требует ровно "ok" — деградировавший ВЫПУСК не принимаем.
//
// Быстрота: обе проверки идут параллельно и обрезаются таймаутом 1.5 с —
// health не имеет права висеть дольше интервала healthcheck'а.
import { NextResponse } from "next/server";
import type { Redis } from "ioredis";
import { prisma } from "@/server/db";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const PROBE_TIMEOUT_MS = 1_500;

const NO_STORE = { "Cache-Control": "no-store" } as const;

type ProbeState = "up" | "down";

/** Обещание с крышкой по времени: зависшая проверка = "down", а не таймаут роута. */
async function withTimeout(probe: Promise<unknown>): Promise<ProbeState> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"down">((resolve) => {
    timer = setTimeout(() => resolve("down"), PROBE_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([probe.then(() => "up" as const), deadline]);
    return result;
  } catch {
    return "down";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** `SELECT 1` — самый дешёвый честный признак живого пула Prisma. */
function probeDb(): Promise<ProbeState> {
  return withTimeout(prisma.$queryRaw`SELECT 1`);
}

// Соединение переживает запросы через globalThis (паттерн src/server/db.ts и
// queues.ts): health зовут раз в 15–30 секунд, коннектиться каждый раз заново
// незачем. ioredis грузится динамически — импорт роута остаётся дешёвым.
const globalForHealth = globalThis as unknown as { __wishlistHealthRedis?: Promise<Redis> };

// Настройки — те же, что у очередей (src/server/queues.ts): без
// offline-очереди команда к лежащему Redis падает сразу, а не копится;
// поэтому connect() вызывается явно, до первого ping.
async function connectHealthRedis(): Promise<Redis> {
  const { default: IORedis } = await import("ioredis");
  const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    connectTimeout: 1_000,
    lazyConnect: true,
  });
  // без обработчика 'error' ioredis роняет процесс unhandled-ошибкой
  connection.on("error", () => undefined);
  try {
    await connection.connect();
  } catch (error) {
    connection.disconnect();
    throw error;
  }
  return connection;
}

function healthRedis(): Promise<Redis> {
  let pending = globalForHealth.__wishlistHealthRedis;
  if (!pending) {
    pending = connectHealthRedis();
    globalForHealth.__wishlistHealthRedis = pending;
    // Неудачное подключение не кэшируем: следующая проверка попробует снова
    // (Redis мог просто ещё не подняться). Успешное — кэшируем: обрывы
    // ioredis чинит сам переподключением.
    pending.catch(() => {
      delete globalForHealth.__wishlistHealthRedis;
    });
  }
  return pending;
}

function probeRedis(): Promise<ProbeState> {
  return withTimeout(healthRedis().then((connection) => connection.ping()));
}

export async function GET(): Promise<NextResponse> {
  const startedAt = Date.now();
  const [db, redis] = await Promise.all([probeDb(), probeRedis()]);

  const status = db === "down" ? "down" : redis === "up" ? "ok" : "degraded";

  return NextResponse.json(
    {
      data: {
        status,
        db,
        redis,
        // Тег образа кладёт деплой (docker-compose.prod.yml → APP_VERSION):
        // по нему release.sh видит, что поднялся именно новый выпуск.
        version: process.env.APP_VERSION ?? "dev",
        tookMs: Date.now() - startedAt,
      },
    },
    { status: db === "down" ? 503 : 200, headers: NO_STORE },
  );
}
