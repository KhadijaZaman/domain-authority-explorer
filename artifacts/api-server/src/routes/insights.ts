import { Router, type IRouter } from "express";
import net from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { eq, and, sql, inArray, asc } from "drizzle-orm";
import {
  db,
  domainRanksTable,
  syncMetaTable,
  nicheTagsTable,
  referringDomainsTable,
  outboundDomainsTable,
  lookupsTable,
} from "@workspace/db";
import {
  GetDomainNicheResponse,
  SetDomainNicheBody,
  SetDomainNicheResponse,
  AutoDetectDomainNicheResponse,
  ListNichesResponse,
  GetReferringDomainsResponse,
  GetBacklinkSummaryResponse,
  GetOutboundDomainsResponse,
  GetLinkGapQueryParams,
  GetLinkGapResponse,
} from "@workspace/api-zod";
import {
  dataforseoConfigured,
  getBacklinkSummaryCached,
} from "../lib/dataforseo";

const router: IRouter = Router();

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

function param(v: string | string[] | undefined): string {
  return normalizeDomain(Array.isArray(v) ? (v[0] ?? "") : (v ?? ""));
}

async function getMeta() {
  const [meta] = await db.select().from(syncMetaTable).limit(1);
  return meta;
}

/** Compute niche info for a domain: tag + within-niche authority percentile. */
async function nicheInfo(domain: string) {
  const [tagRow] = await db
    .select()
    .from(nicheTagsTable)
    .where(eq(nicheTagsTable.domain, domain))
    .limit(1);

  if (!tagRow) {
    return { domain, tag: null, nichePercentile: null, nicheSize: 0, nicheRank: null };
  }

  const meta = await getMeta();
  const release = meta?.currentRelease;
  if (!release) {
    return { domain, tag: tagRow.tag, nichePercentile: null, nicheSize: 0, nicheRank: null };
  }

  // All tagged domains in this niche with their authority rank (lower harmonicPos = better)
  const peers = await db
    .select({
      domain: nicheTagsTable.domain,
      harmonicPos: domainRanksTable.harmonicPos,
    })
    .from(nicheTagsTable)
    .leftJoin(
      domainRanksTable,
      and(
        eq(domainRanksTable.domain, nicheTagsTable.domain),
        eq(domainRanksTable.releaseName, release),
      ),
    )
    .where(eq(nicheTagsTable.tag, tagRow.tag));

  // Population = tagged domains that have rank data in the current release,
  // so percentile, rank, and nicheSize all describe the same set.
  const ranked = peers
    .filter((p) => p.harmonicPos !== null)
    .sort((a, b) => (a.harmonicPos! - b.harmonicPos!));
  const nicheSize = ranked.length;
  const idx = ranked.findIndex((p) => p.domain === domain);

  if (idx < 0) {
    return { domain, tag: tagRow.tag, nichePercentile: null, nicheSize, nicheRank: null };
  }

  const nicheRank = idx + 1;
  const nichePercentile =
    ranked.length === 1
      ? 100
      : Math.round((1 - idx / (ranked.length - 1)) * 10000) / 100;

  return { domain, tag: tagRow.tag, nichePercentile, nicheSize, nicheRank };
}

router.get("/domain/:domain/niche", async (req, res): Promise<void> => {
  const domain = param(req.params.domain);
  res.json(GetDomainNicheResponse.parse(await nicheInfo(domain)));
});

router.post("/domain/:domain/niche", async (req, res): Promise<void> => {
  const domain = param(req.params.domain);
  const parsed = SetDomainNicheBody.safeParse(req.body);
  if (!domain || !parsed.success) {
    res.status(400).json({ error: "Provide a valid domain and tag." });
    return;
  }
  const tag = parsed.data.tag.trim().toLowerCase();
  if (tag.length > 40) {
    res.status(400).json({ error: "Tag must be 40 characters or fewer." });
    return;
  }

  if (!tag) {
    await db.delete(nicheTagsTable).where(eq(nicheTagsTable.domain, domain));
  } else {
    await db
      .insert(nicheTagsTable)
      .values({ domain, tag })
      .onConflictDoUpdate({
        target: nicheTagsTable.domain,
        set: { tag, taggedAt: new Date() },
      });
  }
  res.json(SetDomainNicheResponse.parse(await nicheInfo(domain)));
});

