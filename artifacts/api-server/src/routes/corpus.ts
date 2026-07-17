import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, corpusSnapshotsTable } from "@workspace/db";
import { GetCorpusAuditResponse } from "@workspace/api-zod";
import {
  getAuditCrawlIds,
  enqueueCorpusFetch,
  isCorpusFetchPending,
  isV1DumpRow,
  enrichmentStale,
  ROBOTS_CRAWL_ID,
  INSPECT_CRAWL_ID,
  SITEMAP_CRAWL_ID,
  WAYBACK_CRAWL_ID,
  ROBOTS_HISTORY_CRAWL_ID,
} from "../corpusAudit";
import {
  analyzeCorpus,
  type CrawlSnapshot,
  type SlimRecord,
  type AuditExtras,
} from "../corpusAnalysis";
import type { InspectedPage, RobotsHistoryData } from "../corpusDeep";
import type { SitemapData, WaybackData } from "../corpusSources";

const router: IRouter = Router();

// Per-IP limit on triggering NEW background CDX fetch jobs (cached audits are
// cheap and unlimited; enqueuing hits an external rate-limited server).
const ENQUEUE_WINDOW_MS = 10 * 60 * 1000;
const ENQUEUE_MAX_PER_WINDOW = 5;
const enqueueLog = new Map<string, number[]>();

function allowEnqueue(ip: string): boolean {
  const now = Date.now();
  const hits = (enqueueLog.get(ip) ?? []).filter((t) => now - t < ENQUEUE_WINDOW_MS);
  if (hits.length >= ENQUEUE_MAX_PER_WINDOW) {
    enqueueLog.set(ip, hits);
    return false;
  }
  hits.push(now);
  enqueueLog.set(ip, hits);
  if (enqueueLog.size > 5000) enqueueLog.clear();
  return true;
}

const HOSTNAME_RE =
  /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  d = d.split("/")[0]?.split("?")[0] ?? "";
  d = d.replace(/^[^@]*@/, "");
  d = d.split(":")[0] ?? "";
  d = d.replace(/^www\./, "");
  d = d.replace(/\.+$/, ""); // trailing dot(s) in FQDN-style input
  return d;
}

router.get("/corpus/:domain/audit", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.domain)
    ? req.params.domain[0]
    : req.params.domain;
  const domain = normalizeDomain(raw ?? "");
  if (!domain || !HOSTNAME_RE.test(domain)) {
    res.status(400).json({ error: "Provide a valid domain like example.com" });
    return;
  }

  let crawlIds: string[];
  try {
    crawlIds = await getAuditCrawlIds();
  } catch {
    res.status(502).json({
      error:
        "Couldn't reach the Common Crawl index to list crawls. It's a single rate-limited server — try again in a moment.",
    });
    return;
  }

  const rows = await db
    .select()
    .from(corpusSnapshotsTable)
    .where(eq(corpusSnapshotsTable.domain, domain));
  const byCrawl = new Map(rows.map((r) => [r.crawlId, r]));
  // Pre-inspection ("v1") rows are treated as missing: they get refetched once
  // so deep inspection has the WARC locators it needs.
  const missing = crawlIds.filter((id) => {
    const row = byCrawl.get(id);
    return !row || isV1DumpRow(row);
  });
  const enrichStale = enrichmentStale(rows, crawlIds[0]!);

  // building=true whenever crawls are still missing — even if the enqueue was
  // rejected (queue full / failure cooldown / rate limit), so the client keeps
  // polling and a later poll re-enqueues once the throttle clears. Cached
  // (complete) audits never enqueue, so polling them is free.
  const pending = isCorpusFetchPending(domain);
  let building = pending && missing.length > 0;
  if ((missing.length > 0 || enrichStale) && !pending) {
    const ip = req.ip ?? "unknown";
    if (rows.length > 0 || allowEnqueue(ip)) {
      // Domains with existing rows are resuming a partial fetch, not new work.
      enqueueCorpusFetch(domain);
    }
    building = missing.length > 0;
  }
  const enriching = enrichStale;

  // Oldest → newest for the analyzer (crawlIds are newest-first).
  const snapshots: CrawlSnapshot[] = [...crawlIds]
    .reverse()
    .flatMap((id) => {
      const row = byCrawl.get(id);
      return row
        ? [
            {
              crawlId: id,
              records: row.records as SlimRecord[],
              truncated: row.truncated,
            },
          ]
        : [];
    });

  const robotsRow = byCrawl.get(ROBOTS_CRAWL_ID);
  const robotsLive = {
    checked: !!robotsRow,
    blockedBots: (robotsRow?.records as string[] | undefined) ?? [],
  };

  const inspectRow = byCrawl.get(INSPECT_CRAWL_ID);
  const inspectData = inspectRow?.records as
    | { crawlId: string; pages: InspectedPage[] }
    | undefined;
  const sitemapData = byCrawl.get(SITEMAP_CRAWL_ID)?.records as SitemapData | undefined;
  const waybackData = byCrawl.get(WAYBACK_CRAWL_ID)?.records as WaybackData | undefined;
  const rhData = byCrawl.get(ROBOTS_HISTORY_CRAWL_ID)?.records as
    | RobotsHistoryData
    | undefined;
  const extras: AuditExtras = {
    // Only surface an inspection matching the newest crawl we're analyzing.
    inspection: inspectData && inspectData.crawlId === crawlIds[0] ? inspectData : null,
    sitemap: sitemapData ?? null,
    wayback: waybackData ?? null,
    robotsHistory: rhData ?? null,
  };

  res.json(
    GetCorpusAuditResponse.parse({
      building,
      enriching,
      progress: {
        fetchedCrawls: crawlIds.length - missing.length,
        totalCrawls: crawlIds.length,
      },
      crawlIds,
      analysis:
        snapshots.length > 0
          ? analyzeCorpus(domain, snapshots, robotsLive, extras)
          : null,
    }),
  );
});

export default router;
