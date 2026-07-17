/**
 * Common Crawl CDX fetcher + in-process job queue for the corpus audit.
 *
 * The CDX index server is a single machine and rate-limits aggressively, so:
 * - dumps are cached forever in corpus_snapshots (CC crawl data is immutable)
 * - fetches run one at a time with a politeness delay between requests
 * - 502s are routine — retried with exponential backoff
 * - a CDX 404 means "no captures", not an error
 *
 * The queue also refreshes a live robots.txt check (which AI crawlers the
 * domain blocks today), cached as a pseudo-snapshot row for 7 days.
 */
import { eq } from "drizzle-orm";
import { db, corpusSnapshotsTable } from "@workspace/db";
import type { SlimRecord } from "./corpusAnalysis";
import { fetchPublicText } from "./routes/insights";
import { inspectPages, buildRobotsHistory, type RobotsHistoryData } from "./corpusDeep";
import { fetchSitemap } from "./corpusSources";
import { fetchWayback } from "./corpusSources";

const COLLINFO_URL = "https://index.commoncrawl.org/collinfo.json";
const CDX_BASE = "https://index.commoncrawl.org";
const CRAWLS_TO_AUDIT = 4;
const RECORD_LIMIT = 5000;
const POLITENESS_MS = 2200;
const ROBOTS_CRAWL_ID = "__robots_live__";
const INSPECT_CRAWL_ID = "__inspect__";
const SITEMAP_CRAWL_ID = "__sitemap__";
const WAYBACK_CRAWL_ID = "__wayback__";
const ROBOTS_HISTORY_CRAWL_ID = "__robots_history__";
const ROBOTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const SITEMAP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const WAYBACK_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RETRY_COOLDOWN_MS = 5 * 60 * 1000;

export const AI_BOTS = [
  "CCBot",
  "GPTBot",
  "ClaudeBot",
  "Google-Extended",
  "PerplexityBot",
  "Bytespider",
  "Applebot-Extended",
  "anthropic-ai",
  "cohere-ai",
];

function log(message: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ src: "corpus-audit", message, ...extra }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- crawl list

let collinfoCache: { at: number; ids: string[] } | null = null;