/** True when an IP address is loopback, private, link-local, or otherwise non-public. */
function isPrivateIp(ip: string): boolean {
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower.startsWith("::ffff:")) return isPrivateIp(lower.slice(7));
    return (
      lower === "::" ||
      lower === "::1" ||
      lower.startsWith("fe8") ||
      lower.startsWith("fe9") ||
      lower.startsWith("fea") ||
      lower.startsWith("feb") ||
      lower.startsWith("fc") ||
      lower.startsWith("fd") ||
      lower.startsWith("ff")
    );
  }
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** SSRF guard: the hostname must resolve exclusively to public IP addresses. */
async function isPublicHost(hostname: string): Promise<boolean> {
  if (net.isIP(hostname)) return !isPrivateIp(hostname);
  try {
    const addrs = await dnsLookup(hostname, { all: true });
    return addrs.length > 0 && addrs.every((a) => !isPrivateIp(a.address));
  } catch {
    return false;
  }
}

/**
 * Fetch HTML from a URL with SSRF protections: only http(s) on default ports,
 * every redirect hop re-validated against public DNS before it is followed.
 */
async function fetchPublicHtml(startUrl: string): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(startUrl);
  } catch {
    return null;
  }
  for (let hop = 0; hop < 4; hop++) {
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (url.port && url.port !== "80" && url.port !== "443") return null;
    if (url.username || url.password) return null;
    if (!(await isPublicHost(url.hostname))) return null;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    let resp: Response;
    try {
      resp = await fetch(url, {
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; DomainAuthorityExplorer/1.0)",
          accept: "text/html",
        },
      });
    } finally {
      clearTimeout(timer);
    }

    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location");
      if (!loc) return null;
      try {
        url = new URL(loc, url);
      } catch {
        return null;
      }
      continue;
    }
    if (!resp.ok) return null;
    return (await resp.text()).slice(0, 500_000);
  }
  return null;
}

/** SSRF-guarded plain-text fetch (robots.txt etc.) — same rules as HTML. */
export async function fetchPublicText(url: string): Promise<string | null> {
  return fetchPublicHtml(url);
}

