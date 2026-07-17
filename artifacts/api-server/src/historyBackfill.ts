/**
 * On-demand history backfill for a single domain.
 *
 * The bulk backfill script (scripts/src/backfill-history.ts) only covers
 * domains that were on the watchlist when it last ran. A freshly looked-up
 * domain would otherwise show a single history point until the next monthly
 * sync. This module fills that gap: when the history endpoint sees a domain
 * with unscanned releases, it queues a background scan of every missing
 * release for just that domain.
 *
 * Same data rules as the bulk script (keep in lockstep):
 * - Ranks files are sorted by harmonic rank; we stream the top BACKFILL_LIMIT
 *   lines and early-abort as soon as the domain is found — for well-ranked
 *   domains this reads only a few thousand lines per release.
 * - Scores use the same log-rank formula as the live sync.
 * - Found releases get a real lookups_history row; absent ones get an
 *   `__absent__:<domain>` marker so nothing is rescanned next time.
 * - History floor is 2018 (earlier releases have no domain-ranks file).
 *
 * Safety: only one scan runs at a time (in-process FIFO queue, capped), and a
 * failed domain is not retried for RETRY_COOLDOWN_MS.
 */
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { inArray } from "drizzle-orm";
import { db, lookupsHistoryTable } from "@workspace/db";

const GRAPHINFO_URL = "https://index.commoncrawl.org/graphinfo.json";
const DATA_BASE = "https://data.commoncrawl.org/projects/hyperlinkgraph";
const FROM_YEAR = 2018;
const LINE_LIMIT = 1_000_000;
const MAX_QUEUE = 20;
const RETRY_COOLDOWN_MS = 10 * 60 * 1000;
const GRAPHINFO_TTL_MS = 6 * 60 * 60 * 1000;

interface GraphInfo {
  id: string;
  stats?: { domain?: { nodes?: number } };
}

interface ReleaseTarget {
  id: string;
  totalDomains: number;
  endDate: Date;
}

function log(message: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ src: "history-backfill", message, ...extra }));
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

/** Release id -> end date (15th of the last crawl month), or null. */
function releaseEndDate(id: string): Date | null {
  const m = id.match(/^cc-main-(\d{4})(?:-(\d{2}))?-([a-z-]+)$/);
  if (!m) return null;
  const y1 = Number(m[1]);
  const y2 = m[2] ? Number(m[1]!.slice(0, 2) + m[2]) : null;
  const monthNames = m[3]!.split("-").filter((s) => s in MONTHS);
  if (monthNames.length === 0) return null;
  const first = MONTHS[monthNames[0]!]!;
  const last = MONTHS[monthNames[monthNames.length - 1]!]!;
  const endYear = y2 !== null && last < first ? y2 : y1;
  return new Date(Date.UTC(endYear, last - 1, 15));
}

let graphinfoCache: { at: number; releases: ReleaseTarget[] } | null = null;

