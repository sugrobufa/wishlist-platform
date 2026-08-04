import "dotenv/config";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import {
  IMAGE_INGEST_QUEUE_NAME,
  MAIL_KEEP_COMPLETED,
  MAIL_QUEUE_NAME,
  OCCASION_CLOSE_QUEUE_NAME,
} from "../server/queues";
import { processImageIngest } from "./image-ingest";
import { processMailJob } from "./mail";
import type { MailJobResult } from "./mail";
import { processOccasionClose } from "./occasion-close";
import { processReminderTick } from "./reminders";
import type { ReminderTickResult } from "./reminders";

// Очереди по ARCHITECTURE §13. Phase 0 — очередь mail и демо-джоба,
// чтобы был виден полный цикл enqueue → process.
// Тикет 06 — image.ingest: фото товара по ссылке скачивается в своё S3;
// логика — в чистой функции processImageIngest (тестируется напрямую),
// здесь только регистрация.
// Тикет 10 — occasion.close: repeat-джоба раз в час закрывает прошедшие
// праздники (processOccasionClose — чистая функция под тестом).
// Тикет 12 — очередь mail по-настоящему шлёт письма (processMailJob) и несёт
// ежечасный тик напоминаний reminder-tick (processReminderTick) — новых имён
// очередей вне ARCHITECTURE §13 не заводим, роутинг по имени джобы здесь.

function mailJobSummary(result: MailJobResult | ReminderTickResult): string {
  if (!("status" in result)) {
    const failures = result.failed.length > 0 ? `, недоступна очередь: ${result.failed.length}` : "";
    return `tick: напоминаний поставлено ${result.enqueued.length}${failures}`;
  }
  return result.status === "sent" ? "sent" : `skipped (${result.reason})`;
}

async function main() {
  const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });

  // removeOnComplete по возрасту — окно дедупликации напоминаний (см.
  // MAIL_KEEP_COMPLETED в queues.ts); распространяется и на hello/тик.
  const mailQueue = new Queue(MAIL_QUEUE_NAME, {
    connection,
    defaultJobOptions: { removeOnComplete: MAIL_KEEP_COMPLETED, removeOnFail: 5_000 },
  });

  // reminder-tick: планировщик BullMQ держит ровно одну повторяющуюся джобу
  // (upsert — рестарт воркера не плодит дублей); сдвиг на :30 разводит тик
  // с occasion-close (:00) — часовые джобы не толпятся в одну минуту.
  await mailQueue.upsertJobScheduler(
    "reminder-tick-hourly",
    { pattern: "30 * * * *" },
    { name: "reminder-tick" },
  );

  const mailWorker = new Worker(
    MAIL_QUEUE_NAME,
    async (job): Promise<MailJobResult | ReminderTickResult> => {
      if (job.name === "reminder-tick") return processReminderTick();
      return processMailJob(job.name, job.data);
    },
    { connection },
  );

  mailWorker.on("completed", (job, result) =>
    console.log(`[mail] completed ${job.id} (${job.name}): ${mailJobSummary(result)}`),
  );
  mailWorker.on("failed", (job, err) => console.error(`[mail] failed ${job?.id}:`, err.message));

  const imageWorker = new Worker(
    IMAGE_INGEST_QUEUE_NAME,
    async (job) => processImageIngest(job.data),
    { connection, concurrency: 2 },
  );

  imageWorker.on("completed", (job, result) => {
    const summary =
      result.status === "stored" ? `stored → ${result.photoKey}` : `skipped (${result.reason})`;
    console.log(`[image.ingest] completed ${job.id}: ${summary}`);
  });
  imageWorker.on("failed", (job, err) =>
    console.error(`[image.ingest] failed ${job?.id} (attempt ${job?.attemptsMade}):`, err.message),
  );

  // occasion.close: планировщик BullMQ сам держит ровно одну повторяющуюся
  // джобу (upsert — рестарт воркера не плодит дублей), тик — каждый час.
  const occasionQueue = new Queue(OCCASION_CLOSE_QUEUE_NAME, { connection });
  await occasionQueue.upsertJobScheduler(
    "occasion-close-hourly",
    { pattern: "0 * * * *" },
    { name: "close" },
  );

  const occasionWorker = new Worker(
    OCCASION_CLOSE_QUEUE_NAME,
    async () => processOccasionClose(),
    { connection },
  );

  occasionWorker.on("completed", (job, result) => {
    const failures = result.failed.length > 0 ? `, failed ${result.failed.length}` : "";
    console.log(`[occasion.close] completed ${job.id}: closed ${result.closed.length}${failures}`);
  });
  occasionWorker.on("failed", (job, err) =>
    console.error(`[occasion.close] failed ${job?.id}:`, err.message),
  );

  console.log("Worker started. Queues: mail (+reminder-tick), image.ingest, occasion.close");

  await mailQueue.add("hello", { message: "worker is alive" });

  const shutdown = async () => {
    console.log("Worker shutting down…");
    await mailWorker.close();
    await imageWorker.close();
    await occasionWorker.close();
    await mailQueue.close();
    await occasionQueue.close();
    connection.disconnect();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
