import { Router, type IRouter } from "express";
import { eq, and, desc, asc, inArray } from "drizzle-orm";
import {
  db,
  domainRanksTable,
  syncMetaTable,
  lookupsTable,
  lookupsHistoryTable,
  subdomainCountsTable,
  type DomainRank,
  type SyncMeta,
} from "@workspace/db";
import {
  GetStatusResponse,
  GetDomainResponse,
  GetDomainHistoryResponse,
  CompareDomainsQueryParams,
  CompareDomainsResponse,
  GetTopDomainsQueryParams,
  GetTopDomainsResponse,
  GetRecentLookupsQueryParams,
  GetRecentLookupsResponse,
} from "@workspace/api-zod";

import {
  enqueueHistoryBackfill,
  isBackfillPending,
  uncoveredReleases,
} from "../historyBackfill";

const router: IRouter = Router();

/**
 * Normalize user input to a bare registrable-domain-ish string:
 * strips scheme, path, port, credentials and a leading "www.".
 */
function normalizeDomain(input: string): string {
  let d = input.trim().toLowerCase();
  d = d.replace(/^[a-z][a-z0-9+.-]*:\/\//, ""); // scheme
  d = d.split("/")[0]?.split("?")[0] ?? "";
  d = d.replace(/^[^@]*@/, ""); // credentials
  d = d.split(":")[0] ?? ""; // port
  d = d.replace(/^www\./, "");
  d = d.replace(/\.+$/, ""); // trailing dot(s) in FQDN-style input
  return d;
}

async function getMeta(): Promise<SyncMeta | undefined> {
  const [meta] = await db.select().from(syncMetaTable).limit(1);
  return meta;
}

/** Tier badge derived from the absolute harmonic-centrality rank. */
export function tierForRank(rank: number): string {
  if (rank <= 100) return "elite";
  if (rank <= 1_000) return "top_1k";
  if (rank <= 10_000) return "top_10k";
  if (rank <= 100_000) return "top_100k";
  return "top_1m";
}

/**
 * Find a domain in the current release. Common Crawl's domain graph is at
 * registered-domain level, so if the exact host isn't found, fall back to
 * progressively shorter suffixes (docs.example.com -> example.com).
 */
async function findDomain(
  release: string,
  domain: string,
): Promise<DomainRank | undefined> {
  const candidates: string[] = [domain];
  const labels = domain.split(".");
  for (let i = 1; i < labels.length - 1; i++) {
    candidates.push(labels.slice(i).join("."));
  }
  for (const candidate of candidates) {
    const [row] = await db
      .select()
      .from(domainRanksTable)
      .where(
        and(
          eq(domainRanksTable.releaseName, release),
          eq(domainRanksTable.domain, candidate),
        ),
      )
      .limit(1);
    if (row) return row;
  }
  return undefined;
}

async function recordLookup(domain: string, row: DomainRank | undefined) {
  await db.insert(lookupsTable).values({
    domain: row?.domain ?? domain,
    found: !!row,
  });
  if (row) {
    await db
      .insert(lookupsHistoryTable)
      .values({
        domain: row.domain,
        releaseName: row.releaseName,
        authorityScore: row.authorityScore,
        popularityScore: row.popularityScore,
      })
      .onConflictDoNothing();
  }
}

router.get("/status", async (req, res): Promise<void> => {
  const meta = await getMeta();
  res.json(
    GetStatusResponse.parse({
      ready: !!meta?.currentRelease && (meta?.domainCount ?? 0) > 0,
      releaseName: meta?.currentRelease ?? null,
      releaseDate: meta?.releaseDate ?? null,
      lastSyncedAt: meta?.lastSyncedAt?.toISOString() ?? null,
      domainCount: meta?.domainCount ?? 0,
      totalDomainsInRelease: meta?.totalDomainsInRelease ?? null,
    }),
  );
});

router.get("/domain/:domain", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.domain)
    ? req.params.domain[0]
    : req.params.domain;
  const domain = normalizeDomain(raw ?? "");
  if (!domain || !domain.includes(".")) {
    res.status(404).json({ error: "Please enter a valid domain like example.com" });
    return;
  }

  const meta = await getMeta();
  if (!meta?.currentRelease) {
    res.status(404).json({
      error:
        "The Common Crawl dataset is still loading. Try again in a moment.",
    });
    return;
  }

  const row = await findDomain(meta.currentRelease, domain);
  await recordLookup(domain, row);

  if (!row) {
    res.status(404).json({
      error: `"${domain}" was not found in the latest Common Crawl crawl (${meta.currentRelease}).`,
    });
    return;
  }

  // Only serve counts computed from the same release we are reporting on,
  // so a fresh crawl release never shows stale subdomain numbers.
  const [sub] = await db
    .select()
    .from(subdomainCountsTable)
    .where(
      and(
        eq(subdomainCountsTable.domain, row.domain),
        eq(subdomainCountsTable.releaseName, row.releaseName),
      ),
    )
    .limit(1);

  res.json(
    GetDomainResponse.parse({
      domain: row.domain,
      authorityScore: row.authorityScore,
      popularityScore: row.popularityScore,
      authorityRank: row.harmonicPos,
      popularityRank: row.pagerankPos,
      totalDomainsInRelease: meta.totalDomainsInRelease ?? null,
      releaseName: row.releaseName,
      releaseDate: meta.releaseDate ?? null,
      tier: tierForRank(row.harmonicPos),
      subdomainCount: sub?.subdomainCount ?? null,
      subdomainCountComplete: sub ? sub.complete : null,
    }),
  );
});

