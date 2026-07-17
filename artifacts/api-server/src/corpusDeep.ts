/**
 * Deep corpus inspection: byte-range fetches of actual WARC records from
 * data.commoncrawl.org (a CDN, far more tolerant than the CDX index — but we
 * still keep a small politeness delay and hard caps).
 *
 * Two consumers:
 * - page inspection: HTTP response headers (X-Robots-Tag, Link canonical) and
 *   the HTML <link rel=canonical> for a sample of archived pages
 * - robots.txt history: the actual robots.txt content as it stood in past
 *   crawls, parsed for AI-bot blocks
 */
import { gunzipSync } from "node:zlib";
import type { SlimRecord } from "./corpusAnalysis";
import { parseRobotsBlockedBots } from "./corpusAudit";

const WARC_BASE = "https://data.commoncrawl.org";
const WARC_DELAY_MS = 500;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function log(message: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ src: "corpus-deep", message, ...extra }));
}

export interface WarcRecord {
  httpHeaders: Record<string, string>;
  body: string;
}

/** Byte-range fetch + gunzip of one WARC record. Null on any failure. */
export async function fetchWarcRecord(
  filename: string,
  offset: number,
  length: number,
): Promise<WarcRecord | null> {
  if (!filename || length <= 0 || length > 2 * 1024 * 1024) return null;
  try {
    const r = await fetch(`${WARC_BASE}/${filename}`, {
      headers: { Range: `bytes=${offset}-${offset + length - 1}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok && r.status !== 206) return null;
    const gz = Buffer.from(await r.arrayBuffer());
    const text = gunzipSync(gz).toString("utf8");
    // WARC record = WARC headers \r\n\r\n HTTP headers \r\n\r\n body
    const i1 = text.indexOf("\r\n\r\n");
    if (i1 < 0) return null;
    const i2 = text.indexOf("\r\n\r\n", i1 + 4);
    const httpBlock = text.slice(i1 + 4, i2 < 0 ? undefined : i2);
    const body = i2 < 0 ? "" : text.slice(i2 + 4);
    const httpHeaders: Record<string, string> = {};
    for (const line of httpBlock.split("\r\n").slice(1)) {
      const c = line.indexOf(":");
      if (c <= 0) continue;
      const k = line.slice(0, c).trim().toLowerCase();
      const v = line.slice(c + 1).trim();
      httpHeaders[k] = httpHeaders[k] ? `${httpHeaders[k]}, ${v}` : v;
    }
    return { httpHeaders, body };
  } catch (err) {
    log("warc fetch failed", { filename, offset, error: String(err) });
    return null;
  }
}

// ------------------------------------------------------------ page inspection

export interface InspectedPage {
  url: string;
  xRobotsTag: string | null;
  headerCanonical: string | null;
  htmlCanonical: string | null;
  contentTypeDeclared: string | null;
  server: string | null;
  cacheControl: string | null;
}

function linkHeaderCanonical(link: string | undefined): string | null {
  if (!link) return null;
  for (const part of link.split(",")) {
    if (/rel\s*=\s*"?canonical"?/i.test(part)) {
      const m = /<([^>]+)>/.exec(part);
      if (m) return m[1]!;
    }
  }
  return null;
}

function htmlCanonicalOf(body: string): string | null {
  // Cheap scan of <link ... rel=canonical ... href=...> in either attr order.
  const tags = body.match(/<link\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    if (!/rel\s*=\s*["']?canonical["']?/i.test(tag)) continue;
    const m = /href\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (m) return m[1]!;
  }
  return null;
}

const INSPECT_MAX_PAGES = 12;

/**
 * Fetch and parse the WARC records for a sample of archived pages.
 * `candidates` should already be prioritized (homepage first, etc.).
 */
export async function inspectPages(
  candidates: SlimRecord[],
): Promise<InspectedPage[]> {
  const out: InspectedPage[] = [];
  for (const rec of candidates.slice(0, INSPECT_MAX_PAGES)) {
    if (!rec.f || rec.o === undefined) continue;
    const warc = await fetchWarcRecord(rec.f, rec.o, rec.l);
    if (warc) {
      out.push({
        url: rec.u,
        xRobotsTag: warc.httpHeaders["x-robots-tag"] ?? null,
        headerCanonical: linkHeaderCanonical(warc.httpHeaders["link"]),
        htmlCanonical: htmlCanonicalOf(warc.body),
        contentTypeDeclared: warc.httpHeaders["content-type"] ?? null,
        server: warc.httpHeaders["server"] ?? null,
        cacheControl: warc.httpHeaders["cache-control"] ?? null,
      });
    }
    await sleep(WARC_DELAY_MS);
  }
  return out;
}

// --------------------------------------------------------- robots.txt history

export interface RobotsHistoryEntry {
  c: string; // crawl id
  t: string; // capture timestamp (YYYYMMDD...)
  s: string; // status
  d: string; // digest
  bots: string[] | null; // blocked AI bots, null when content wasn't fetched
}

export interface RobotsHistoryData {
  complete: boolean;
  checkedCrawls: string[];
  entries: RobotsHistoryEntry[];
}

const ROBOTS_CDX_DELAY_MS = 2200;
const ROBOTS_WARC_MAX = 30;

interface RobotsCapture {
  entry: RobotsHistoryEntry;
  f: string;
  o: number;
  l: number;
}

type RobotsCaptureResult =
  | { ok: true; cap: RobotsCapture | null } // null = definitively no capture
  | { ok: false }; // fetch failed — must be retried on a later run

/** One exact-match CDX query for a crawl's robots.txt capture. */
async function fetchRobotsCapture(
  crawlId: string,
  domain: string,
): Promise<RobotsCaptureResult> {
  const url =
    `https://index.commoncrawl.org/${crawlId}-index` +
    `?url=${encodeURIComponent(`${domain}/robots.txt`)}&output=json&limit=5`;
  let lastErr: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) await sleep(2 ** attempt * 2000);
    try {
      const r = await fetch(url, {
        signal: AbortSignal.timeout(60_000),
        headers: { "user-agent": "DomainAuthorityExplorer-CorpusAudit/1.0" },
      });
      if (r.status === 404) return { ok: true, cap: null }; // no capture in this crawl
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const lines = (await r.text()).split("\n").filter((l) => l.trim());
      let best: Record<string, string> | null = null;
      for (const line of lines) {
        try {
          const j = JSON.parse(line) as Record<string, string>;
          if (!best || (j.status === "200" && best.status !== "200")) best = j;
        } catch {
          /* skip */
        }
      }
      if (!best) return { ok: true, cap: null };
      return {
        ok: true,
        cap: {
          entry: {
            c: crawlId,
            t: best.timestamp ?? "",
            s: best.status ?? "",
            d: best.digest ?? "",
            bots: null,
          },
          f: best.filename ?? "",
          o: Number(best.offset ?? -1),
          l: Number(best.length ?? 0),
        },
      };
    } catch (err) {
      lastErr = err;
    }
  }
  log("robots capture failed", { crawlId, domain, error: String(lastErr) });
  return { ok: false };
}

/**
 * Build (or extend) the robots.txt timeline. Walks every crawl not yet
 * checked, then fetches WARC content once per distinct digest and parses
 * which AI bots were blocked. `save` is called periodically so the frontend
 * can show progress on a long first build.
 */
export async function buildRobotsHistory(
  domain: string,
  allCrawlIds: string[], // newest-first, full list since 2013
  existing: RobotsHistoryData | null,
  save: (data: RobotsHistoryData) => Promise<void>,
): Promise<void> {
  const checked = new Set(existing?.checkedCrawls ?? []);
  const entries = new Map((existing?.entries ?? []).map((e) => [e.c, e]));
  const captures: RobotsCapture[] = [];
  const toCheck = allCrawlIds.filter((c) => !checked.has(c));

  const persist = async () => {
    const order = new Map(allCrawlIds.map((c, i) => [c, i]));
    await save({
      // complete only when every crawl got a definitive answer — failed
      // fetches stay unchecked and are retried on a later run.
      complete: allCrawlIds.every((c) => checked.has(c)),
      checkedCrawls: [...checked],
      // oldest → newest for the timeline
      entries: [...entries.values()].sort(
        (a, b) => (order.get(b.c) ?? 0) - (order.get(a.c) ?? 0),
      ),
    });
  };

  let sinceSave = 0;
  let failures = 0;
  for (const crawlId of toCheck) {
    const result = await fetchRobotsCapture(crawlId, domain);
    if (result.ok) {
      checked.add(crawlId);
      if (result.cap) {
        entries.set(crawlId, result.cap.entry);
        captures.push(result.cap);
      }
    } else if (++failures >= 5) {
      // The index is struggling — stop hammering it; the rest retry later.
      break;
    }
    if (++sinceSave >= 10) {
      sinceSave = 0;
      await persist();
    }
    await sleep(ROBOTS_CDX_DELAY_MS);
  }

  // Fetch content once per distinct digest (robots files rarely change), then
  // stamp the parsed bot-block list onto every crawl sharing that digest.
  const byDigest = new Map<string, RobotsCapture>();
  for (const cap of captures) {
    if (cap.entry.s === "200" && cap.entry.d && !byDigest.has(cap.entry.d)) {
      byDigest.set(cap.entry.d, cap);
    }
  }
  // Also re-resolve digests already known from earlier runs via existing bots.
  const knownBots = new Map<string, string[]>();
  for (const e of entries.values()) {
    if (e.bots && e.d) knownBots.set(e.d, e.bots);
  }
  let warcFetches = 0;
  for (const [digest, cap] of byDigest) {
    if (knownBots.has(digest)) continue;
    if (warcFetches >= ROBOTS_WARC_MAX) break;
    warcFetches++;
    const warc = await fetchWarcRecord(cap.f, cap.o, cap.l);
    if (warc) knownBots.set(digest, parseRobotsBlockedBots(warc.body));
    await sleep(WARC_DELAY_MS);
  }
  for (const e of entries.values()) {
    if (e.bots === null && knownBots.has(e.d)) e.bots = knownBots.get(e.d)!;
  }
  await persist();
  log("robots history built", {
    domain,
    crawlsChecked: checked.size,
    entries: entries.size,
    warcFetches,
    failures,
  });
  if (failures > 0) {
    throw new Error(`robots history: ${failures} crawl fetches failed — will retry later`);
  }
}