/** Newest-first FULL crawl id list since 2013 (collinfo.json cached 24h). */
export async function getAllCrawlIds(): Promise<string[]> {
  if (collinfoCache && Date.now() - collinfoCache.at < 24 * 60 * 60 * 1000) {
    return collinfoCache.ids;
  }
  const r = await fetch(COLLINFO_URL, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status} from collinfo.json`);
  const crawls = (await r.json()) as { id: string }[];
  const ids = crawls
    .map((c) => c.id)
    .filter((id) => /^CC-MAIN-\d{4}-\d+$/.test(id));
  collinfoCache = { at: Date.now(), ids };
  return ids;
}

/** Newest-first crawl ids to audit in depth. */
export async function getAuditCrawlIds(): Promise<string[]> {
  return (await getAllCrawlIds()).slice(0, CRAWLS_TO_AUDIT);
}

// ---------------------------------------------------------------- CDX fetch

function bucketOf(filename: string): SlimRecord["b"] {
  if (filename.includes("/warc/")) return "warc";
  if (filename.includes("crawldiagnostics")) return "diag";
  if (filename.includes("robotstxt")) return "robots";
  return "other";
}

/**
 * Fetch one (crawl, domain) CDX dump. Returns slim records; empty array when
 * the crawl has no captures for the domain. Throws on persistent failure.
 */
async function fetchCdxDump(
  crawlId: string,
  domain: string,
): Promise<SlimRecord[]> {
  const url =
    `${CDX_BASE}/${crawlId}-index?url=${encodeURIComponent(domain)}` +
    `&matchType=domain&output=json&limit=${RECORD_LIMIT}`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt > 0) await sleep(2 ** attempt * 2000);
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(90_000),
        headers: { "user-agent": "DomainAuthorityExplorer-CorpusAudit/1.0" },
      });
      // The CDX server answers 404 with an error body when there are simply
      // no captures — that's a real, cacheable "zero records" result.
      if (r.status === 404) return [];
      if (!r.ok) throw new Error(`HTTP ${r.status} from CDX ${crawlId}`);
      const text = await r.text();
      const records: SlimRecord[] = [];
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let j: Record<string, string>;
        try {
          j = JSON.parse(line);
        } catch {
          continue;
        }
        if (!j.url || !j.status) continue;
        const rec: SlimRecord = {
          u: j.url,
          s: j.status,
          d: j.digest ?? "",
          l: Number(j.length ?? 0) || 0,
          m: j.mime ?? "unknown",
          b: bucketOf(j.filename ?? ""),
          t: j.timestamp ?? "",
        };
        if (j.languages) rec.g = j.languages;
        if (j.redirect) rec.r = j.redirect;
        const md = j["mime-detected"];
        if (md && md !== rec.m) rec.md = md;
        // WARC locators, kept only where deep inspection may need them.
        if (rec.b === "warc" && j.filename) {
          rec.f = j.filename;
          rec.o = Number(j.offset ?? -1);
        }
        records.push(rec);
      }
      return records;
    } catch (err) {
      lastErr = err;
      log("cdx fetch retry", { crawlId, domain, attempt, error: String(err) });
    }
  }
  throw lastErr;
}

// ------------------------------------------------------------- robots check

/**
 * Which of the known AI crawlers does this robots.txt text fully block?
 * Parses user-agent groups; a bot is "blocked" when a group naming it
 * contains `Disallow: /` exactly.
 */
export function parseRobotsBlockedBots(text: string): string[] {
  const blocked = new Set<string>();
  let agents: string[] = [];
  let sawRule = false;
  for (const rawLine of text.split("\n")) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = /^([a-z-]+)\s*:\s*(.*)$/i.exec(line);
    if (!m) continue;
    const field = m[1]!.toLowerCase();
    const value = m[2]!.trim();
    if (field === "user-agent") {
      if (sawRule) agents = [];
      sawRule = false;
      agents.push(value.toLowerCase());
    } else if (field === "disallow") {
      sawRule = true;
      if (value === "/") {
        for (const bot of AI_BOTS) {
          if (agents.includes(bot.toLowerCase())) blocked.add(bot);
        }
      }
    } else if (field === "allow") {
      sawRule = true;
    }
  }
  return [...blocked];
}

// --------------------------------------------------------------- staleness

/** Which of the known AI crawlers does the LIVE robots.txt fully block? */
async function checkLiveRobots(domain: string): Promise<string[]> {
  let text: string | null = null;
  for (const scheme of ["https", "http"]) {
    text = await fetchPublicText(`${scheme}://${domain}/robots.txt`);
    if (text) break;
  }
  if (!text) return [];
  return parseRobotsBlockedBots(text);
}

/**
 * A "v1" dump row predates deep inspection: it has archived WARC records but
 * none carry the `f` (archive filename) locator. Those rows must be refetched
 * once so header/canonical inspection can byte-range into the archive.
 */
export function isV1DumpRow(row: { crawlId: string; records: unknown }): boolean {
  if (!/^CC-MAIN/.test(row.crawlId)) return false;
  const recs = row.records as SlimRecord[];
  return recs.some((r) => r.b === "warc") && !recs.some((r) => r.f);
}

interface RowLite {
  crawlId: string;
  records: unknown;
  fetchedAt: Date;
}

/** Is any enrichment (inspection/sitemap/wayback/robots history) missing or stale? */
export function enrichmentStale(
  rows: RowLite[],
  newestCrawlId: string,
): boolean {
  const by = new Map(rows.map((r) => [r.crawlId, r]));
  const now = Date.now();
  const inspect = by.get(INSPECT_CRAWL_ID);
  if (!inspect || (inspect.records as { crawlId?: string }).crawlId !== newestCrawlId)
    return true;
  const sitemap = by.get(SITEMAP_CRAWL_ID);
  if (!sitemap || now - sitemap.fetchedAt.getTime() > SITEMAP_TTL_MS) return true;
  const wayback = by.get(WAYBACK_CRAWL_ID);
  if (!wayback || now - wayback.fetchedAt.getTime() > WAYBACK_TTL_MS) return true;
  const rh = by.get(ROBOTS_HISTORY_CRAWL_ID);
  if (!rh) return true;
  const rhData = rh.records as RobotsHistoryData;
  if (!rhData.complete || !rhData.checkedCrawls.includes(newestCrawlId)) return true;
  return false;
}

