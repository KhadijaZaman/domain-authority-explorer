/**
 * Common Crawl web graph sync job.
 *
 * Intended to run on a monthly schedule (e.g. a Replit Scheduled Deployment)
 * but can also be run manually:
 *
 *   pnpm --filter @workspace/scripts run sync
 *
 * Behavior:
 * 1. Fetches the release list from index.commoncrawl.org/graphinfo.json (the
 *    JSON feed behind web-graphs-index.html) and picks the newest release.
 * 2. Compares it to the stored last_processed_release; if they match, logs
 *    "already up to date" and exits without downloading anything.
 * 3. Otherwise stream-downloads <release>-domain-ranks.txt.gz (which contains
 *    harmonic centrality rank/value, PageRank-style rank/value AND the
 *    reversed domain name, so no join with the vertices file is needed) and
 *    decompresses it as a stream — the multi-GB file is never fully loaded
 *    into memory or written to disk. The much larger edges file is skipped.
 * 4. Converts reversed domain notation (com.example -> example.com) and
 *    normalizes both centrality ranks into 0-100 percentile scores against
 *    the FULL release size (from graphinfo.json stats), labeled
 *    "Common Crawl Authority Score" and "Common Crawl Popularity Score".
 * 5. Loads rows under the new release name, then atomically flips the
 *    current_release pointer in a transaction, so the live app never serves a
 *    half-loaded dataset. The previous release's rows are kept as an archive;
 *    anything older is pruned.
 * 6. Appends new-release scores to lookups_history for every domain users
 *    have previously looked up (historical trend feature).
 * 7. Downloads are wrapped in retry-with-backoff and the load is idempotent
 *    (a partial failure can safely re-run: rows for the in-flight release are
 *    cleared first).
 *
 * Env vars:
 *   SYNC_LIMIT  — max number of top-ranked domains to ingest (default 1000000).
 *                 The full release has ~120M domains; the ranks file is sorted
 *                 by harmonic centrality, so ingesting the top N keeps the most
 *                 relevant domains while staying fast and small. Scores are
 *                 exact percentiles regardless of the limit because they are
 *                 computed against the full release size.
 *   FORCE_SYNC  — set to "1" to re-sync even if the release was already processed.
 */
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { sql, eq, inArray, notInArray } from "drizzle-orm";
import {
  db,
  pool,
  domainRanksTable,
  syncMetaTable,
  lookupsTable,
  lookupsHistoryTable,
} from "@workspace/db";

const GRAPHINFO_URL = "https://index.commoncrawl.org/graphinfo.json";
const DATA_BASE = "https://data.commoncrawl.org/projects/hyperlinkgraph";
const SYNC_LIMIT = Math.max(1, Number(process.env.SYNC_LIMIT ?? 1_000_000));
const BATCH_SIZE = 2_000;

interface GraphInfo {
  id: string;
  crawls?: string[];
  stats?: { domain?: { nodes?: number } };
}

function log(message: string, extra: Record<string, unknown> = {}) {
  const line = { time: new Date().toISOString(), message, ...extra };
  process.stdout.write(JSON.stringify(line) + "\n");
}