/** Fetch a domain's homepage and extract title, description, and visible text. */
async function fetchHomepageText(domain: string): Promise<string | null> {
  for (const scheme of ["https", "http"]) {
    try {
      const html = await fetchPublicHtml(`${scheme}://${domain}/`);
      if (!html) continue;

      const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
      const metaDesc =
        /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(
          html,
        )?.[1] ??
        /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(
          html,
        )?.[1] ??
        "";
      const text = html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<[^>]+>/g, " ")
        .replace(/&[a-z#0-9]+;/gi, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 2000);

      const combined = [
        title && `Title: ${title.trim()}`,
        metaDesc && `Description: ${metaDesc.trim()}`,
        text && `Page text: ${text}`,
      ]
        .filter(Boolean)
        .join("\n");
      if (combined) return combined;
    } catch {
      // try next scheme
    }
  }
  return null;
}

// Basic abuse guard for the auto-detect endpoint: it triggers an outbound
// fetch plus an AI call, so cap how often it can run (sliding 1-minute window).
const autoNicheCallTimes: number[] = [];
function autoNicheRateLimited(): boolean {
  const now = Date.now();
  while (autoNicheCallTimes.length > 0 && now - autoNicheCallTimes[0] > 60_000) {
    autoNicheCallTimes.shift();
  }
  if (autoNicheCallTimes.length >= 10) return true;
  autoNicheCallTimes.push(now);
  return false;
}

const HOSTNAME_RE = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{1,62}$/;

router.post("/domain/:domain/niche/auto", async (req, res): Promise<void> => {
  const domain = param(req.params.domain);
  if (!domain || !HOSTNAME_RE.test(domain)) {
    res.status(400).json({ error: "Provide a valid domain." });
    return;
  }
  if (autoNicheRateLimited()) {
    res.status(429).json({
      error: "Too many auto-detect requests at once. Please wait a minute and try again.",
    });
    return;
  }

  const homepage = await fetchHomepageText(domain);
  if (!homepage) {
    res.status(502).json({
      error: `Couldn't reach ${domain}'s homepage to read it. The site may be down, blocking automated visits, or not serving a homepage.`,
    });
    return;
  }

  const existing = await db
    .selectDistinct({ tag: nicheTagsTable.tag })
    .from(nicheTagsTable);
  const existingTags = existing.map((r) => r.tag);

  let tag: string;
  try {
    const { openai } = await import(
      "@workspace/integrations-openai-ai-server"
    );
    const completion = await openai.chat.completions.create({
      model: "gpt-5-mini",
      max_completion_tokens: 800,
      messages: [
        {
          role: "system",
          content:
            "You classify websites into industry/niche tags for an SEO tool. " +
            "Reply with ONLY the tag: 2-4 words, lowercase, no punctuation, no quotes, max 40 characters. " +
            (existingTags.length > 0
              ? `Existing tags (reuse one EXACTLY if it genuinely fits): ${existingTags.join(", ")}. `
              : "") +
            "If no existing tag fits, create a new specific tag (e.g. 'developer tools', 'online payments', 'travel booking').",
        },
        {
          role: "user",
          content: `Classify this website (${domain}):\n${homepage}`,
        },
      ],
    });
    tag = (completion.choices[0]?.message?.content ?? "")
      .trim()
      .toLowerCase()
      .replace(/^["'`]+|["'`.]+$/g, "")
      .slice(0, 40)
      .trim();
  } catch {
    res.status(502).json({
      error:
        "The AI classification service is temporarily unavailable. Please try again in a moment.",
    });
    return;
  }

  if (!tag) {
    res.status(502).json({
      error: "The AI couldn't determine a niche from this homepage. You can tag it manually instead.",
    });
    return;
  }

  await db
    .insert(nicheTagsTable)
    .values({ domain, tag })
    .onConflictDoUpdate({
      target: nicheTagsTable.domain,
      set: { tag, taggedAt: new Date() },
    });

  res.json(AutoDetectDomainNicheResponse.parse(await nicheInfo(domain)));
});

router.get("/niches", async (_req, res): Promise<void> => {
  const rows = await db
    .select({
      tag: nicheTagsTable.tag,
      count: sql<number>`count(*)::int`,
    })
    .from(nicheTagsTable)
    .groupBy(nicheTagsTable.tag)
    .orderBy(sql`count(*) desc`);
  res.json(ListNichesResponse.parse(rows));
});

function referrerFlag(outboundDegree: number): string | null {
  return outboundDegree <= 2
    ? "low_diversity"
    : outboundDegree >= 100_000
      ? "platform"
      : null;
}

function tldOf(domain: string): string {
  const dot = domain.lastIndexOf(".");
  return dot >= 0 ? domain.slice(dot + 1) : domain;
}

function strengthOf(authorityScore: number | null): keyof StrengthBucketsShape {
  if (authorityScore === null) return "unknown";
  if (authorityScore >= 60) return "strong";
  if (authorityScore >= 30) return "medium";
  return "weak";
}

type StrengthBucketsShape = {
  strong: number;
  medium: number;
  weak: number;
  unknown: number;
};

router.get("/domain/:domain/referring", async (req, res): Promise<void> => {
  const domain = param(req.params.domain);
  const tldFilter =
    typeof req.query.tld === "string"
      ? req.query.tld.trim().toLowerCase().replace(/^\./, "")
      : null;
  const meta = await getMeta();

  const empty = {
    domain,
    available: false,
    releaseName: null,
    syncedAt: null,
    coveragePercent: null,
    referringCount: 0,
    strengthBuckets: { strong: 0, medium: 0, weak: 0, unknown: 0 },
    tldBreakdown: [],
    entries: [],
    newDomains: [],
    lostDomains: [],
    previousReleaseName: null,
  };

  if (!meta?.edgesRelease) {
    res.json(
      GetReferringDomainsResponse.parse({
        ...empty,
        message:
          "Referring-domain data has not been generated yet. It is produced by the monthly edges sync for previously looked-up domains.",
      }),
    );
    return;
  }

  const current = await db
    .select({
      referringDomain: referringDomainsTable.referringDomain,
      outboundDegree: referringDomainsTable.outboundDegree,
      authorityScore: domainRanksTable.authorityScore,
    })
    .from(referringDomainsTable)
    .leftJoin(
      domainRanksTable,
      and(
        eq(domainRanksTable.domain, referringDomainsTable.referringDomain),
        meta.currentRelease
          ? eq(domainRanksTable.releaseName, meta.currentRelease)
          : sql`false`,
      ),
    )
    .where(
      and(
        eq(referringDomainsTable.releaseName, meta.edgesRelease),
        eq(referringDomainsTable.targetDomain, domain),
      ),
    );

  if (current.length === 0) {
    res.json(
      GetReferringDomainsResponse.parse({
        ...empty,
        message:
          "No referring-domain data for this domain yet. It joins the watchlist after being looked up, and data appears after the next monthly edges sync.",
      }),
    );
    return;
  }

  const prevRelease = meta.edgesPreviousRelease;
  const previous = prevRelease
    ? await db
        .select({ referringDomain: referringDomainsTable.referringDomain })
        .from(referringDomainsTable)
        .where(
          and(
            eq(referringDomainsTable.releaseName, prevRelease),
            eq(referringDomainsTable.targetDomain, domain),
          ),
        )
    : [];
  const prevSet = new Set(previous.map((p) => p.referringDomain));
  const curSet = new Set(current.map((c) => c.referringDomain));

  const allEntries = current.map((c) => ({
    domain: c.referringDomain,
    outboundDegree: c.outboundDegree,
    authorityScore: c.authorityScore ?? null,
    flag: referrerFlag(c.outboundDegree),
    isNew: prevSet.size > 0 ? !prevSet.has(c.referringDomain) : false,
  }));

  // Aggregates are computed over ALL rows; the entries list is capped.
  const strengthBuckets: StrengthBucketsShape = {
    strong: 0,
    medium: 0,
    weak: 0,
    unknown: 0,
  };
  const tldCounts = new Map<string, number>();
  for (const e of allEntries) {
    strengthBuckets[strengthOf(e.authorityScore)]++;
    const tld = tldOf(e.domain);
    tldCounts.set(tld, (tldCounts.get(tld) ?? 0) + 1);
  }
  const tldBreakdown = [...tldCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([tld, count]) => ({ tld, count }));

  const entries = (tldFilter
    ? allEntries.filter((e) => tldOf(e.domain) === tldFilter)
    : allEntries
  )
    .sort(
      (a, b) =>
        (b.authorityScore ?? -1) - (a.authorityScore ?? -1) ||
        b.outboundDegree - a.outboundDegree,
    )
    .slice(0, 500);

  const partial =
    meta.edgesCoveragePercent !== null && meta.edgesCoveragePercent < 100;

  res.json(
    GetReferringDomainsResponse.parse({
      domain,
      available: true,
      message: partial
        ? `Based on a scan of ${meta.edgesCoveragePercent}% of the release's link graph — counts are a lower bound.`
        : null,
      releaseName: meta.edgesRelease,
      syncedAt: meta.edgesSyncedAt?.toISOString() ?? null,
      coveragePercent: meta.edgesCoveragePercent,
      referringCount: allEntries.length,
      strengthBuckets,
      tldBreakdown,
      entries,
      newDomains: prevSet.size
        ? allEntries.filter((e) => e.isNew).map((e) => e.domain).slice(0, 200)
        : [],
      lostDomains: prevSet.size
        ? [...prevSet].filter((d) => !curSet.has(d)).slice(0, 200)
        : [],
      previousReleaseName: prevRelease ?? null,
    }),
  );
});

router.get("/domain/:domain/outbound", async (req, res): Promise<void> => {
  const domain = param(req.params.domain);
  const meta = await getMeta();

  if (!meta?.edgesRelease) {
    res.json(
      GetOutboundDomainsResponse.parse({
        domain,
        available: false,
        message:
          "Outbound-domain data has not been generated yet. It is produced by the monthly edges sync for previously looked-up domains.",
        releaseName: null,
        count: 0,
        entries: [],
      }),
    );
    return;
  }

  const rows = await db
    .select({
      outboundDomain: outboundDomainsTable.outboundDomain,
      authorityScore: domainRanksTable.authorityScore,
    })
    .from(outboundDomainsTable)
    .leftJoin(
      domainRanksTable,
      and(
        eq(domainRanksTable.domain, outboundDomainsTable.outboundDomain),
        meta.currentRelease
          ? eq(domainRanksTable.releaseName, meta.currentRelease)
          : sql`false`,
      ),
    )
    .where(
      and(
        eq(outboundDomainsTable.releaseName, meta.edgesRelease),
        eq(outboundDomainsTable.sourceDomain, domain),
      ),
    );

  if (rows.length === 0) {
    res.json(
      GetOutboundDomainsResponse.parse({
        domain,
        available: false,
        message:
          "No outbound-domain data for this domain yet. It joins the watchlist after being looked up, and data appears after the next monthly edges sync.",
        releaseName: meta.edgesRelease,
        count: 0,
        entries: [],
      }),
    );
    return;
  }

  const entries = rows
    .map((r) => ({
      domain: r.outboundDomain,
      authorityScore: r.authorityScore ?? null,
    }))
    .sort((a, b) => (b.authorityScore ?? -1) - (a.authorityScore ?? -1))
    .slice(0, 500);

  // Outbound capture is capped per source during the sync, and dev syncs may
  // scan only part of the edge file — surface both as a sampling caveat.
  const outPartial =
    rows.length >= 2_000 ||
    (meta.edgesCoveragePercent !== null && meta.edgesCoveragePercent < 100);

  res.json(
    GetOutboundDomainsResponse.parse({
      domain,
      available: true,
      message: outPartial
        ? "This is a sample of the site's outbound links, not an exhaustive list."
        : null,
      releaseName: meta.edgesRelease,
      count: rows.length,
      entries,
    }),
  );
});

router.get("/gap", async (req, res): Promise<void> => {
  const parsed = GetLinkGapQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Provide domain and competitors." });
    return;
  }
  const domain = normalizeDomain(parsed.data.domain);
  const competitors = [
    ...new Set(
      parsed.data.competitors
        .split(",")
        .map((d) => normalizeDomain(d))
        .filter((d) => d.length > 0 && d.includes(".") && d !== domain),
    ),
  ];
  if (!domain || !domain.includes(".") || competitors.length === 0) {
    res.status(400).json({ error: "Provide your domain and at least one competitor." });
    return;
  }
  if (competitors.length > 4) {
    res.status(400).json({ error: "You can compare against at most 4 competitors." });
    return;
  }

  const meta = await getMeta();
  const emptyBase = {
    domain,
    releaseName: meta?.edgesRelease ?? null,
    gapCount: 0,
    attainableCount: 0,
    entries: [],
  };
  if (!meta?.edgesRelease) {
    res.json(
      GetLinkGapResponse.parse({
        ...emptyBase,
        available: false,
        message:
          "Link-graph data has not been generated yet. It is produced by the monthly edges sync.",
        competitors: competitors.map((c) => ({
          domain: c,
          available: false,
          referringCount: 0,
        })),
      }),
    );
    return;
  }

  const allTargets = [domain, ...competitors];
  const rows = await db
    .select({
      targetDomain: referringDomainsTable.targetDomain,
      referringDomain: referringDomainsTable.referringDomain,
      outboundDegree: referringDomainsTable.outboundDegree,
      authorityScore: domainRanksTable.authorityScore,
    })
    .from(referringDomainsTable)
    .leftJoin(
      domainRanksTable,
      and(
        eq(domainRanksTable.domain, referringDomainsTable.referringDomain),
        meta.currentRelease
          ? eq(domainRanksTable.releaseName, meta.currentRelease)
          : sql`false`,
      ),
    )
    .where(
      and(
        eq(referringDomainsTable.releaseName, meta.edgesRelease),
        inArray(referringDomainsTable.targetDomain, allTargets),
      ),
    );

  const byTarget = new Map<string, typeof rows>();
  for (const r of rows) {
    const list = byTarget.get(r.targetDomain) ?? [];
    list.push(r);
    byTarget.set(r.targetDomain, list);
  }

  // Competitors with no edges data yet: add them to the watchlist (as a
  // lookup) so the next sync picks them up.
  const missing = competitors.filter((c) => !byTarget.has(c));
  if (missing.length > 0 && meta.currentRelease) {
    const known = await db
      .select({ domain: domainRanksTable.domain })
      .from(domainRanksTable)
      .where(
        and(
          eq(domainRanksTable.releaseName, meta.currentRelease),
          inArray(domainRanksTable.domain, missing),
        ),
      );
    const knownSet = new Set(known.map((k) => k.domain));
    await db.insert(lookupsTable).values(
      missing.map((m) => ({ domain: m, found: knownSet.has(m) })),
    );
  }

  const ownSet = new Set(
    (byTarget.get(domain) ?? []).map((r) => r.referringDomain),
  );
  const competitorInfos = competitors.map((c) => ({
    domain: c,
    available: byTarget.has(c),
    referringCount: byTarget.get(c)?.length ?? 0,
  }));
  const competitorsWithData = competitorInfos.filter((c) => c.available).length;

  if (competitorsWithData === 0) {
    res.json(
      GetLinkGapResponse.parse({
        ...emptyBase,
        available: false,
        message:
          "None of the competitors have link-graph data yet. They have been added to the watchlist — data appears after the next monthly edges sync.",
        competitors: competitorInfos,
      }),
    );
    return;
  }

  // Set difference: referrers of competitors that do NOT link to you.
  const gap = new Map<
    string,
    {
      outboundDegree: number;
      authorityScore: number | null;
      linksToCount: number;
    }
  >();
  const targetSet = new Set(allTargets);
  for (const c of competitors) {
    for (const r of byTarget.get(c) ?? []) {
      if (ownSet.has(r.referringDomain) || targetSet.has(r.referringDomain))
        continue;
      const g = gap.get(r.referringDomain);
      if (g) {
        g.linksToCount++;
        g.outboundDegree = Math.max(g.outboundDegree, r.outboundDegree);
        g.authorityScore = g.authorityScore ?? r.authorityScore ?? null;
      } else {
        gap.set(r.referringDomain, {
          outboundDegree: r.outboundDegree,
          authorityScore: r.authorityScore ?? null,
          linksToCount: 1,
        });
      }
    }
  }

  const needMultiple = competitorsWithData >= 2;
  const allGapEntries = [...gap.entries()].map(([d, g]) => {
    const attainable =
      g.authorityScore !== null &&
      g.authorityScore >= 20 &&
      g.authorityScore <= 80 &&
      g.outboundDegree < 100_000 && // not a mega-site/open platform
      (!needMultiple || g.linksToCount >= 2);
    return {
      domain: d,
      authorityScore: g.authorityScore,
      outboundDegree: g.outboundDegree,
      linksToCount: g.linksToCount,
      attainable,
      flag: referrerFlag(g.outboundDegree),
    };
  });
  const attainableCount = allGapEntries.filter((e) => e.attainable).length;
  const entries = allGapEntries
    .sort(
      (a, b) =>
        Number(b.attainable) - Number(a.attainable) ||
        (b.authorityScore ?? -1) - (a.authorityScore ?? -1),
    )
    .slice(0, 500);

  const partial =
    meta.edgesCoveragePercent !== null && meta.edgesCoveragePercent < 100;
  const ownMissing = !byTarget.has(domain);

  res.json(
    GetLinkGapResponse.parse({
      domain,
      available: true,
      message: [
        ownMissing
          ? "Your own domain has no link-graph data yet, so every competitor referrer appears as a gap."
          : null,
        partial
          ? `Based on a scan of ${meta.edgesCoveragePercent}% of the release's link graph — a sample, not the full picture.`
          : null,
      ]
        .filter(Boolean)
        .join(" ") || null,
      releaseName: meta.edgesRelease,
      competitors: competitorInfos,
      gapCount: allGapEntries.length,
      attainableCount,
      entries,
    }),
  );
});

router.get("/domain/:domain/backlinks", async (req, res): Promise<void> => {
  const domain = param(req.params.domain);

  const base = {
    domain,
    configured: false,
    message: null as string | null,
    backlinks: null as number | null,
    referringDomains: null as number | null,
    referringMainDomains: null as number | null,
    brokenBacklinks: null as number | null,
    dataforseoRank: null as number | null,
    dataforseoScore: null as number | null,
    ccAuthorityScore: null as number | null,
    hybridScore: null as number | null,
    cachedAt: null as string | null,
  };

  const meta = await getMeta();
  if (meta?.currentRelease) {
    const [cc] = await db
      .select({ authorityScore: domainRanksTable.authorityScore })
      .from(domainRanksTable)
      .where(
        and(
          eq(domainRanksTable.releaseName, meta.currentRelease),
          eq(domainRanksTable.domain, domain),
        ),
      )
      .limit(1);
    base.ccAuthorityScore = cc?.authorityScore ?? null;
  }

  if (!dataforseoConfigured()) {
    res.json(
      GetBacklinkSummaryResponse.parse({
        ...base,
        message:
          "DataForSEO credentials are not configured. Add DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD to enable fresh backlink counts and the hybrid score.",
      }),
    );
    return;
  }

  try {
    const { summary, cachedAt } = await getBacklinkSummaryCached(domain);
    const dataforseoScore =
      summary.rank !== null ? Math.round((summary.rank / 1000) * 10000) / 100 : null;
    const hybridScore =
      dataforseoScore !== null && base.ccAuthorityScore !== null
        ? Math.round(((dataforseoScore + base.ccAuthorityScore) / 2) * 100) / 100
        : null;

    res.json(
      GetBacklinkSummaryResponse.parse({
        ...base,
        configured: true,
        backlinks: summary.backlinks,
        referringDomains: summary.referringDomains,
        referringMainDomains: summary.referringMainDomains,
        brokenBacklinks: summary.brokenBacklinks,
        dataforseoRank: summary.rank,
        dataforseoScore,
        hybridScore,
        cachedAt: cachedAt.toISOString(),
        message:
          summary.backlinks === null
            ? "DataForSEO returned no data for this domain."
            : null,
      }),
    );
  } catch (err) {
    req.log.error({ err }, "DataForSEO request failed");
    res.status(502).json({
      error: "DataForSEO request failed. Check credentials and account balance, then try again.",
    });
  }
});

export default router;
