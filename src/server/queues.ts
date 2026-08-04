// Ленивые Queue-клиенты BullMQ для app-стороны (тикет 06): enqueue из
// server actions и сервисов. Воркер (src/worker) — отдельный процесс со
// своими Worker'ами; имена очередей — единственный общий контракт.
//
// bullmq/ioredis грузятся динамически при первом обращении: импорт модуля
// бесплатен (тесты сервисов не тянут Redis), инстансы переживают HMR через
// globalThis (паттерн src/server/db.ts).

import type { Queue } from "bullmq";

export const MAIL_QUEUE_NAME = "mail";
export const IMAGE_INGEST_QUEUE_NAME = "image.ingest";

/** Джоба скачивания фото товара в своё S3 (инвариант №6: не хотлинкуем). */
export interface ImageIngestJobData {
  itemId: string;
  imageUrl: string;
}

type QueueRegistry = Map<string, Promise<Queue>>;

const globalForQueues = globalThis as unknown as { __wishlistQueues?: QueueRegistry };

function registry(): QueueRegistry {
  globalForQueues.__wishlistQueues ??= new Map();
  return globalForQueues.__wishlistQueues;
}

async function createQueue(name: string): Promise<Queue> {
  const [{ Queue: QueueCtor }, { default: IORedis }] = await Promise.all([
    import("bullmq"),
    import("ioredis"),
  ]);
  const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
    lazyConnect: true,
    // Redis лежит → команды падают сразу, а не копятся в offline-очереди
    // (enqueue возвращает false, сохранение вещи не подвисает).
    enableOfflineQueue: false,
    connectTimeout: 1_000,
  });
  // без обработчика 'error' ioredis роняет процесс unhandled-ошибкой
  connection.on("error", () => undefined);
  try {
    // Явный connect: с enableOfflineQueue=false первая команда до ready
    // отклонилась бы — а так очередь готова до первого add().
    await connection.connect();
  } catch (error) {
    connection.disconnect();
    throw error;
  }
  return new QueueCtor(name, { connection });
}

/** Ленивый Queue-клиент по имени; неудача подключения не кэшируется. */
export function getQueue(name: string): Promise<Queue> {
  let queue = registry().get(name);
  if (!queue) {
    queue = createQueue(name);
    registry().set(name, queue);
    queue.catch(() => registry().delete(name));
  }
  return queue;
}

export function getMailQueue(): Promise<Queue> {
  return getQueue(MAIL_QUEUE_NAME);
}

export function getImageIngestQueue(): Promise<Queue> {
  return getQueue(IMAGE_INGEST_QUEUE_NAME);
}

/**
 * Поставить скачивание фото вещи (обработчик — src/worker/image-ingest.ts).
 * Никогда не бросает: очередь недоступна → false, вещь остаётся без фото —
 * сохранение не блокируем (тикет 06).
 */
export async function enqueueImageIngest(data: ImageIngestJobData): Promise<boolean> {
  try {
    const queue = await getImageIngestQueue();
    await queue.add("ingest", data, {
      attempts: 3,
      backoff: { type: "exponential", delay: 3_000 },
      removeOnComplete: 1_000,
      removeOnFail: 5_000,
    });
    return true;
  } catch (error) {
    console.warn(
      `queues: image.ingest недоступна — вещь ${data.itemId} останется без фото магазина`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}
