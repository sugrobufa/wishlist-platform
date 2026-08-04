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
/** Ежечасное закрытие праздников (тикет 10): repeat-джоба воркера. */
export const OCCASION_CLOSE_QUEUE_NAME = "occasion.close";

/** Джоба скачивания фото товара в своё S3 (инвариант №6: не хотлинкуем). */
export interface ImageIngestJobData {
  itemId: string;
  imageUrl: string;
}

/**
 * Письмо хозяйке «открой „что подарили"» (тикет 10 → шаблон — тикет 12).
 * Контракт payload'а: джоба `occasion-owner` в очереди mail.
 */
export interface OccasionOwnerMailJobData {
  userId: string;
  email: string;
  roomId: string;
}

/**
 * Напоминание гостю за 3 дня до праздника (тикет 12): джоба `reminder-guest`
 * в очереди mail. Payload самодостаточен — обработчик рендерит письмо без
 * походов в БД (сверяет только, что бронь ещё жива).
 */
export interface ReminderGuestMailJobData {
  bookingId: string;
  email: string;
  guestName: string;
  /** displayName хозяйки; null — имени нет, шаблон обходится без него. */
  ownerName: string | null;
  /** ISO-строка occasionDate комнаты (payload BullMQ — JSON). */
  occasionDate: string;
  itemTitle: string;
  roomSlug: string;
}

/**
 * Хранение выполненных джоб очереди mail: 14 суток. Это не уборка ради
 * уборки, а ОКНО ДЕДУПЛИКАЦИИ напоминаний: reminder-guest ставится с
 * детерминированным jobId (reminderGuestJobId), и повторный add с тем же
 * jobId — no-op BullMQ, пока прежняя джоба жива (включая completed).
 * Окно тика — 3 дня; 14 суток покрывают его с запасом. Count-лимитов в
 * removeOnComplete очереди mail не добавлять: чистка по количеству могла бы
 * выселить completed-джобу раньше срока и открыть дорогу дублю письма.
 */
export const MAIL_KEEP_COMPLETED = { age: 14 * 24 * 60 * 60 } as const; // секунды

/**
 * Детерминированный id джобы напоминания: одна бронь × одна дата праздника
 * = максимум одно письмо (идемпотентность ежечасного тика без поля в БД).
 * Сутки даты — UTC, как всюду в цикле праздника (тикет 10).
 */
export function reminderGuestJobId(bookingId: string, occasionDate: Date): string {
  const yyyymmdd = occasionDate.toISOString().slice(0, 10).replace(/-/g, "");
  return `reminder-${bookingId}-${yyyymmdd}`;
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
 * Поставить письмо хозяйке «открой „что подарили"» (тикет 10). Шаблон и
 * отправка — тикет 12 (обработчик очереди mail); здесь ТОЛЬКО enqueue.
 * Никогда не бросает: очередь недоступна → false, закрытие праздника не
 * блокируем — summary важнее письма.
 */
export async function enqueueOccasionOwnerMail(data: OccasionOwnerMailJobData): Promise<boolean> {
  try {
    const queue = await getMailQueue();
    await queue.add("occasion-owner", data, {
      attempts: 3,
      backoff: { type: "exponential", delay: 3_000 },
      // Возраст, не количество: count-чистка completed-набора очереди mail
      // снесла бы дедуп-записи напоминаний (см. MAIL_KEEP_COMPLETED).
      removeOnComplete: MAIL_KEEP_COMPLETED,
      removeOnFail: 5_000,
    });
    return true;
  } catch (error) {
    console.warn(
      `queues: mail недоступна — хозяйка ${data.userId} останется без письма о празднике`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

/**
 * Поставить напоминание гостю (тикет 12; обработчик — src/worker/mail.ts).
 * Никогда не бросает: очередь недоступна → false, следующий ежечасный тик
 * доберёт. Дубли давит детерминированный jobId: пока джоба этой брони на
 * эту дату жива (completed хранится 14 суток), повторный add — no-op.
 */
export async function enqueueReminderGuest(data: ReminderGuestMailJobData): Promise<boolean> {
  try {
    const queue = await getMailQueue();
    await queue.add("reminder-guest", data, {
      jobId: reminderGuestJobId(data.bookingId, new Date(data.occasionDate)),
      attempts: 3,
      backoff: { type: "exponential", delay: 3_000 },
      removeOnComplete: MAIL_KEEP_COMPLETED,
      removeOnFail: 5_000,
    });
    return true;
  } catch (error) {
    console.warn(
      `queues: mail недоступна — бронь ${data.bookingId} пока без напоминания (тик повторит)`,
      error instanceof Error ? error.message : error,
    );
    return false;
  }
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
