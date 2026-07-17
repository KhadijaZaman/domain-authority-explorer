/**
 * Common Crawl subdomain-count sync.
 *
 * Streams the HOST-level vertices file of the current release and counts,
 * for each watchlist domain (previously looked-up + niche-tagged), how many
 * distinct hosts (subdomains) exist under it. The file is sorted by reversed
 * host name, so all hosts of a domain are contiguous: we walk a sorted
 * watchlist pointer alongside the stream and can stop early once every
 * watchlist domain's block has been passed.
 *
 *   pnpm --filter @workspace/scripts run sync:subdomains
 *
 * Env vars:
 *   HOSTS_MAX_BYTES — optional cap on compressed bytes to scan (dev runs).
 *                     Domains whose block was fully passed are marked
 *                     complete; others get a lower-bound count.
 *   FORCE_SUBDOMAINS — set "1" to re-run for a release already processed.
 */
import { createInterface } from "node:readline";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { eq, and, notInArray } from "drizzle-orm";
import {
  db,
  pool,
  syncMetaTable,
  lookupsTable,
  nicheTagsTable,
  subdomainCountsTable,
} from "@workspace/db";

const DATA_BASE = "https://data.commoncrawl.org/projects/hyperlinkgraph";
const HOSTS_MAX_BYTES = process.env.HOSTS_MAX_BYTES
  ? Number(process.env.HOSTS_MAX_BYTES)
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

async function openGzLines(url: string) {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`);
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
  return { rl, body, bytes: () => bytesRead };
}

export async function runSubdomainsSync() {
  const startedAt = Date.now();
  const [meta] = await db.select().from(syncMetaTable).limit(1);
  const release = meta?.currentRelease;
  if (!release) throw new Error("No current release — run the main sync first.");

  const [existing] = await db
    .select({ id: subdomainCountsTable.id })
    .from(subdomainCountsTable)
    .where(eq(subdomainCountsTable.releaseName, release))
    .limit(1);
  if (existing && process.env.FORCE_SUBDOMAINS !== "1") {
    log("subdomain counts already exist for this release", { release });
    return;
  }

  // Watchlist
  const lookedUp = await db
    .selectDistinct({ domain: lookupsTable.domain })
    .from(lookupsTable)
    .where(eq(lookupsTable.found, true));
  const tagged = await db
    .select({ domain: nicheTagsTable.domain })
    .from(nicheTagsTable);
  const watch = [
    ...new Set([...lookedUp, ...tagged].map((r) => r.domain.toLowerCase())),
  ];
  if (watch.length === 0) {
    log("watchlist empty — nothing to do");
    return;
  }

  // Sorted by reversed name to walk alongside the sorted vertices stream.
  const entries = watch
    .map((domain) => ({
      domain,
      rev: reverseDomain(domain),
      count: 0,
      complete: false,
      seen: false,
    }))
    .sort((a, b) => (a.rev < b.rev ? -1 : a.rev > b.rev ? 1 : 0));
  log("watchlist built", { size: entries.length, release });

  // Host vertices are split into part files listed in a .paths.gz manifest,
  // globally sorted by reversed host name across parts in order.
  const pathsUrl = `${DATA_BASE}/${release}/host/${release}-host-vertices.paths.gz`;
  const partPaths: string[] = [];
  {
    const { rl: prl, body: pbody } = await openGzLines(pathsUrl);
    for await (const line of prl) {
      const p = line.trim();
      if (p) partPaths.push(p);
    }
    prl.close();
    pbody.destroy();
  }
  log("host vertices parts listed", { parts: partPaths.length });

  let i = 0;
  let lines = 0;
  let totalBytes = 0;
  let cappedStop = false;
  for (const part of partPaths) {
    if (i >= entries.length || cappedStop) break;
    const { rl, body, bytes } = await openGzLines(
      `https://data.commoncrawl.org/${part}`,
    );
    for await (const line of rl) {
      if (line.startsWith("#")) continue;
      const tab = line.indexOf("\t");
      if (tab < 0) continue;
      const rev = line.slice(tab + 1).split("\t")[0] ?? "";
      lines++;

      // Advance past watchlist entries whose block is definitively over.
      // A block for `rev R` spans exactly R and R + "." + anything; a line
      // sorting after R + "." that doesn't start with R + "." ends the block.
      while (
        i < entries.length &&
        rev > entries[i]!.rev + "." &&
        !rev.startsWith(entries[i]!.rev + ".")
      ) {
        entries[i]!.complete = true;
        i++;
      }
      if (i >= entries.length) break; // all watchlist blocks passed — done

      const e = entries[i]!;
      if (rev === e.rev) {
        e.seen = true;
      } else if (rev.startsWith(e.rev + ".")) {
        e.seen = true;
        e.count++; // strict subdomain (apex excluded)
      }

      if (lines % 20_000_000 === 0) {
        log("hosts progress", { lines, pointer: i, gzBytes: totalBytes + bytes() });
      }
      if (HOSTS_MAX_BYTES && totalBytes + bytes() >= HOSTS_MAX_BYTES) {
        cappedStop = true;
        log("HOSTS_MAX_BYTES cap reached — stopping", {
          gzBytes: totalBytes + bytes(),
        });
        break;
      }
    }
    totalBytes += bytes();
    rl.close();
    body.destroy();
  }
  // Natural end of data also completes all remaining blocks.
  if (!cappedStop) {
    for (; i < entries.length; i++) entries[i]!.complete = true;
  }

  const complete = entries.filter((e) => e.complete).length;
  log("hosts pass done", { lines, complete, total: entries.length, cappedStop });

  // Write rows: complete domains always; incomplete ones only if we saw
  // something (lower bound better than nothing).
  await db
    .delete(subdomainCountsTable)
    .where(eq(subdomainCountsTable.releaseName, release));
  const rows = entries
    .filter((e) => e.complete || e.seen)
    .map((e) => ({
      releaseName: release,
      domain: e.domain,
      subdomainCount: e.count,
      complete: e.complete,
    }));
  for (let j = 0; j < rows.length; j += 2000) {
    await db
      .insert(subdomainCountsTable)
      .values(rows.slice(j, j + 2000))
      .onConflictDoNothing();
  }

  // Keep only the current release's counts.
  await db
    .delete(subdomainCountsTable)
    .where(notInArray(subdomainCountsTable.releaseName, [release]));

  log("subdomain sync finished", {
    release,
    rowsWritten: rows.length,
    seconds: Math.round((Date.now() - startedAt) / 1000),
  });
}

if (process.argv[1]?.endsWith("sync-subdomains.ts")) {
  runSubdomainsSync()
    .then(async () => pool.end())
    .catch(async (err) => {
      log("subdomain sync failed", { error: String(err) });
      await pool.end();
      process.exit(1);
    });
}