async function retryWithBackoff<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 4,
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const delay = 2 ** i * 2000;
      log(`retry: ${label} failed, backing off`, {
        attempt: i + 1,
        delayMs: delay,
        error: String(err),
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/** com.example.sub -> sub.example.com */
function unreverseDomain(rev: string): string {
  return rev.split(".").reverse().join(".");
}

/** Derive a human-readable period from a release id like cc-main-2026-apr-may-jun. */
function releasePeriod(releaseId: string): string {
  const m = releaseId.match(/^cc-main-(\d{4})-(.+)$/);
  if (!m) return releaseId;
  const months = m[2]
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
  return `${months.join("\u2013")} ${m[1]}`;
}

/**
 * Normalize a 1-based rank into a 0-100 score against the full release size.
 * Uses a log-rank scale (rank 1 => 100, last rank => 0) rather than a linear
 * percentile: web centrality is so heavy-tailed that a linear percentile
 * would score every domain in the top million as "100", making the number
 * meaningless. Log-rank is how DA-style tools keep the 0-100 range useful.
 */
function percentileScore(pos: number, total: number): number {
  if (pos <= 1) return 100;
  const score = (1 - Math.log(pos) / Math.log(total)) * 100;
  return Math.round(Math.max(0, Math.min(100, score)) * 100) / 100;
}

async function fetchLatestRelease(): Promise<GraphInfo> {
  return retryWithBackoff("fetch graphinfo.json", async () => {
    const res = await fetch(GRAPHINFO_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status} from graphinfo.json`);
    const releases = (await res.json()) as GraphInfo[];
    if (!Array.isArray(releases) || releases.length === 0) {
      throw new Error("graphinfo.json returned no releases");
    }
    // The feed is newest-first, but don't rely on it: prefer the entry whose
    // latest contributing crawl id (CC-MAIN-YYYY-WW) is greatest.
    const key = (g: GraphInfo) =>
      (g.crawls && g.crawls.length ? [...g.crawls].sort().at(-1)! : "") + g.id;
    return [...releases].sort((a, b) => (key(a) < key(b) ? 1 : -1))[0];
  });
}

async function getMeta() {
  const [meta] = await db.select().from(syncMetaTable).limit(1);
  if (meta) return meta;
  const [created] = await db.insert(syncMetaTable).values({}).returning();
  return created;
}

async function streamRanks(release: string, totalDomains: number) {
  const url = `${DATA_BASE}/${release}/domain/${release}-domain-ranks.txt.gz`;
  log("downloading ranks file (streamed)", { url, limit: SYNC_LIMIT });

  const res = await retryWithBackoff("download domain-ranks", async () => {
    const r = await fetch(url);
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} for ${url}`);
    return r;
  });

  const gunzip = createGunzip();
  const body = Readable.fromWeb(res.body as never);
  body.pipe(gunzip);
  // Abort cleanly once we have enough rows — swallow the resulting stream errors.
  body.on("error", () => undefined);
  gunzip.on("error", () => undefined);

  const rl = createInterface({ input: gunzip, crlfDelay: Infinity });

  let header: string[] | null = null;
  let cols = { hcPos: 0, hcVal: 1, prPos: 2, prVal: 3, rev: 4 };
  let inserted = 0;
  let batch: (typeof domainRanksTable.$inferInsert)[] = [];

  const flush = async () => {
    if (batch.length === 0) return;
    await db
      .insert(domainRanksTable)
      .values(batch)
      .onConflictDoNothing({
        target: [domainRanksTable.releaseName, domainRanksTable.domain],
      });
    inserted += batch.length;
    batch = [];
    if (inserted % 20_000 === 0) log("progress", { inserted });
  };

  for await (const line of rl) {
    if (line.startsWith("#")) {
      header = line.slice(1).split("\t").map((h) => h.replace(/^#/, ""));
      const idx = (name: string, fallback: number) => {
        const i = header!.findIndex((h) => h === name);
        return i >= 0 ? i : fallback;
      };
      cols = {
        hcPos: idx("harmonicc_pos", 0),
        hcVal: idx("harmonicc_val", 1),
        prPos: idx("pr_pos", 2),
        prVal: idx("pr_val", 3),
        rev: idx("host_rev", 4),
      };
      continue;
    }
    const parts = line.split("\t");
    if (parts.length < 5) continue;
    const harmonicPos = Number(parts[cols.hcPos]);
    const pagerankPos = Number(parts[cols.prPos]);
    const rev = parts[cols.rev];
    if (!Number.isFinite(harmonicPos) || !rev) continue;

    batch.push({
      releaseName: release,
      domain: unreverseDomain(rev),
      harmonicPos,
      harmonicVal: Number(parts[cols.hcVal]) || 0,
      pagerankPos: Number.isFinite(pagerankPos) ? pagerankPos : harmonicPos,
      pagerankVal: Number(parts[cols.prVal]) || 0,
      authorityScore: percentileScore(harmonicPos, totalDomains),
      popularityScore: percentileScore(
        Number.isFinite(pagerankPos) ? pagerankPos : harmonicPos,
        totalDomains,
      ),
    });

    if (batch.length >= BATCH_SIZE) await flush();
    if (inserted + batch.length >= SYNC_LIMIT) break;
  }
  await flush();
  rl.close();
  body.destroy();
  return inserted;
}

export async function runCommonCrawlSync() {
  const startedAt = Date.now();
  const latest = await fetchLatestRelease();
  const release = latest.id;
  const totalDomains = latest.stats?.domain?.nodes ?? null;
  log("latest release", { release, totalDomains });

  if (!totalDomains) {
    throw new Error(
      `Release ${release} has no domain node count in graphinfo.json; refusing to compute percentile scores without it.`,
    );
  }

  const meta = await getMeta();
  if (meta.lastProcessedRelease === release && process.env.FORCE_SYNC !== "1") {
    log("already up to date", { release });
    return;
  }

  const previousRelease = meta.currentRelease;

  // Idempotent re-run: clear any partial rows for this release before loading.
  await db
    .delete(domainRanksTable)
    .where(eq(domainRanksTable.releaseName, release));

  const loaded = await streamRanks(release, totalDomains);
  log("load complete", { release, loaded });

  // Atomic swap: flip the current_release pointer only after the load is
  // confirmed complete, then append history for previously looked-up domains.
  await db.transaction(async (tx) => {
    await tx
      .update(syncMetaTable)
      .set({
        currentRelease: release,
        lastProcessedRelease: release,
        releaseDate: releasePeriod(release),
        lastSyncedAt: new Date(),
        domainCount: loaded,
        totalDomainsInRelease: totalDomains,
      })
      .where(eq(syncMetaTable.id, meta.id));

    // Append this release's scores for every domain users have looked up before.
    await tx.execute(sql`
      INSERT INTO lookups_history (domain, release_name, authority_score, popularity_score)
      SELECT dr.domain, dr.release_name, dr.authority_score, dr.popularity_score
      FROM domain_ranks dr
      WHERE dr.release_name = ${release}
        AND dr.domain IN (SELECT DISTINCT l.domain FROM lookups l)
      ON CONFLICT (domain, release_name) DO NOTHING
    `);
  });

  // Archive policy: keep the previous release's rows, prune anything older.
  const keep = [release, previousRelease].filter(
    (r): r is string => typeof r === "string" && r.length > 0,
  );
  await db
    .delete(domainRanksTable)
    .where(notInArray(domainRanksTable.releaseName, keep));

  const seconds = Math.round((Date.now() - startedAt) / 1000);
  log("sync finished", { release, domainsLoaded: loaded, seconds });
}

// Run as CLI only when executed directly (tsx ./src/sync-common-crawl.ts);
// when imported (e.g. by the api-server release watcher) nothing runs.
if (process.argv[1]?.endsWith("sync-common-crawl.ts")) {
  runCommonCrawlSync()
    .then(async () => {
      await pool.end();
    })
    .catch(async (err) => {
      log("sync failed", { error: String(err) });
      await pool.end();
      process.exit(1);
    });
}
