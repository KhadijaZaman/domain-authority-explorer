/**
 * Automatic monthly Common Crawl release watcher.
 *
 * Common Crawl publishes a new web-graph release roughly monthly/quarterly.
 * This watcher makes ingestion fully automatic — no manual script runs:
 *
 * - On server boot (after a short delay) and every CHECK_INTERVAL (12h), it
 *   fetches graphinfo.json and compares the newest release id against
 *   sync_meta.last_processed_release.
 * - If a new release appeared, it runs the full pipeline in-process:
 *   domain ranks -> edges -> subdomains -> history backfill.
 * - A mutex prevents overlapping runs; failures back off for FAIL_COOLDOWN
 *   (6h) so a broken release doesn't hot-loop expensive downloads.
 *
 * The boot-time check matters for autoscale deployments: timers don't fire
 * while the instance is asleep, but any traffic wakes it and triggers a check.
 */
import { db, syncMetaTable } from "@workspace/db";
import { runMonthlyPipeline } from "@workspace/scripts/pipeline";
import { logger } from "./lib/logger";

const GRAPHINFO_URL = "https://index.commoncrawl.org/graphinfo.json";
const BOOT_DELAY_MS = 30_000;
const CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12h
const FAIL_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 6h

interface GraphInfo {
  id: string;
  crawls?: string[];
}

let running = false;
let lastFailureAt = 0;

async function latestReleaseId(): Promise<string | null> {
  const res = await fetch(GRAPHINFO_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status} from graphinfo.json`);
  const releases = (await res.json()) as GraphInfo[];
  if (!Array.isArray(releases) || releases.length === 0) return null;
  const key = (g: GraphInfo) =>
    (g.crawls && g.crawls.length ? [...g.crawls].sort().at(-1)! : "") + g.id;
  return [...releases].sort((a, b) => (key(a) < key(b) ? 1 : -1))[0].id;
}

export async function checkForNewRelease(): Promise<void> {
  if (running) return;
  if (Date.now() - lastFailureAt < FAIL_COOLDOWN_MS) return;
  running = true;
  try {
    const latest = await latestReleaseId();
    if (!latest) return;
    const [meta] = await db.select().from(syncMetaTable).limit(1);
    if (meta?.lastProcessedRelease === latest) {
      logger.debug({ release: latest }, "release watcher: up to date");
      return;
    }
    logger.info(
      { latest, current: meta?.lastProcessedRelease ?? null },
      "release watcher: new Common Crawl release detected, running pipeline",
    );
    const result = await runMonthlyPipeline((message, extra = {}) =>
      logger.info(extra, `release pipeline: ${message}`),
    );
    if (!result.ok) {
      lastFailureAt = Date.now();
      logger.error({ steps: result.steps }, "release pipeline had failures");
    } else {
      logger.info({ release: latest }, "release pipeline complete");
    }
  } catch (err) {
    lastFailureAt = Date.now();
    logger.error({ err }, "release watcher check failed");
  } finally {
    running = false;
  }
}

export function startReleaseWatcher(): void {
  const boot = setTimeout(() => void checkForNewRelease(), BOOT_DELAY_MS);
  boot.unref();
  const interval = setInterval(
    () => void checkForNewRelease(),
    CHECK_INTERVAL_MS,
  );
  interval.unref();
  logger.info(
    { checkIntervalHours: CHECK_INTERVAL_MS / 3_600_000 },
    "release watcher started",
  );
}