// -------------------------------------------------------------------- queue

const queued = new Set<string>();
const cooldownUntil = new Map<string, number>();
let chain: Promise<void> = Promise.resolve();

async function upsertRow(
  domain: string,
  crawlId: string,
  records: unknown,
  recordCount: number,
  truncated = false,
): Promise<void> {
  await db
    .insert(corpusSnapshotsTable)
    .values({ domain, crawlId, records, recordCount, truncated })
    .onConflictDoUpdate({
      target: [corpusSnapshotsTable.domain, corpusSnapshotsTable.crawlId],
      set: { records, recordCount, truncated, fetchedAt: new Date() },
    });
}

/** Pick + prioritize archived pages worth a WARC inspection fetch. */
function inspectionCandidates(domain: string, recs: SlimRecord[]): SlimRecord[] {
  const isHome = (u: string) =>
    new RegExp(`^https?://(www\\.)?${domain.replace(/\./g, "\\.")}/?(\\?|$)`).test(u);
  const eligible = recs.filter(
    (r) => r.s === "200" && r.b === "warc" && r.f && (r.m.includes("html") || r.m === "unknown"),
  );
  const seenPath = new Set<string>();
  const uniq: SlimRecord[] = [];
  // Homepage variants first (clean or parameterized), then clean shallow pages.
  const sorted = [...eligible].sort((a, b) => {
    const ha = isHome(a.u) ? 0 : 1;
    const hb = isHome(b.u) ? 0 : 1;
    if (ha !== hb) return ha - hb;
    const pa = a.u.includes("?") ? 1 : 0;
    const pb = b.u.includes("?") ? 1 : 0;
    if (pa !== pb) return pa - pb;
    return a.u.length - b.u.length;
  });
  for (const r of sorted) {
    const path = r.u.split("?")[0] ?? r.u;
    if (seenPath.has(path)) continue;
    seenPath.add(path);
    uniq.push(r);
  }
  return uniq;
}

