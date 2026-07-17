/**
 * Historical score backfill.
 *
 * Walks every Common Crawl web-graph release from BACKFILL_FROM_YEAR (default
 * 2023) onward and records authority/popularity scores for every domain users
 * have looked up (the watchlist), writing them into lookups_history so the
 * history chart shows a multi-year trend.
 *
 *   pnpm --filter @workspace/scripts run sync:backfill
 *
 * Design notes:
 * - Only the top BACKFILL_LIMIT (default 1M) lines of each release's ranks
 *   file are streamed (the file is sorted by harmonic rank, so this is a
 *   cheap early-abort download of ~15 MB gz per release, not the full multi-GB
 *   file). Watchlist domains outside the top slice simply get no point for
 *   that release — same coverage rule as the live dataset.
 * - Scores use the exact same log-rank formula as the live sync, computed
 *   against the FULL release size from graphinfo.json, so points are
 *   comparable across releases.
 * - recordedAt is set to the release period's end (15th of the last crawl
 *   month) so the existing order-by-recordedAt history endpoint charts a
 *   correct timeline.
 * - Idempotent + resumable: every scanned (release, domain) pair is recorded —
 *   found domains get a real history row, absent ones get an
 *   `__absent__:<domain>` marker row (invisible to the history endpoint,
 *   which queries by exact domain). A release is rescanned only for watchlist
 *   domains with neither, so newly looked-up domains get their history on the
 *   next run without FORCE_BACKFILL. Inserts are ON CONFLICT DO NOTHING.
 *
 * Env vars:
 *   BACKFILL_FROM_YEAR — earliest release year to include (default 2023)
 *   BACKFILL_LIMIT     — top-N lines to scan per release (default 1000000)
 *   BACKFILL_MAX_RELEASES — cap on releases processed this run (default all)
 *   FORCE_BACKFILL     — "1" to rescan releases even if they look covered
 */
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { sql, eq, inArray } from "drizzle-orm";
import { db, pool, lookupsTable, lookupsHistoryTable } from "@workspace/db";

const GRAPHINFO_URL = "https://index.commoncrawl.org/graphinfo.json";
const DATA_BASE = "https://data.commoncrawl.org/projects/hyperlinkgraph";
const FROM_YEAR = Number(process.env.BACKFILL_FROM_YEAR ?? 2023);
const LIMIT = Math.max(1, Number(process.env.BACKFILL_LIMIT ?? 1_000_000));
const MAX_RELEASES = Number(process.env.BACKFILL_MAX_RELEASES ?? Infinity);

interface GraphInfo {
  id: string;
  crawls?: string[];
  stats?: { domain?: { nodes?: number } };
}

function log(message: string, extra: Record<string, unknown> = {}) {
  process.stdout.write(
    JSON.stringify({ time: new Date().toISOString(), message, ...extra }) +
      "\n",
  );
}

/** com.example -> example.com */
function unreverseDomain(rev: string): string {
  return rev.split(".").reverse().join(".");
}