router.get("/domain/:domain/history", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.domain)
    ? req.params.domain[0]
    : req.params.domain;
  const domain = normalizeDomain(raw ?? "");

  const rows = await db
    .select()
    .from(lookupsHistoryTable)
    .where(eq(lookupsHistoryTable.domain, domain))
    .orderBy(asc(lookupsHistoryTable.recordedAt));

  // Self-healing history: if past releases were never scanned for this
  // domain, queue a background backfill (only for domains users actually
  // found via lookup, so the endpoint can't be abused to trigger scans for
  // arbitrary strings). While it runs, report building=true so the client
  // can poll for more points.
  let building = isBackfillPending(domain);
  if (!building && rows.length > 0) {
    try {
      const missing = await uncoveredReleases(domain);
      if (missing.length > 0) {
        const [seen] = await db
          .select({ domain: lookupsTable.domain })
          .from(lookupsTable)
          .where(and(eq(lookupsTable.domain, domain), eq(lookupsTable.found, true)))
          .limit(1);
        if (seen) building = enqueueHistoryBackfill(domain);
      }
    } catch {
      // graphinfo.json unreachable — serve what we have, no backfill this time
    }
  }

  res.json(
    GetDomainHistoryResponse.parse({
      building,
      points: rows.map((r) => ({
        releaseName: r.releaseName,
        authorityScore: r.authorityScore,
        popularityScore: r.popularityScore,
        recordedAt: r.recordedAt.toISOString(),
      })),
    }),
  );
});

router.get("/compare", async (req, res): Promise<void> => {
  const parsed = CompareDomainsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const domains = [
    ...new Set(
      parsed.data.domains
        .split(",")
        .map((d) => normalizeDomain(d))
        .filter((d) => d.length > 0 && d.includes(".")),
    ),
  ];

  if (domains.length === 0) {
    res.status(400).json({ error: "Provide at least one valid domain." });
    return;
  }
  if (domains.length > 5) {
    res.status(400).json({ error: "You can compare at most 5 domains at a time." });
    return;
  }

  const meta = await getMeta();
  if (!meta?.currentRelease) {
    res.status(400).json({
      error:
        "The Common Crawl dataset is still loading. Try again in a moment.",
    });
    return;
  }

  const entries = await Promise.all(
    domains.map(async (domain) => {
      const row = await findDomain(meta.currentRelease!, domain);
      await recordLookup(domain, row);
      return {
        domain: row?.domain ?? domain,
        found: !!row,
        authorityScore: row?.authorityScore ?? null,
        popularityScore: row?.popularityScore ?? null,
        authorityRank: row?.harmonicPos ?? null,
        popularityRank: row?.pagerankPos ?? null,
      };
    }),
  );

  entries.sort((a, b) => {
    if (a.found !== b.found) return a.found ? -1 : 1;
    return (b.authorityScore ?? -1) - (a.authorityScore ?? -1);
  });

  res.json(CompareDomainsResponse.parse(entries));
});

router.get("/domains/top", async (req, res): Promise<void> => {
  const parsed = GetTopDomainsQueryParams.safeParse(req.query);
  const limit = parsed.success ? (parsed.data.limit ?? 10) : 10;

  const meta = await getMeta();
  if (!meta?.currentRelease) {
    res.json(GetTopDomainsResponse.parse([]));
    return;
  }

  const rows = await db
    .select()
    .from(domainRanksTable)
    .where(eq(domainRanksTable.releaseName, meta.currentRelease))
    .orderBy(asc(domainRanksTable.harmonicPos))
    .limit(limit);

  res.json(
    GetTopDomainsResponse.parse(
      rows.map((r) => ({
        rank: r.harmonicPos,
        domain: r.domain,
        authorityScore: r.authorityScore,
        popularityScore: r.popularityScore,
      })),
    ),
  );
});

router.get("/lookups/recent", async (req, res): Promise<void> => {
  const parsed = GetRecentLookupsQueryParams.safeParse(req.query);
  const limit = parsed.success ? (parsed.data.limit ?? 10) : 10;

  const rows = await db
    .select()
    .from(lookupsTable)
    .orderBy(desc(lookupsTable.lookedUpAt))
    .limit(limit * 3);

  // De-duplicate by domain, newest first.
  const seen = new Set<string>();
  const unique = rows.filter((r) => {
    if (seen.has(r.domain)) return false;
    seen.add(r.domain);
    return true;
  });

  res.json(
    GetRecentLookupsResponse.parse(
      unique.slice(0, limit).map((r) => ({
        domain: r.domain,
        found: r.found,
        lookedUpAt: r.lookedUpAt.toISOString(),
      })),
    ),
  );
});

export default router;
