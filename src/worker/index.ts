import "dotenv/config";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

// Очереди по ARCHITECTURE §13. Phase 0 — очередь mail и демо-джоба,
// чтобы был виден полный цикл enqueue → process.
async function main() {
  const connection = new IORedis(process.env.REDIS_URL ?? "redis://localhost:6379", {
    maxRetriesPerRequest: null,
  });

  const mailQueue = new Queue("mail", { connection });

  const mailWorker = new Worker(
    "mail",
    async (job) => {
      console.log(`[mail] processing job ${job.id} (${job.name}):`, JSON.stringify(job.data));
    },
    { connection },
  );

  mailWorker.on("completed", (job) => console.log(`[mail] completed ${job.id}`));
  mailWorker.on("failed", (job, err) => console.error(`[mail] failed ${job?.id}:`, err.message));

  console.log("Worker started. Queues: mail");

  await mailQueue.add("hello", { message: "worker is alive" });

  const shutdown = async () => {
    console.log("Worker shutting down…");
    await mailWorker.close();
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