async function getReleases(): Promise<ReleaseTarget[]> {
  if (graphinfoCache && Date.now() - graphinfoCache.at < GRAPHINFO_TTL_MS) {
    return graphinfoCache.releases;
  }
  const r = await fetch(GRAPHINFO_URL, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from graphinfo.json`);
  const infos = (await r.json()) as GraphInfo[];
  const releases = infos
    .map((g) => ({
      id: g.id,
      totalDomains: g.stats?.domain?.nodes ?? 0,
      endDate: releaseEndDate(g.id),
    }))
    .filter(
      (x): x is ReleaseTarget =>
        x.endDate !== null &&
        x.endDate.getUTCFullYear() >= FROM_YEAR &&
        x.totalDomains > 0,
    )
    .sort((a, b) => a.endDate.getTime() - b.endDate.getTime());
  graphinfoCache = { at: Date.now(), releases };
  return releases;
}

/**
 * Releases (since 2018) that have neither a real history row nor an
 * `__absent__` marker for this domain — i.e. never scanned for it.
 */
export async function uncoveredReleases(
  domain: string,
): Promise<ReleaseTarget[]> {
  const releases = await getReleases();
  const existing = await db
    .select({
      releaseName: lookupsHistoryTable.releaseName,
      domain: lookupsHistoryTable.domain,
    })
    .from(lookupsHistoryTable)
    .where(
      inArray(lookupsHistoryTable.domain, [domain, `__absent__:${domain}`]),
    );
  const covered = new Set(existing.map((e) => e.releaseName));
  return releases.filter((r) => !covered.has(r.id));
}

/**
 * Scan one release's ranks file for a single domain (early abort on hit).
 *
 * Outcome is tri-state to protect the `__absent__` markers, which are treated
 * as permanent coverage and never rescanned:
 * - { hit }        — domain found (real history row)
 * - { hit: null }  — DEFINITIVE miss: we cleanly read the full top-N window
 *                    (or the release has no ranks file at all)
 * - throws         — transient failure (timeout, truncated download,
 *                    decompression error): no marker is written and the
 *                    release stays uncovered so a later run retries it.
 */
async function scanReleaseForDomain(
  release: ReleaseTarget,
  domain: string,
): Promise<{ hcPos: number; prPos: number } | null> {
  const url = `${DATA_BASE}/${release.id}/domain/${release.id}-domain-ranks.txt.gz`;
  // Generous budget: a full top-1M-line window is a ~15 MB gz download.
  const res = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (res.status === 404) return null; // release has no domain ranks file
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);

  const gunzip = createGunzip();
  const body = Readable.fromWeb(res.body as never);
  body.pipe(gunzip);
  // Capture stream/decompression errors instead of crashing; checked after
  // the read loop so a truncated transfer is never mistaken for a miss.
  let streamErr: unknown = null;
  body.on("error", (err) => {
    streamErr = err;
    gunzip.destroy();
  });
  gunzip.on("error", (err) => {
    streamErr ??= err;
  });
  const rl = createInterface({ input: gunzip, crlfDelay: Infinity });

  let cols = { hcPos: 0, prPos: 2, rev: 4 };
  let lines = 0;
  let hit: { hcPos: number; prPos: number } | null = null;
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
    if (unreverseDomain(rev) === domain) {
      const hcPos = Number(parts[cols.hcPos]);
      const prPos = Number(parts[cols.prPos]);
      if (Number.isFinite(hcPos)) {
        hit = { hcPos, prPos: Number.isFinite(prPos) ? prPos : hcPos };
      }
      break;
    }
    if (lines >= LINE_LIMIT) break;
  }
  rl.close();
  body.destroy();
  if (hit) return hit;
  // No hit: only a clean, complete scan window counts as a definitive miss.
  // An errored/truncated stream that ended early must be retried later.
  if (streamErr && lines < LINE_LIMIT) {
    throw new Error(`truncated scan of ${release.id}: ${String(streamErr)}`);
  }
  return null;
}

async function backfillDomain(domain: string): Promise<void> {
  const missing = await uncoveredReleases(domain);
  if (missing.length === 0) return;
  log("starting", { domain, releases: missing.length });
  const t0 = Date.now();
  let found = 0;
  for (const release of missing) {
    let hit: { hcPos: number; prPos: number } | null;
    try {
      hit = await scanReleaseForDomain(release, domain);
    } catch (err) {
      // Transient download failure — skip this release, it stays uncovered
      // and will be retried on a later request or by the monthly sync.
      log("release scan failed — skipping", {
        domain,
        release: release.id,
        error: String(err),
      });
      continue;
    }
    const row = hit
      ? {
          domain,
          releaseName: release.id,
          authorityScore: percentileScore(hit.hcPos, release.totalDomains),
          popularityScore: percentileScore(hit.prPos, release.totalDomains),
          recordedAt: release.endDate,
        }
      : {
          domain: `__absent__:${domain}`,
          releaseName: release.id,
          authorityScore: 0,
          popularityScore: 0,
          recordedAt: release.endDate,
        };
    if (hit) found++;
    await db.insert(lookupsHistoryTable).values(row).onConflictDoNothing();
  }
  log("finished", {
    domain,
    releases: missing.length,
    found,
    seconds: Math.round((Date.now() - t0) / 1000),
  });
}

const queued = new Set<string>();
const cooldownUntil = new Map<string, number>();
let chain: Promise<void> = Promise.resolve();

/**
 * Queue a background backfill for a domain. Returns true if the domain is
 * (now or already) queued/running, false if skipped (cooldown or full queue).
 * Never throws; never blocks the caller.
 */
export function enqueueHistoryBackfill(domain: string): boolean {
  if (queued.has(domain)) return true;
  const cd = cooldownUntil.get(domain);
  if (cd !== undefined && Date.now() < cd) return false;
  if (queued.size >= MAX_QUEUE) return false;
  queued.add(domain);
  chain = chain.then(async () => {
    try {
      await backfillDomain(domain);
    } catch (err) {
      log("backfill failed", { domain, error: String(err) });
      cooldownUntil.set(domain, Date.now() + RETRY_COOLDOWN_MS);
    } finally {
      queued.delete(domain);
    }
  });
  return true;
}

/** True if a backfill for this domain is currently queued or running. */
export function isBackfillPending(domain: string): boolean {
  return queued.has(domain);
}
