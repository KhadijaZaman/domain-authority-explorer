/**
 * Common Crawl edges sync — referring-domains extractor.
 *
 * Streams the (very large, ~13.6 GB compressed) domain-edges file of the
 * current release and extracts inbound links for a WATCHLIST of domains:
 * every domain users have previously looked up (found=true) plus every
 * niche-tagged domain. Full-graph processing for all 121M domains is not
 * feasible here; the watchlist approach mirrors how the original tool only
 * serves precomputed reports.
 *
 *   pnpm --filter @workspace/scripts run sync:edges
 *
 * Pipeline:
 * 1. Read current release from sync_meta (run the main sync first).
 * 2. Stream the vertices file to map watchlist domains -> numeric IDs.
 * 3. Stream the edges file (lines "<from_id>\t<to_id>", sorted by from_id).
 *    For each from-block we know its full outbound degree (distinct targets),
 *    and we collect edges pointing at watchlist IDs. Never loads the file
 *    into memory or onto disk.
 * 4. Re-stream the vertices file to resolve collected from_ids -> names.
 * 5. Write referring_domains rows (with each referrer's outbound degree for
 *    spam/platform flags), update edges metadata in sync_meta.
 * 6. New/lost lists are computed at query time by diffing against the
 *    previous release's rows, which are kept.
 *
 * Env vars:
 *   EDGES_MAX_BYTES — optional cap on compressed bytes to scan (for quick
 *                     partial runs in dev). Coverage percent is recorded so
 *                     the UI can label sampled data. Unset = full scan
 *                     (use on a Scheduled Deployment; takes ~20-40 min).
 *   FORCE_EDGES     — set "1" to re-run even if this release was already processed.
 */
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { eq, inArray, and, notInArray } from "drizzle-orm";
import {
  db,
  pool,
  syncMetaTable,
  lookupsTable,
  nicheTagsTable,
  referringDomainsTable,
  outboundDomainsTable,
} from "@workspace/db";

const DATA_BASE = "https://data.commoncrawl.org/projects/hyperlinkgraph";
const EDGES_MAX_BYTES = process.env.EDGES_MAX_BYTES
  ? Number(process.env.EDGES_MAX_BYTES)
  : null;

function log(message: string, extra: Record<string, unknown> = {}) {
  process.stdout.write(
    JSON.stringify({ time: new Date().toISOString(), message, ...extra }) +
      "\n",
  );
}