async function runAuditFetch(domain: string): Promise<void> {
  const allCrawlIds = await getAllCrawlIds();
  const crawlIds = allCrawlIds.slice(0, CRAWLS_TO_AUDIT);
  const rows = await db
    .select()
    .from(corpusSnapshotsTable)
    .where(eq(corpusSnapshotsTable.domain, domain));
  const byCrawl = new Map(rows.map((r) => [r.crawlId, r]));

  // ---- crawl dumps (refetching pre-inspection "v1" rows once)
  const freshRecords = new Map<string, SlimRecord[]>();
  for (const crawlId of crawlIds) {
    const row = byCrawl.get(crawlId);
    if (row && !isV1DumpRow(row)) continue;
    const t0 = Date.now();
    const records = await fetchCdxDump(crawlId, domain);
    await upsertRow(domain, crawlId, records, records.length, records.length >= RECORD_LIMIT);
    freshRecords.set(crawlId, records);
    log("crawl dumped", {
      domain,
      crawlId,
      records: records.length,
      upgraded: !!row,
      seconds: Math.round((Date.now() - t0) / 1000),
    });
    await sleep(POLITENESS_MS); // politeness: the CDX index is one machine
  }

  // ---- live robots.txt AI-bot check (7-day TTL)
  const robotsRow = byCrawl.get(ROBOTS_CRAWL_ID);
  const robotsStale =
    !robotsRow || Date.now() - robotsRow.fetchedAt.getTime() > ROBOTS_TTL_MS;
  if (robotsStale) {
    try {
      const blockedBots = await checkLiveRobots(domain);
      await upsertRow(domain, ROBOTS_CRAWL_ID, blockedBots, blockedBots.length);
    } catch (err) {
      log("live robots check failed", { domain, error: String(err) });
    }
  }

  // Each enrichment step is independent — one failing shouldn't kill the
  // rest — but a failure must still put the domain on cooldown, or polling
  // clients would re-trigger the expensive job immediately.
  let enrichmentFailed = false;
  const newest = crawlIds[0]!;
  const newestRecords =
    freshRecords.get(newest) ??
    ((byCrawl.get(newest)?.records as SlimRecord[] | undefined) ?? []);

  // ---- page inspection (headers + canonicals), tied to the newest crawl
  const inspectRow = byCrawl.get(INSPECT_CRAWL_ID);
  if (!inspectRow || (inspectRow.records as { crawlId?: string }).crawlId !== newest) {
    try {
      const pages = await inspectPages(inspectionCandidates(domain, newestRecords));
      await upsertRow(domain, INSPECT_CRAWL_ID, { crawlId: newest, pages }, pages.length);
      log("pages inspected", { domain, pages: pages.length });
    } catch (err) {
      enrichmentFailed = true;
      log("page inspection failed", { domain, error: String(err) });
    }
  }

  // ---- live sitemap (7-day TTL)
  const sitemapRow = byCrawl.get(SITEMAP_CRAWL_ID);
  if (!sitemapRow || Date.now() - sitemapRow.fetchedAt.getTime() > SITEMAP_TTL_MS) {
    try {
      const sitemap = await fetchSitemap(domain);
      await upsertRow(domain, SITEMAP_CRAWL_ID, sitemap, sitemap.urls.length, sitemap.truncated);
    } catch (err) {
      enrichmentFailed = true;
      log("sitemap fetch failed", { domain, error: String(err) });
    }
  }

  // ---- Wayback Machine join (30-day TTL)
  const waybackRow = byCrawl.get(WAYBACK_CRAWL_ID);
  if (!waybackRow || Date.now() - waybackRow.fetchedAt.getTime() > WAYBACK_TTL_MS) {
    try {
      const wayback = await fetchWayback(domain);
      await upsertRow(domain, WAYBACK_CRAWL_ID, wayback, wayback.yearsActive.length);
    } catch (err) {
      enrichmentFailed = true;
      log("wayback fetch failed", { domain, error: String(err) });
    }
  }

  // ---- robots.txt history since 2013 (the long pole; saves progress as it goes)
  const rhRow = byCrawl.get(ROBOTS_HISTORY_CRAWL_ID);
  const rhData = (rhRow?.records as RobotsHistoryData | undefined) ?? null;
  if (!rhData || !rhData.complete || !rhData.checkedCrawls.includes(newest)) {
    try {
      await buildRobotsHistory(domain, allCrawlIds, rhData, async (data) => {
        await upsertRow(domain, ROBOTS_HISTORY_CRAWL_ID, data, data.entries.length);
      });
    } catch (err) {
      enrichmentFailed = true;
      log("robots history failed", { domain, error: String(err) });
    }
  }

  if (enrichmentFailed) {
    // Successes are already persisted; throwing puts the domain on the
    // standard failure cooldown so polling can't re-trigger the job hot.
    throw new Error("one or more enrichment steps failed");
  }
}

/** Queue background CDX dumps for a domain. Returns true when queued/running. */
export function enqueueCorpusFetch(domain: string): boolean {
  if (queued.has(domain)) return true;
  const cd = cooldownUntil.get(domain);
  if (cd !== undefined && Date.now() < cd) return false;
  if (queued.size >= 10) return false;
  queued.add(domain);
  chain = chain.then(async () => {
    try {
      await runAuditFetch(domain);
    } catch (err) {
      log("audit fetch failed", { domain, error: String(err) });
      cooldownUntil.set(domain, Date.now() + RETRY_COOLDOWN_MS);
    } finally {
      queued.delete(domain);
    }
  });
  return true;
}

export function isCorpusFetchPending(domain: string): boolean {
  return queued.has(domain);
}

export {
  ROBOTS_CRAWL_ID,
  INSPECT_CRAWL_ID,
  SITEMAP_CRAWL_ID,
  WAYBACK_CRAWL_ID,
  ROBOTS_HISTORY_CRAWL_ID,
};
