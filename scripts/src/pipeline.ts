/**
 * Monthly Common Crawl release pipeline.
 *
 * Runs every sync step in order for the latest web-graph release:
 *   1. domain ranks (flips the current_release pointer atomically)
 *   2. edges (referring/outbound domains for watchlist domains)
 *   3. subdomain counts
 *   4. history backfill for watchlist domains
 *
 * Step 1 failing aborts the pipeline (later steps depend on the release
 * pointer). Failures in steps 2–4 are logged but don't block the others —
 * each of those is independently resumable/idempotent on the next run.
 *
 * Used by the api-server's release watcher (automatic monthly processing)
 * and runnable manually via `pnpm --filter @workspace/scripts run sync:all`.
 */
import { pool } from "@workspace/db";
import { runCommonCrawlSync } from "./sync-common-crawl";
import { runEdgesSync } from "./sync-edges";
import { runSubdomainsSync } from "./sync-subdomains";
import { runHistoryBackfill } from "./backfill-history";

export interface PipelineResult {
  ok: boolean;
  /** True when another process already holds the pipeline lock — nothing ran. */
  skipped?: boolean;
  steps: { name: string; ok: boolean; error?: string; seconds: number }[];
}

// Arbitrary but fixed app-wide key for the Postgres advisory lock that
// serializes pipeline runs across processes (api-server watcher, manual CLI,
// multiple deployment instances). Session-level lock, so it's held on one
// dedicated client connection for the duration of the run and released even
// if the process dies (Postgres frees session locks on disconnect).
const PIPELINE_LOCK_KEY = 823_471_902;

type Logger = (message: string, extra?: Record<string, unknown>) => void;

const defaultLog: Logger = (message, extra = {}) => {
  process.stdout.write(
    JSON.stringify({ time: new Date().toISOString(), message, ...extra }) +
      "\n",
  );
};

export async function runMonthlyPipeline(
  log: Logger = defaultLog,
): Promise<PipelineResult> {
  const lockClient = await pool.connect();
  try {
    const { rows } = await lockClient.query(
      "SELECT pg_try_advisory_lock($1) AS locked",
      [PIPELINE_LOCK_KEY],
    );
    if (!rows[0]?.locked) {
      log("pipeline skipped: another run already holds the lock");
      return { ok: true, skipped: true, steps: [] };
    }
    log("pipeline lock acquired", { pid: process.pid });
    return await runPipelineSteps(log);
  } finally {
    try {
      await lockClient.query("SELECT pg_advisory_unlock($1)", [
        PIPELINE_LOCK_KEY,
      ]);
    } catch {
      // Connection may already be gone; session close releases the lock.
    }
    lockClient.release();
  }
}

async function runPipelineSteps(log: Logger): Promise<PipelineResult> {
  const steps: PipelineResult["steps"] = [];
  const runStep = async (name: string, fn: () => Promise<unknown>) => {
    const t0 = Date.now();
    try {
      log(`pipeline step starting: ${name}`);
      await fn();
      steps.push({ name, ok: true, seconds: Math.round((Date.now() - t0) / 1000) });
      return true;
    } catch (err) {
      steps.push({
        name,
        ok: false,
        error: String(err),
        seconds: Math.round((Date.now() - t0) / 1000),
      });
      log(`pipeline step failed: ${name}`, { error: String(err) });
      return false;
    }
  };

  const ranksOk = await runStep("domain-ranks", runCommonCrawlSync);
  if (!ranksOk) {
    return { ok: false, steps };
  }
  await runStep("edges", runEdgesSync);
  await runStep("subdomains", runSubdomainsSync);
  await runStep("history-backfill", runHistoryBackfill);

  const ok = steps.every((s) => s.ok);
  log("pipeline finished", { ok, steps });
  return { ok, steps };
}
