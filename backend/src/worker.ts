import "dotenv/config";
import PgBoss from "pg-boss";
import { initSentry, runJob } from "./lib/sentry";
import { endPool } from "./lib/db";
import { closeBrowser } from "./worker/lib/browser";
import { Q, type GenerateContentPayload, type ImportProductPayload, type NotifyDispatchPayload, type ProcessImagePayload, type SyncProductPayload } from "./worker/queues";
import { handleImportProduct, sweepImportJobs } from "./worker/jobs/import-product";
import { handleSyncProduct, handleSyncTick } from "./worker/jobs/sync";
import { handleGenerateContent } from "./worker/jobs/generate-content";
import { handleProcessImage } from "./worker/jobs/process-image";
import { handleNotifyDispatch } from "./worker/jobs/dispatch-notification";

/**
 * Loqta worker — the only component that scrapes, syncs, and writes to the
 * shared source catalog. Runs anywhere Docker runs (Railway/Fly/VPS).
 *
 * Queue layer: pg-boss (lives inside the same Supabase Postgres, schema
 * `pgboss` — no Redis, one less moving part).
 */
initSentry("worker");

async function main() {
  const boss = new PgBoss({
    connectionString: process.env.DATABASE_URL!,
    schema: "pgboss",
  });
  boss.on("error", (err) => console.error("[pg-boss]", err));

  await boss.start();
  for (const name of Object.values(Q)) await boss.createQueue(name);

  // ---- workers -------------------------------------------------------
  // Every handler runs through runJob: errors reach Sentry tagged with
  // queue/jobId/payload ids, then rethrow so pg-boss owns retries.
  await boss.work<ImportProductPayload>(Q.importProduct, { batchSize: 3 }, async (jobs) => {
    for (const job of jobs)
      await runJob(Q.importProduct, job.id, { importJobId: job.data.importJobId }, () =>
        handleImportProduct(job.data, boss),
      );
  });

  await boss.work<SyncProductPayload>(Q.syncProduct, { batchSize: 3 }, async (jobs) => {
    for (const job of jobs)
      await runJob(Q.syncProduct, job.id, { sourceProductId: job.data.sourceProductId }, () =>
        handleSyncProduct(job.data),
      );
  });

  await boss.work(Q.syncTick, async (jobs) => {
    await runJob(Q.syncTick, jobs[0]?.id ?? "tick", {}, () => handleSyncTick(boss));
  });

  await boss.work<GenerateContentPayload>(Q.generateContent, { batchSize: 2 }, async (jobs) => {
    for (const job of jobs)
      await runJob(Q.generateContent, job.id, { listingId: job.data.listingId }, () =>
        handleGenerateContent(job.data),
      );
  });

  await boss.work<ProcessImagePayload>(Q.processImage, { batchSize: 2 }, async (jobs) => {
    for (const job of jobs)
      await runJob(Q.processImage, job.id, { listingId: job.data.listingId }, () =>
        handleProcessImage(job.data),
      );
  });

  await boss.work<NotifyDispatchPayload>(Q.notifyDispatch, { batchSize: 5 }, async (jobs) => {
    for (const job of jobs)
      await runJob(Q.notifyDispatch, job.id, { notificationId: job.data.notificationId }, () =>
        handleNotifyDispatch(job.data),
      );
  });

  // ---- schedules -----------------------------------------------------
  await boss.schedule(Q.syncTick, "*/15 * * * *"); // tiered fan-out every 15 min

  // ---- import intake sweep (web -> worker boundary) -------------------
  const sweepMs = Number(process.env.IMPORT_SWEEP_MS ?? 5000);
  const sweepTimer = setInterval(() => {
    sweepImportJobs(boss).catch((err) => console.error("[sweep]", err));
  }, sweepMs);

  console.log(`لقطة worker up — sweeping imports every ${sweepMs}ms, sync tick */15m`);

  // ---- graceful shutdown ----------------------------------------------
  const shutdown = async (signal: string) => {
    console.log(`\n${signal} — shutting down...`);
    clearInterval(sweepTimer);
    await boss.stop({ graceful: true, timeout: 15_000 }).catch(() => {});
    await closeBrowser();
    await endPool();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("worker failed to start:", err);
  process.exit(1);
});
