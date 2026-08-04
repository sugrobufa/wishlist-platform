import "dotenv/config";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";
import { IMAGE_INGEST_QUEUE_NAME, MAIL_QUEUE_NAME } from "../server/queues";
import { processImageIngest } from "./image-ingest";

// Очереди по ARCHITECTURE §13. Phase 0 — очередь mail и демо-джоба,
// чтобы был виден полный цикл enqueue → process.
// Тикет 06 — image.ingest: фото товара по ссылке скачивается в своё S3;
// логика — в чистой функции processImageIngest (тестируется напрямую),
// здесь только регистрация.
async function main() {
  const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });

  const mailQueue = new Queue(MAIL_QUEUE_NAME, { connection });

  const mailWorker = new Worker(
    MAIL_QUEUE_NAME,
    async (job) => {
      console.log(`[mail] processing job ${job.id} (${job.name}):`, JSON.stringify(job.data));
    },
    { connection },
  );

  mailWorker.on("completed", (job) => console.log(`[mail] completed ${job.id}`));
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

  console.log("Worker started. Queues: mail, image.ingest");

  await mailQueue.add("hello", { message: "worker is alive" });

  const shutdown = async () => {
    console.log("Worker shutting down…");
    await mailWorker.close();
    await imageWorker.close();
    await mailQueue.close();
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