/** Same log-rank formula as the live sync — keep in lockstep. */
function percentileScore(pos: number, total: number): number {
  if (pos <= 1) return 100;
  const score = (1 - Math.log(pos) / Math.log(total)) * 100;
  return Math.round(Math.max(0, Math.min(100, score)) * 100) / 100;
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Release id -> { year, endDate } using the LAST crawl month.
 * Handles both `cc-main-2026-apr-may-jun` and year-spanning
 * `cc-main-2025-26-dec-jan-feb` (last month rolls into the second year).
 */
function releaseInfo(id: string): { year: number; endDate: Date } | null {
  const m = id.match(/^cc-main-(\d{4})(?:-(\d{2}))?-([a-z-]+)$/);
  if (!m) return null;
  const y1 = Number(m[1]);
  const y2 = m[2] ? Number(m[1].slice(0, 2) + m[2]) : null;
  const monthNames = m[3].split("-").filter((s) => s in MONTHS);
  if (monthNames.length === 0) return null;
  const first = MONTHS[monthNames[0]!]!;
  const last = MONTHS[monthNames[monthNames.length - 1]!]!;
  const endYear = y2 !== null && last < first ? y2 : y1;
  return { year: endYear, endDate: new Date(Date.UTC(endYear, last - 1, 15)) };
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

async function scanRelease(
  release: string,
  totalDomains: number,
  watch: Set<string>,
): Promise<Map<string, { hcPos: number; prPos: number }> | null> {
  const url = `${DATA_BASE}/${release}/domain/${release}-domain-ranks.txt.gz`;
  const res = await retryWithBackoff(`download ${release}`, async () => {
    const r = await fetch(url);
    // Some early releases (2017) never published domain-level ranks —
    // a 404 means the file doesn't exist, not a transient failure.
    if (r.status === 404) return null;
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} for ${url}`);
    return r;
  });
  if (res === null) return null;

  const gunzip = createGunzip();
  const body = Readable.fromWeb(res.body as never);
  body.pipe(gunzip);
  body.on("error", () => undefined);
  gunzip.on("error", () => undefined);
  const rl = createInterface({ input: gunzip, crlfDelay: Infinity });

  const found = new Map<string, { hcPos: number; prPos: number }>();
  let cols = { hcPos: 0, prPos: 2, rev: 4 };
  let lines = 0;
  for await (const line of rl) {
    if (line.startsWith("#")) {
      const header = line.slice(1).split("\t").map((h) => h.replace(/^#/, ""));
      const idx = (name: string, fallback: number) => {
        const i = header.findIndex((h) => h === name);
        return i >= 0 ? i : fallback;
      };
      cols = {
        hcPos: idx("harmonicc_pos", 0),
        prPos: idx("pr_pos", 2),
        rev: idx("host_rev", 4),
      };
      continue;
    }
    const parts = line.split("\t");
    const rev = parts[cols.rev];
    if (!rev) continue;
    lines++;
    const domain = unreverseDomain(rev);
    if (watch.has(domain) && !found.has(domain)) {
      const hcPos = Number(parts[cols.hcPos]);
      const prPos = Number(parts[cols.prPos]);
      if (Number.isFinite(hcPos)) {
        found.set(domain, {
          hcPos,
          prPos: Number.isFinite(prPos) ? prPos : hcPos,
        });
      }
    }
    if (lines >= LIMIT || found.size === watch.size) break;
  }
  rl.close();
  body.destroy();
  return found;
}

export async function runHistoryBackfill() {
  const startedAt = Date.now();

  // Watchlist: every domain successfully looked up by users.
  const lookupRows = await db
    .selectDistinct({ domain: lookupsTable.domain })
    .from(lookupsTable)
    .where(eq(lookupsTable.found, true));
  const watch = new Set(lookupRows.map((r) => r.domain));
  if (watch.size === 0) {
    log("no looked-up domains yet — nothing to backfill");
    return;
  }
  log("watchlist built", { size: watch.size });

  const res = await retryWithBackoff("fetch graphinfo.json", async () => {
    const r = await fetch(GRAPHINFO_URL);
    if (!r.ok) throw new Error(`HTTP ${r.status} from graphinfo.json`);
    return (await r.json()) as GraphInfo[];
  });

  const releases = res
    .map((g) => ({ g, info: releaseInfo(g.id) }))
    .filter(
      (
        x,
      ): x is { g: GraphInfo; info: { year: number; endDate: Date } } =>
        x.info !== null && x.info.year >= FROM_YEAR,
    )
    .sort((a, b) => a.info.endDate.getTime() - b.info.endDate.getTime());
  log("releases in range", {
    count: releases.length,
    from: releases[0]?.g.id,
    to: releases.at(-1)?.g.id,
  });

  // Which (release, domain) pairs were already scanned? A pair counts as
  // covered when it has a real history row OR an "__absent__:<domain>"
  // marker (the domain was scanned for but not present in that release).
  const existing = await db
    .select({
      releaseName: lookupsHistoryTable.releaseName,
      domain: lookupsHistoryTable.domain,
    })
    .from(lookupsHistoryTable)
    .where(
      inArray(lookupsHistoryTable.domain, [
        ...watch,
        ...[...watch].map((d) => `__absent__:${d}`),
      ]),
    );
  const covered = new Map<string, Set<string>>();
  for (const e of existing) {
    const s = covered.get(e.releaseName) ?? new Set<string>();
    s.add(e.domain.replace(/^__absent__:/, ""));
    covered.set(e.releaseName, s);
  }

  let processed = 0;
  for (const { g, info } of releases) {
    if (processed >= MAX_RELEASES) {
      log("BACKFILL_MAX_RELEASES reached — stopping (re-run to continue)");
      break;
    }
    const done =
      process.env.FORCE_BACKFILL === "1"
        ? new Set<string>()
        : (covered.get(g.id) ?? new Set<string>());
    const toScan = new Set([...watch].filter((d) => !done.has(d)));
    if (toScan.size === 0) {
      log("release fully covered — skipping", { release: g.id });
      continue;
    }

    const total = g.stats?.domain?.nodes;
    if (!total) {
      log("release missing domain node count — skipping", { release: g.id });
      continue;
    }

    const t0 = Date.now();
    const found = await scanRelease(g.id, total, toScan);
    if (found === null) {
      log("release has no domain ranks file — skipping", { release: g.id });
      continue;
    }
    const values = [...toScan].map((domain) => {
      const p = found.get(domain);
      return p
        ? {
            domain,
            releaseName: g.id,
            authorityScore: percentileScore(p.hcPos, total),
            popularityScore: percentileScore(p.prPos, total),
            recordedAt: info.endDate,
          }
        : {
            // Scanned but not present in this release — marker row so resume
            // logic doesn't rescan; invisible to the history endpoint.
            domain: `__absent__:${domain}`,
            releaseName: g.id,
            authorityScore: 0,
            popularityScore: 0,
            recordedAt: info.endDate,
          };
    });
    await db.insert(lookupsHistoryTable).values(values).onConflictDoNothing();
    processed++;
    log("release backfilled", {
      release: g.id,
      scanned: toScan.size,
      matched: found.size,
      seconds: Math.round((Date.now() - t0) / 1000),
    });
  }

  log("backfill finished", {
    releasesProcessed: processed,
    seconds: Math.round((Date.now() - startedAt) / 1000),
  });
}

if (process.argv[1]?.endsWith("backfill-history.ts")) {
  runHistoryBackfill()
    .then(async () => {
      await pool.end();
    })
    .catch(async (err) => {
      log("backfill failed", { error: String(err) });
      await pool.end();
      process.exit(1);
    });
}