function reverseDomain(d: string): string {
  return d.split(".").reverse().join(".");
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
      log(`retry: ${label} failed`, { attempt: i + 1, delayMs: delay, error: String(err) });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

/** Open a gz URL as a line stream; returns { rl, rawBody } so callers can track/destroy. */
async function openGzLines(url: string) {
  const res = await retryWithBackoff(`download ${url}`, async () => {
    const r = await fetch(url);
    if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} for ${url}`);
    return r;
  });
  const contentLength = Number(res.headers.get("content-length") ?? 0) || null;
  const body = Readable.fromWeb(res.body as never);
  const gunzip = createGunzip();
  body.pipe(gunzip);
  body.on("error", () => undefined);
  gunzip.on("error", () => undefined);
  let bytesRead = 0;
  body.on("data", (chunk: Buffer) => {
    bytesRead += chunk.length;
  });
  const rl = createInterface({ input: gunzip, crlfDelay: Infinity });
  return { rl, body, contentLength, bytes: () => bytesRead };
}

export async function runEdgesSync() {
  const startedAt = Date.now();
  const [meta] = await db.select().from(syncMetaTable).limit(1);
  const release = meta?.currentRelease;
  if (!release) throw new Error("No current release — run the main sync first.");
  if (meta.edgesRelease === release && process.env.FORCE_EDGES !== "1") {
    log("edges already up to date", { release });
    return;
  }

  // 1. Build watchlist
  const lookedUp = await db
    .selectDistinct({ domain: lookupsTable.domain })
    .from(lookupsTable)
    .where(eq(lookupsTable.found, true));
  const tagged = await db
    .select({ domain: nicheTagsTable.domain })
    .from(nicheTagsTable);
  const watchDomains = new Set(
    [...lookedUp, ...tagged].map((r) => r.domain.toLowerCase()),
  );
  if (watchDomains.size === 0) {
    log("watchlist empty — nothing to do");
    return;
  }
  const watchByRev = new Map<string, string>(); // host_rev -> domain
  for (const d of watchDomains) watchByRev.set(reverseDomain(d), d);
  log("watchlist built", { size: watchDomains.size, release });

  // 2. Vertices pass 1: watchlist domain -> id
  const verticesUrl = `${DATA_BASE}/${release}/domain/${release}-domain-vertices.txt.gz`;
  const idToTarget = new Map<number, string>();
  {
    const { rl, body } = await openGzLines(verticesUrl);
    for await (const line of rl) {
      if (line.startsWith("#")) continue;
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      const rev = line.slice(tab + 1).split("\t")[0];
      const hit = watchByRev.get(rev);
      if (hit) {
        idToTarget.set(Number(line.slice(0, tab)), hit);
        if (idToTarget.size === watchByRev.size) break;
      }
    }
    rl.close();
    body.destroy();
  }
  log("vertices pass 1 done", { matchedIds: idToTarget.size });
  if (idToTarget.size === 0) {
    log("no watchlist domains found in vertices — exiting");
    return;
  }

  // 3. Edges pass
  const edgesUrl = `${DATA_BASE}/${release}/domain/${release}-domain-edges.txt.gz`;
  // Memory bound: keep at most this many referrers per watchlist target.
  // Popular targets (e.g. google.com) can have tens of millions of inbound
  // links; retaining them all would OOM. Reports are labeled lower-bound.
  const MAX_REFERRERS_PER_TARGET = Number(
    process.env.EDGES_MAX_REFERRERS_PER_TARGET ?? 25_000,
  );
  // Outbound prospecting: cap targets kept per watchlist source domain.
  const MAX_OUTBOUND_PER_SOURCE = Number(
    process.env.EDGES_MAX_OUTBOUND_PER_SOURCE ?? 2_000,
  );
  // sourceId (watchlist) -> outbound target ids
  const outbound = new Map<number, number[]>();
  // referrerId -> { degree, targets }
  const hits = new Map<number, { degree: number; targets: number[] }>();
  const perTargetCount = new Map<number, number>();
  let currentFrom = -1;
  let currentDegree = 0;
  let currentTargets: number[] = [];
  let linesScanned = 0;
  let coveragePercent: number | null = null;
  let stopRequested = false;

  const { rl, body, contentLength, bytes } = await openGzLines(edgesUrl);
  const closeBlock = () => {
    if (currentTargets.length === 0) return;
    const kept: number[] = [];
    for (const t of currentTargets) {
      const n = perTargetCount.get(t) ?? 0;
      if (n < MAX_REFERRERS_PER_TARGET) {
        perTargetCount.set(t, n + 1);
        kept.push(t);
      }
    }
    if (kept.length > 0) {
      hits.set(currentFrom, { degree: currentDegree, targets: kept });
    }
  };
  for await (const line of rl) {
    const tab = line.indexOf("\t");
    if (tab < 0) continue;
    const from = Number(line.slice(0, tab));
    const to = Number(line.slice(tab + 1));
    if (from !== currentFrom) {
      // Block boundary: finalize the previous block (its degree is complete)
      // and honor a pending early stop only here, so no block is truncated.
      closeBlock();
      if (stopRequested) {
        currentTargets = [];
        break;
      }
      currentFrom = from;
      currentDegree = 0;
      currentTargets = [];
    }
    currentDegree++;
    if (idToTarget.has(to)) currentTargets.push(to);
    if (idToTarget.has(from)) {
      let arr = outbound.get(from);
      if (!arr) {
        arr = [];
        outbound.set(from, arr);
      }
      if (arr.length < MAX_OUTBOUND_PER_SOURCE) arr.push(to);
    }
    linesScanned++;
    if (linesScanned % 50_000_000 === 0) {
      log("edges progress", { linesScanned, referrersFound: hits.size, gzBytes: bytes() });
    }
    if (!stopRequested && EDGES_MAX_BYTES && bytes() >= EDGES_MAX_BYTES) {
      log("EDGES_MAX_BYTES cap reached — finishing current block then stopping", {
        gzBytes: bytes(),
      });
      stopRequested = true;
    }
  }
  closeBlock();
  if (contentLength) {
    coveragePercent = Math.min(100, Math.round((bytes() / contentLength) * 10000) / 100);
  }
  rl.close();
  body.destroy();
  log("edges pass done", { linesScanned, referrers: hits.size, coveragePercent });

  // 4. Vertices pass 2: resolve referrer ids AND outbound target ids -> names
  const idsToResolve = new Set<number>(hits.keys());
  for (const targets of outbound.values()) {
    for (const t of targets) idsToResolve.add(t);
  }
  const referrerNames = new Map<number, string>();
  {
    const { rl: rl2, body: body2 } = await openGzLines(verticesUrl);
    for await (const line of rl2) {
      if (line.startsWith("#")) continue;
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      const id = Number(line.slice(0, tab));
      if (idsToResolve.has(id)) {
        const rev = line.slice(tab + 1).split("\t")[0];
        referrerNames.set(id, reverseDomain(rev));
        if (referrerNames.size === idsToResolve.size) break;
      }
    }
    rl2.close();
    body2.destroy();
  }
  log("vertices pass 2 done", { resolved: referrerNames.size });

  // 5. Write rows (idempotent: clear this release's rows first)
  await db
    .delete(referringDomainsTable)
    .where(eq(referringDomainsTable.releaseName, release));

  let rows: (typeof referringDomainsTable.$inferInsert)[] = [];
  let written = 0;
  const flush = async () => {
    if (!rows.length) return;
    await db.insert(referringDomainsTable).values(rows).onConflictDoNothing();
    written += rows.length;
    rows = [];
  };
  for (const [refId, info] of hits) {
    const referringDomain = referrerNames.get(refId);
    if (!referringDomain) continue;
    for (const targetId of info.targets) {
      const targetDomain = idToTarget.get(targetId);
      if (!targetDomain) continue;
      rows.push({
        releaseName: release,
        targetDomain,
        referringDomain,
        outboundDegree: info.degree,
      });
      if (rows.length >= 2000) await flush();
    }
  }
  await flush();

  // 5b. Write outbound (prospecting) rows
  await db
    .delete(outboundDomainsTable)
    .where(eq(outboundDomainsTable.releaseName, release));
  let outRows: (typeof outboundDomainsTable.$inferInsert)[] = [];
  let outWritten = 0;
  const flushOut = async () => {
    if (!outRows.length) return;
    await db.insert(outboundDomainsTable).values(outRows).onConflictDoNothing();
    outWritten += outRows.length;
    outRows = [];
  };
  for (const [srcId, targets] of outbound) {
    const sourceDomain = idToTarget.get(srcId);
    if (!sourceDomain) continue;
    for (const t of targets) {
      const outboundDomain = referrerNames.get(t);
      if (!outboundDomain || outboundDomain === sourceDomain) continue;
      outRows.push({ releaseName: release, sourceDomain, outboundDomain });
      if (outRows.length >= 2000) await flushOut();
    }
  }
  await flushOut();
  log("outbound rows written", { outWritten });

  const previousEdgesRelease =
    meta.edgesRelease && meta.edgesRelease !== release ? meta.edgesRelease : meta.edgesPreviousRelease;

  await db
    .update(syncMetaTable)
    .set({
      edgesRelease: release,
      edgesPreviousRelease: previousEdgesRelease ?? null,
      edgesSyncedAt: new Date(),
      edgesCoveragePercent: coveragePercent,
    })
    .where(eq(syncMetaTable.id, meta.id));

  // Prune anything older than current + previous
  const keep = [release, previousEdgesRelease].filter(
    (r): r is string => typeof r === "string" && r.length > 0,
  );
  await db
    .delete(referringDomainsTable)
    .where(notInArray(referringDomainsTable.releaseName, keep));
  await db
    .delete(outboundDomainsTable)
    .where(notInArray(outboundDomainsTable.releaseName, keep));

  log("edges sync finished", {
    release,
    rowsWritten: written,
    coveragePercent,
    seconds: Math.round((Date.now() - startedAt) / 1000),
  });
}

if (process.argv[1]?.endsWith("sync-edges.ts")) {
  runEdgesSync()
    .then(async () => pool.end())
    .catch(async (err) => {
      log("edges sync failed", { error: String(err) });
      await pool.end();
      process.exit(1);
    });
}
