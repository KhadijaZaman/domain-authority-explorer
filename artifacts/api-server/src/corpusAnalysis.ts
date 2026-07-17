/**
 * Pure analysis functions for the Common Crawl corpus audit.
 *
 * Input is one slim CDX snapshot per crawl (oldest → newest); output matches
 * the CorpusAnalysis schema in the OpenAPI spec. Single-crawl checks (§1 of
 * the spec) run against the NEWEST crawl; multi-crawl checks (§2) run across
 * all of them.
 */

import type { InspectedPage, RobotsHistoryData } from "./corpusDeep";
import type { SitemapData, WaybackData } from "./corpusSources";

/** Slim CDX capture record as cached in corpus_snapshots.records. */
export interface SlimRecord {
  u: string; // url
  s: string; // status
  d: string; // digest (SHA-1 of body, base32)
  l: number; // compressed length in bytes
  m: string; // mime (as declared by the server)
  g?: string; // languages ("eng") — absent when no text was extractable
  b: "warc" | "diag" | "robots" | "other"; // filename bucket
  r?: string; // redirect target (3xx only)
  t: string; // timestamp
  md?: string; // mime-detected, only when it differs from declared
  f?: string; // WARC filename (warc bucket only) — for byte-range inspection
  o?: number; // WARC byte offset (warc bucket only)
}

export interface CrawlSnapshot {
  crawlId: string;
  records: SlimRecord[];
  truncated: boolean;
}

const EMPTY_DIGEST = "3I42H3S6NNFQ2MSVX7XZKYAYSCX5QBYJ"; // SHA-1 of ""

function basePath(url: string): string {
  return url.split("?")[0] ?? url;
}

function hostOf(url: string): string {
  const m = /^https?:\/\/([^/]+)/.exec(url);
  return (m?.[1] ?? "").toLowerCase();
}

function hasParams(url: string): boolean {
  return url.includes("?");
}

function paramsOf(url: string): [string, string][] {
  const q = url.split("?")[1];
  if (!q) return [];
  return q.split("&").map((kv) => {
    const i = kv.indexOf("=");
    return i < 0 ? [kv, ""] : [kv.slice(0, i), kv.slice(i + 1)];
  });
}

function classifyParam(key: string): string {
  const k = key.toLowerCase();
  if (/^utm_/.test(k) || ["ref", "fbclid", "gclid", "msclkid", "mc_cid", "mc_eid"].includes(k)) return "tracking";
  if (["sid", "sessionid", "phpsessid", "session_id"].includes(k)) return "session";
  if (["page", "p", "offset"].includes(k)) return "pagination";
  if (["sort", "order", "color", "size", "filter", "tab", "view"].includes(k)) return "filter";
  if (["id", "q", "s", "search"].includes(k)) return "functional";
  return "other";
}

function brokenParamReason(key: string, value: string): string | null {
  const k = key.toLowerCase();
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    /* keep raw */
  }
  if (decoded === "-") return `${key} is a literal "-" placeholder that was never replaced`;
  if (k === "utm_source" && decoded.toLowerCase() === "organic")
    return "utm_source=organic is a contradiction — a UTM-tagged visit is by definition not organic";
  if (decoded !== decoded.trim() && decoded.trim().length > 0)
    return `${key} carries leading/trailing whitespace — a typo baked into a permanent phantom URL`;
  if (k.startsWith("utm_") && decoded === "") return `${key} is present but empty`;
  return null;
}

/** True when a 200 was archived to WARC (the only productive fetch). */
function isArchived(r: SlimRecord): boolean {
  return r.s === "200" && r.b === "warc";
}

function isHomepagePath(path: string, domain: string): boolean {
  const m = /^https?:\/\/([^/]+)(\/?)$/.exec(path);
  if (!m) return false;
  const host = m[1]!.toLowerCase();
  return host === domain || host === `www.${domain}`;
}

export interface RobotsLive {
  checked: boolean;
  blockedBots: string[];
}

export interface AuditExtras {
  inspection: { crawlId: string; pages: InspectedPage[] } | null;
  sitemap: SitemapData | null;
  wayback: WaybackData | null;
  robotsHistory: RobotsHistoryData | null;
}

const LOCALE_LANG: Record<string, string> = {
  en: "eng", es: "spa", fr: "fra", de: "deu", it: "ita", pt: "por",
  nl: "nld", ja: "jpn", zh: "zho", ko: "kor", ru: "rus", pl: "pol",
  sv: "swe", tr: "tur", ar: "ara", da: "dan", fi: "fin", no: "nor",
};

function pathDepth(url: string): number {
  const path = basePath(url).replace(/^https?:\/\/[^/]+/, "");
  return path.split("/").filter(Boolean).length;
}

/** Normalize away the four "duplication family" axes to group equivalents. */
function familyKey(url: string): string {
  return basePath(url)
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/index\.html?$/, "")
    .replace(/\/$/, "")
    .toLowerCase();
}

export function analyzeCorpus(
  domain: string,
  snapshots: CrawlSnapshot[],
  robotsLive: RobotsLive,
  extras: AuditExtras,
) {
  const latest = snapshots[snapshots.length - 1]!;
  const recs = latest.records;
  const total = recs.length;

  // ---- Presence (§1.1)
  const archived = recs.filter(isArchived);
  const cleanPages = new Set(
    archived.filter((r) => !hasParams(r.u)).map((r) => r.u),
  ).size;
  const rating =
    total === 0
      ? "absent"
      : cleanPages >= 100
        ? "well discovered"
        : cleanPages >= 10
          ? "normal small site"
          : cleanPages >= 1
            ? "barely discovered"
            : "params only";

  // ---- robots.txt in corpus (§1.2)
  const robotsRec = recs.find((r) => /\/robots\.txt$/.test(basePath(r.u)));

  // ---- Status distribution + efficiency (§1.3)
  const statusCounts = new Map<string, number>();
  for (const r of recs) statusCounts.set(r.s, (statusCounts.get(r.s) ?? 0) + 1);
  const statusDistribution = [...statusCounts.entries()]
    .map(([status, count]) => ({ status, count }))
    .sort((a, b) => b.count - a.count);
  const clean200NoParam = archived.filter((r) => !hasParams(r.u)).length;
  const crawlEfficiency = total > 0 ? clean200NoParam / total : 0;

  // ---- Duplication factor per path (§1.4) + digest variance (§1.6)
  const byPath = new Map<string, SlimRecord[]>();
  for (const r of recs) {
    if (!isArchived(r)) continue;
    const p = basePath(r.u);
    const arr = byPath.get(p) ?? [];
    arr.push(r);
    byPath.set(p, arr);
  }
  const cleanUrlSet = new Set(
    recs.filter((r) => !hasParams(r.u)).map((r) => r.u),
  );
  const topPaths = [...byPath.entries()]
    .map(([path, rs]) => ({
      path,
      variants: new Set(rs.map((r) => r.u)).size,
      distinctDigests: new Set(rs.map((r) => r.d)).size,
      cleanExists: cleanUrlSet.has(path) || cleanUrlSet.has(path.replace(/\/$/, "")) || cleanUrlSet.has(`${path}/`),
    }))
    .filter((p) => p.variants > 1)
    .sort((a, b) => b.variants - a.variants)
    .slice(0, 15);
  const urls200 = new Set(archived.map((r) => r.u)).size;
  const duplicationFactor =
    byPath.size > 0 ? Math.round((urls200 / byPath.size) * 100) / 100 : 1;

  // ---- Param taxonomy + broken params (§1.4)
  const classCounts = new Map<string, { count: number; examples: Set<string> }>();
  const brokenParams: { url: string; reason: string }[] = [];
  const seenBroken = new Set<string>();
  for (const r of recs) {
    for (const [k, v] of paramsOf(r.u)) {
      const cls = classifyParam(k);
      const entry = classCounts.get(cls) ?? { count: 0, examples: new Set() };
      entry.count++;
      if (entry.examples.size < 5) entry.examples.add(k);
      classCounts.set(cls, entry);
      const reason = brokenParamReason(k, v);
      if (reason && !seenBroken.has(r.u) && brokenParams.length < 25) {
        seenBroken.add(r.u);
        brokenParams.push({ url: r.u, reason });
      }
    }
  }
  const paramClasses = [...classCounts.entries()]
    .map(([cls, e]) => ({ class: cls, count: e.count, examples: [...e.examples] }))
    .sort((a, b) => b.count - a.count);

  // ---- Canonical presence (§1.5) — paths that exist ONLY parameterized
  const canonicalMissing: { path: string; variantCount: number; isHomepage: boolean }[] = [];
  for (const [path, rs] of byPath.entries()) {
    const variants = new Set(rs.map((r) => r.u));
    const cleanExists =
      cleanUrlSet.has(path) ||
      cleanUrlSet.has(path.replace(/\/$/, "")) ||
      cleanUrlSet.has(`${path}/`);
    if (!cleanExists && [...variants].every((u) => hasParams(u))) {
      canonicalMissing.push({
        path,
        variantCount: variants.size,
        isHomepage: isHomepagePath(path, domain),
      });
    }
  }
  canonicalMissing.sort(
    (a, b) => Number(b.isHomepage) - Number(a.isHomepage) || b.variantCount - a.variantCount,
  );

  // ---- JS-blindness / thin content (§1.7)
  const jsBlindSeen = new Set<string>();
  const jsBlindPages = archived
    .filter((r) => r.l < 5120 && !r.g && r.d !== EMPTY_DIGEST)
    .sort((a, b) => a.l - b.l)
    .filter((r) => !jsBlindSeen.has(r.u) && jsBlindSeen.add(r.u))
    .slice(0, 20)
    .map((r) => ({ url: r.u, length: r.l }));

  // ---- Redirect inventory (§1.8)
  const redirectRecs = recs.filter((r) => r.s.startsWith("3"));
  // Legacy-taxonomy detection: ≥3 redirects sharing a first path segment
  const segCounts = new Map<string, number>();
  for (const r of redirectRecs) {
    const seg = /^https?:\/\/[^/]+(\/[^/?]+)/.exec(r.u)?.[1];
    if (seg) segCounts.set(seg, (segCounts.get(seg) ?? 0) + 1);
  }
  const redirects = redirectRecs.slice(0, 50).map((r) => {
    const target = r.r ?? "";
    const seg = /^https?:\/\/[^/]+(\/[^/?]+)/.exec(r.u)?.[1];
    let kind = "other";
    if (target === `${r.u}/` || `${target}/` === r.u || target === r.u.replace(/\/$/, ""))
      kind = "trailing-slash";
    else if (hasParams(target)) kind = "param-carry";
    else if (hostOf(r.u) !== hostOf(target) && hostOf(r.u).replace(/^www\./, "") === hostOf(target).replace(/^www\./, ""))
      kind = "host-normalization";
    else if (seg && (segCounts.get(seg) ?? 0) >= 3) kind = "legacy-taxonomy";
    return { status: r.s, url: r.u, target, kind };
  });

  // ---- 404 inventory (§1.9)
  const notFound = recs
    .filter((r) => r.s === "404" || r.s === "410")
    .slice(0, 50)
    .map((r) => {
      const path = basePath(r.u);
      let diagnosis = "a live link points at a missing page";
      if (path.includes(`/${domain}`))
        diagnosis = "malformed href — a link written without https:// resolved as a relative path";
      else if (/\/page\/\d+\/?$/.test(path)) diagnosis = "dead pagination page still linked";
      const seg = /^https?:\/\/[^/]+(\/[^/?]+)/.exec(r.u)?.[1];
      if (seg && (segCounts.get(seg) ?? 0) >= 3)
        diagnosis = "legacy path family — siblings redirect but this one 404s (redirect map has gaps)";
      return { url: r.u, diagnosis };
    });

  // ---- MIME inventory (§1.10)
  const mimeCounts = new Map<string, number>();
  for (const r of recs) mimeCounts.set(r.m, (mimeCounts.get(r.m) ?? 0) + 1);
  const mimeBreakdown = [...mimeCounts.entries()]
    .map(([mime, count]) => ({ mime, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const publicPdfs = [
    ...new Set(recs.filter((r) => r.m === "application/pdf" && r.s === "200").map((r) => r.u)),
  ].slice(0, 20);

  // ---- Subdomain coverage (§1.11)
  const hostCounts = new Map<string, number>();
  for (const r of recs) {
    const h = hostOf(r.u);
    if (h) hostCounts.set(h, (hostCounts.get(h) ?? 0) + 1);
  }
  const subdomains = [...hostCounts.entries()]
    .map(([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // ---- Pagination bloat (§1.12)
  const deepPagination = [
    ...new Set(
      recs
        .filter((r) => /\/page\/([2-9]|\d{2,})\/?($|\?)/.test(r.u) && r.s === "200")
        .map((r) => basePath(r.u)),
    ),
  ].slice(0, 20);

  // ---- Multi-crawl (§2)
  const coverageTrend = snapshots.map((s) => ({
    crawlId: s.crawlId,
    cleanPages: new Set(
      s.records.filter((r) => isArchived(r) && !hasParams(r.u)).map((r) => r.u),
    ).size,
    totalRecords: s.records.length,
  }));

  const appearances = new Map<string, number>();
  for (const s of snapshots) {
    const urls = new Set(
      s.records.filter((r) => isArchived(r) && !hasParams(r.u)).map((r) => r.u),
    );
    for (const u of urls) appearances.set(u, (appearances.get(u) ?? 0) + 1);
  }
  const recrawlTop = [...appearances.entries()]
    .map(([url, n]) => ({ url, appearances: n, totalCrawls: snapshots.length }))
    .sort((a, b) => b.appearances - a.appearances || a.url.localeCompare(b.url))
    .slice(0, 25);

  // Displacement (§2.2): compare the two newest crawls
  let displacement = {
    droppedContent: [] as string[],
    addedParamUrls: [] as string[],
    verdict: "Need at least two crawls to test displacement.",
  };
  if (snapshots.length >= 2) {
    const prev = snapshots[snapshots.length - 2]!;
    // Compare like with like: content = archived clean pages; "dropped" means
    // the URL got no capture of ANY kind in the newest crawl.
    const prevContent = new Set(
      prev.records.filter((r) => isArchived(r) && !hasParams(r.u)).map((r) => r.u),
    );
    const prevAll = new Set(prev.records.map((r) => r.u));
    const currAll = new Set(recs.map((r) => r.u));
    const dropped = [...prevContent].filter((u) => !currAll.has(u)).slice(0, 30);
    const addedParams = [
      ...new Set(recs.filter((r) => hasParams(r.u)).map((r) => r.u)),
    ]
      .filter((u) => !prevAll.has(u))
      .slice(0, 30);
    let verdict = "No displacement signal — content pages were not dropped between the two newest crawls.";
    if (dropped.length > 0 && addedParams.length > 0) {
      verdict = `Possible displacement: ${dropped.length} content URLs dropped out while ${addedParams.length} new parameterized URLs entered. New param URLs look novel to the scheduler and can crowd out known pages — but a moved path or changed external links are also possible. Treat as a lead, not a verdict.`;
    } else if (dropped.length > 0) {
      verdict = `${dropped.length} content URLs from the previous crawl are missing from the newest one, but no new param URLs appeared — more likely reduced budget or changed links than displacement.`;
    }
    displacement = { droppedContent: dropped, addedParamUrls: addedParams, verdict };
  }

  // Decay (§2.6): in any older crawl, absent from the two newest
  let decayedUrls: string[] = [];
  if (snapshots.length >= 3) {
    // "Still in the corpus" = archived in a recent crawl. A page that now
    // only 404s or redirects has decayed even though it was still fetched.
    const recent = new Set<string>();
    for (const s of snapshots.slice(-2))
      for (const r of s.records) if (isArchived(r)) recent.add(r.u);
    const older = new Set<string>();
    for (const s of snapshots.slice(0, -2))
      for (const r of s.records) if (isArchived(r) && !hasParams(r.u)) older.add(r.u);
    decayedUrls = [...older].filter((u) => !recent.has(u)).slice(0, 30);
  }

  // ---- Duplication family (§ new): protocol / www / trailing-slash / index
  const cleanArchivedUrls = [...new Set(archived.filter((r) => !hasParams(r.u)).map((r) => r.u))];
  const families = new Map<string, string[]>();
  for (const u of cleanArchivedUrls) {
    const k = familyKey(u);
    const arr = families.get(k) ?? [];
    arr.push(u);
    families.set(k, arr);
  }
  let protocolDupes = 0, hostDupes = 0, slashDupes = 0, indexDupes = 0;
  const dupFamilyExamples: { key: string; forms: string[] }[] = [];
  for (const [k, forms] of families) {
    if (forms.length < 2) continue;
    const protos = new Set(forms.map((u) => (u.startsWith("https") ? "https" : "http")));
    const hosts = new Set(forms.map((u) => hostOf(u).replace(/^www\./, "") + (hostOf(u).startsWith("www.") ? "|www" : "|bare")));
    if (protos.size > 1) protocolDupes++;
    if (new Set(forms.map((u) => hostOf(u))).size > 1) hostDupes++;
    if (forms.some((u) => /\/$/.test(basePath(u).replace(/^https?:\/\/[^/]+/, "") || "/") && basePath(u).replace(/^https?:\/\/[^/]+/, "") !== "/") && forms.some((u) => !/\/$/.test(basePath(u)))) slashDupes++;
    if (forms.some((u) => /\/index\.html?$/.test(basePath(u)))) indexDupes++;
    if (dupFamilyExamples.length < 10) dupFamilyExamples.push({ key: k, forms: forms.slice(0, 4) });
    void hosts;
  }
  const dupFamily = {
    protocolDupes,
    hostDupes,
    slashDupes,
    indexDupes,
    examples: dupFamilyExamples,
  };

  // ---- Depth vs presence curve (§ new)
  const depthSeen = new Map<number, Set<string>>();
  const depthArchived = new Map<number, Set<string>>();
  for (const r of recs) {
    if (hasParams(r.u)) continue;
    const d = Math.min(pathDepth(r.u), 8);
    (depthSeen.get(d) ?? depthSeen.set(d, new Set()).get(d)!).add(basePath(r.u));
    if (isArchived(r))
      (depthArchived.get(d) ?? depthArchived.set(d, new Set()).get(d)!).add(basePath(r.u));
  }
  const depthCurve = [...depthSeen.keys()]
    .sort((a, b) => a - b)
    .map((depth) => {
      const seen = depthSeen.get(depth)!.size;
      const arch = depthArchived.get(depth)?.size ?? 0;
      return { depth, seen, archived: arch, rate: seen > 0 ? Math.round((arch / seen) * 100) / 100 : 0 };
    });

  // ---- mime vs mime-detected (§ new)
  const mimeSeen = new Set<string>();
  const mimeMismatches = recs
    .filter((r) => r.md && r.s === "200")
    .filter((r) => !mimeSeen.has(r.u) && mimeSeen.add(r.u))
    .slice(0, 15)
    .map((r) => ({ url: r.u, declared: r.m, detected: r.md! }));
  const mimeMismatchCount = mimeSeen.size;

  // ---- crawl-trap detection: per-param value cardinality (§ new)
  const paramValues = new Map<string, Set<string>>();
  for (const r of recs) {
    for (const [k, v] of paramsOf(r.u)) {
      (paramValues.get(k) ?? paramValues.set(k, new Set()).get(k)!).add(v);
    }
  }
  const paramCardinality = [...paramValues.entries()]
    .map(([key, vals]) => ({
      key,
      distinctValues: vals.size,
      trap: vals.size >= 30,
      examples: [...vals].slice(0, 3),
    }))
    .sort((a, b) => b.distinctValues - a.distinctValues)
    .slice(0, 12);
  const trapParams = paramCardinality.filter((p) => p.trap);

  // ---- redirect chains, loops, chains → 404 (§ new)
  const redirectMap = new Map<string, string>();
  for (const r of redirectRecs) if (r.r) redirectMap.set(r.u, r.r);
  const statusOf = new Map<string, string>();
  for (const r of recs) {
    const prev = statusOf.get(r.u);
    if (!prev || r.s === "200") statusOf.set(r.u, r.s);
  }
  const redirectTargets = new Set(redirectMap.values());
  const redirectChains: { hops: string[]; finalStatus: string | null; loop: boolean; endsIn404: boolean }[] = [];
  for (const start of redirectMap.keys()) {
    if (redirectTargets.has(start)) continue; // only walk from chain heads
    const hops = [start];
    const seen = new Set([start]);
    let cur = start;
    let loop = false;
    while (redirectMap.has(cur) && hops.length <= 6) {
      cur = redirectMap.get(cur)!;
      if (seen.has(cur)) { loop = true; hops.push(cur); break; }
      seen.add(cur);
      hops.push(cur);
    }
    const finalStatus = statusOf.get(cur) ?? null;
    const endsIn404 = finalStatus === "404" || finalStatus === "410";
    if (hops.length >= 3 || loop || endsIn404) {
      redirectChains.push({ hops, finalStatus, loop, endsIn404 });
    }
    if (redirectChains.length >= 15) break;
  }
  redirectChains.sort((a, b) => Number(b.loop) - Number(a.loop) || Number(b.endsIn404) - Number(a.endsIn404) || b.hops.length - a.hops.length);

  // ---- language detection vs locale paths (§ new)
  const langCounts = new Map<string, number>();
  for (const r of archived) {
    if (!r.g) continue;
    const primary = r.g.split(",")[0]!;
    langCounts.set(primary, (langCounts.get(primary) ?? 0) + 1);
  }
  const languageBreakdown = [...langCounts.entries()]
    .map(([language, count]) => ({ language, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const localeMismatches: { url: string; localeInPath: string; expected: string; detected: string }[] = [];
  const localeSeen = new Set<string>();
  for (const r of archived) {
    if (localeMismatches.length >= 10) break;
    if (localeSeen.has(r.u)) continue;
    localeSeen.add(r.u);
    const m = /^https?:\/\/[^/]+\/([a-z]{2})(?:-[a-z]{2})?\//.exec(r.u);
    if (!m) continue;
    const expected = LOCALE_LANG[m[1]!];
    if (!expected || !r.g) continue;
    const primary = r.g.split(",")[0]!;
    if (primary !== expected)
      localeMismatches.push({ url: r.u, localeInPath: m[1]!, expected, detected: primary });
  }

  // ---- corpus inception (§ new; Wayback = observed web inception since 1996)
  const firstAuditCrawl = snapshots.find((s) => s.records.length > 0)?.crawlId ?? null;
  const inception = {
    firstAuditCrawl,
    waybackFirstCapture: extras.wayback?.firstCapture ?? null,
    waybackFirstUrl: extras.wayback?.firstUrl ?? null,
    waybackYearsActive: extras.wayback?.yearsActive ?? [],
    waybackReachable: extras.wayback?.reachable ?? false,
  };

  // ---- header + declared-canonical inspection (§ new, from WARC content)
  const stripSlash = (u: string) => basePath(u).replace(/\/$/, "");
  let inspection: null | {
    crawlId: string;
    pagesInspected: number;
    headerNoindex: { url: string; xRobotsTag: string }[];
    canonicalTable: { url: string; declared: string | null; declaredVia: string | null; cleanInCorpus: boolean; verdict: string }[];
  } = null;
  if (extras.inspection) {
    const headerNoindex = extras.inspection.pages
      .filter((p) => p.xRobotsTag && /noindex/i.test(p.xRobotsTag))
      .map((p) => ({ url: p.url, xRobotsTag: p.xRobotsTag! }));
    const canonicalTable = extras.inspection.pages.map((p) => {
      const declared = p.htmlCanonical ?? p.headerCanonical;
      const declaredVia = p.htmlCanonical ? "html" : p.headerCanonical ? "header" : null;
      const cleanForm = stripSlash(p.url);
      const cleanInCorpus =
        cleanUrlSet.has(cleanForm) || cleanUrlSet.has(`${cleanForm}/`);
      let verdict: string;
      if (!declared) {
        verdict = cleanInCorpus
          ? "No canonical tag — fine while only the clean URL circulates, fragile the moment params appear."
          : "Tag problem: no canonical declared AND no clean copy in the corpus.";
      } else if (stripSlash(declared) === cleanForm) {
        verdict = cleanInCorpus
          ? "Healthy: self-referencing canonical and the clean URL is archived."
          : "Declared correctly but never fetched clean — a link-graph problem, not a tag problem. Canonical tags won't fix it; the links pointing here need cleaning.";
      } else {
        verdict = "Canonical points elsewhere — verify that's intentional.";
      }
      return { url: p.url, declared, declaredVia, cleanInCorpus, verdict };
    });
    inspection = {
      crawlId: extras.inspection.crawlId,
      pagesInspected: extras.inspection.pages.length,
      headerNoindex,
      canonicalTable,
    };
  }

  // ---- sitemap × corpus matrix + lastmod lie detector (§ new)
  let sitemapAudit: null | {
    source: string | null;
    sitemapUrls: number;
    truncated: boolean;
    inBoth: number;
    sitemapOnly: number;
    corpusOnly: number;
    sitemapOnlyExamples: string[];
    corpusOnlyExamples: string[];
    lastmodLies: { url: string; lastmod: string; crawlsUnchanged: number }[];
  } = null;
  if (extras.sitemap?.found) {
    const norm = (u: string) => stripSlash(u).replace(/^https?:\/\//, "").replace(/^www\./, "");
    const corpusSet = new Set(recs.map((r) => norm(r.u)));
    const smUrls = extras.sitemap.urls;
    const smSet = new Set(smUrls.map((s) => norm(s.u)));
    const smOnly = smUrls.filter((s) => !corpusSet.has(norm(s.u)));
    const corpusClean = cleanArchivedUrls.filter((u) => !smSet.has(norm(u)));
    // lastmod lie: captures exist both before and after the claimed date with
    // an identical digest → the content did not change when the sitemap says.
    const digestHistory = new Map<string, { ts: string; d: string }[]>();
    for (const s of snapshots) {
      for (const r of s.records) {
        if (!isArchived(r)) continue;
        const k = norm(r.u);
        (digestHistory.get(k) ?? digestHistory.set(k, []).get(k)!).push({ ts: r.t, d: r.d });
      }
    }
    const lastmodLies: { url: string; lastmod: string; crawlsUnchanged: number }[] = [];
    const lieSeen = new Set<string>();
    for (const s of smUrls) {
      if (!s.lm || lastmodLies.length >= 15) continue;
      if (lieSeen.has(s.u)) continue;
      lieSeen.add(s.u);
      const hist = digestHistory.get(norm(s.u));
      if (!hist || hist.length < 2) continue;
      const lmTs = s.lm.replace(/[^0-9]/g, "").slice(0, 8);
      if (lmTs.length < 8) continue;
      const before = hist.filter((h) => h.ts.slice(0, 8) < lmTs);
      const after = hist.filter((h) => h.ts.slice(0, 8) > lmTs);
      if (before.length === 0 || after.length === 0) continue;
      const digests = new Set(hist.map((h) => h.d));
      if (digests.size === 1) {
        lastmodLies.push({ url: s.u, lastmod: s.lm, crawlsUnchanged: hist.length });
      }
    }
    sitemapAudit = {
      source: extras.sitemap.source,
      sitemapUrls: smUrls.length,
      truncated: extras.sitemap.truncated,
      inBoth: smUrls.length - smOnly.length,
      sitemapOnly: smOnly.length,
      corpusOnly: corpusClean.length,
      sitemapOnlyExamples: smOnly.slice(0, 15).map((s) => s.u),
      corpusOnlyExamples: corpusClean.slice(0, 10),
      lastmodLies,
    };
  }

  // ---- robots.txt history timeline (§ new — "the standout")
  let robotsHistory: null | {
    complete: boolean;
    crawlsChecked: number;
    timeline: { crawlId: string; timestamp: string; status: string; blockedBots: string[] | null }[];
    botEvents: { bot: string; firstBlockedCrawl: string; stillBlocked: boolean }[];
  } = null;
  if (extras.robotsHistory) {
    const entries = extras.robotsHistory.entries;
    const botEvents: { bot: string; firstBlockedCrawl: string; stillBlocked: boolean }[] = [];
    const lastWithBots = [...entries].reverse().find((e) => e.bots !== null);
    const allBots = new Set(entries.flatMap((e) => e.bots ?? []));
    for (const bot of allBots) {
      const first = entries.find((e) => e.bots?.includes(bot));
      if (first)
        botEvents.push({
          bot,
          firstBlockedCrawl: first.c,
          stillBlocked: lastWithBots?.bots?.includes(bot) ?? false,
        });
    }
    robotsHistory = {
      complete: extras.robotsHistory.complete,
      crawlsChecked: extras.robotsHistory.checkedCrawls.length,
      timeline: entries.map((e) => ({
        crawlId: e.c,
        timestamp: e.t,
        status: e.s,
        blockedBots: e.bots,
      })),
      botEvents,
    };
  }

  // ---- Health score (§6)
  const allPaths = byPath.size;
  const pathsWithClean = [...byPath.keys()].filter(
    (p) => cleanUrlSet.has(p) || cleanUrlSet.has(p.replace(/\/$/, "")) || cleanUrlSet.has(`${p}/`),
  ).length;
  const s200 = archived;
  const extractable = s200.filter((r) => r.g).length;
  const wasteRate =
    total > 0
      ? recs.filter((r) => r.s.startsWith("3") || r.s.startsWith("4")).length / total
      : 0;
  const components = [
    { name: "Presence", weight: 20, score: Math.min(1, Math.log10(cleanPages + 1) / 2) },
    { name: "Canonical integrity", weight: 25, score: allPaths > 0 ? pathsWithClean / allPaths : 1 },
    { name: "Crawl efficiency", weight: 20, score: crawlEfficiency },
    { name: "Duplication", weight: 15, score: Math.min(1, 1 / duplicationFactor) },
    { name: "Waste", weight: 10, score: 1 - wasteRate },
    { name: "Extractability", weight: 10, score: s200.length > 0 ? extractable / s200.length : 0 },
  ].map((c) => ({ ...c, score: Math.round(c.score * 100) / 100 }));
  const healthTotal =
    Math.round(components.reduce((sum, c) => sum + c.weight * c.score, 0) * 10) / 10;

  // ---- Severity ladder (§6)
  const severities: { level: string; title: string; detail: string }[] = [];
  const homeMissing = canonicalMissing.find((c) => c.isHomepage);
  if (homeMissing) {
    severities.push({
      level: "critical",
      title: "Homepage has no clean version in the corpus",
      detail: `${homeMissing.variantCount} parameterized copies of the homepage were archived, but the bare URL never was. The brand-defining page exists only as fragments.`,
    });
  }
  const criticalBots = robotsLive.blockedBots.filter((b) =>
    ["CCBot", "GPTBot", "ClaudeBot"].includes(b),
  );
  if (criticalBots.length > 0) {
    severities.push({
      level: "critical",
      title: `robots.txt blocks ${criticalBots.join(", ")}`,
      detail: "These crawlers feed the corpora behind major AI systems. If this block is intentional, fine — but it should be a decision, not an accident.",
    });
  }
  for (const p of topPaths.filter((p) => p.variants > 5).slice(0, 3)) {
    severities.push({
      level: "high",
      title: `Duplication factor ${p.variants} on ${p.path}`,
      detail: `One page is eating ${p.variants} crawl slots${p.distinctDigests > 1 ? ` and rendering ${p.distinctDigests} distinct byte-versions, so exact-match dedup can't collapse them` : ""}.`,
    });
  }
  if (notFound.some((n) => n.diagnosis.startsWith("malformed href"))) {
    severities.push({
      level: "high",
      title: "Malformed hrefs are generating phantom 404s",
      detail: "Links written without https:// resolve as relative paths. Search the CMS for href=\"" + domain + " without a scheme.",
    });
  }
  if (redirects.some((r) => r.kind === "legacy-taxonomy")) {
    severities.push({
      level: "high",
      title: "Legacy URL structure still being linked",
      detail: "Multiple old paths under the same section still receive fetches — every 3xx in the index proves a live link to it exists somewhere.",
    });
  }
  if (redirects.some((r) => r.kind === "param-carry")) {
    severities.push({
      level: "medium",
      title: "Redirects carry params through",
      detail: "Redirect chains that keep query params terminate in duplicates. Strip params at the redirect.",
    });
  }
  if (deepPagination.length > 0) {
    severities.push({
      level: "medium",
      title: `${deepPagination.length} deep pagination pages consuming budget`,
      detail: "The crawler is walking archive pages instead of content. Consider noindex on page/2+ or canonical to page 1.",
    });
  }
  if (redirects.some((r) => r.kind === "trailing-slash")) {
    severities.push({
      level: "low",
      title: "Trailing-slash redirects",
      detail: "Internal or external links omit the trailing slash, spending a fetch on a 301 each time.",
    });
  }
  if (inspection && inspection.headerNoindex.length > 0) {
    severities.unshift({
      level: "critical",
      title: `${inspection.headerNoindex.length} page(s) served with a header noindex`,
      detail:
        "X-Robots-Tag: noindex arrives as an HTTP header — invisible in view-source. These pages 200 in the corpus but are doing nothing for you anywhere. Usually a staging config that escaped.",
    });
  }
  if (redirectChains.some((c) => c.loop)) {
    severities.push({
      level: "high",
      title: "Redirect loop detected",
      detail: "At least one redirect chain circles back on itself. Every fetch into the loop is a wasted crawl slot that never resolves.",
    });
  }
  if (redirectChains.some((c) => c.endsIn404)) {
    severities.push({
      level: "high",
      title: "Redirect chains terminate in 404",
      detail: "The worst case: a live link, one or more hops of redirects, and a dead page at the end. Fix the final target or retire the chain.",
    });
  }
  if (trapParams.length > 0) {
    severities.push({
      level: "high",
      title: `Possible crawl trap: ${trapParams.map((p) => `?${p.key}=`).join(", ")}`,
      detail: `High value-cardinality on a parameter means a near-infinite URL space (${trapParams[0]!.distinctValues} distinct values on ?${trapParams[0]!.key}=). Calendars and faceted filters are the usual culprits.`,
    });
  }
  if (dupFamily.protocolDupes + dupFamily.hostDupes > 0) {
    severities.push({
      level: "medium",
      title: "Protocol / host duplication in the corpus",
      detail: `${dupFamily.protocolDupes} path(s) archived under both http and https, ${dupFamily.hostDupes} under both www and bare host. Each doubles a page's crawl cost. One 301 policy fixes it.`,
    });
  }
  if (sitemapAudit && sitemapAudit.sitemapOnly > 0) {
    severities.push({
      level: "medium",
      title: `${sitemapAudit.sitemapOnly} sitemap URLs never made it into the corpus`,
      detail: "Declared but not discovered — the crawler either never saw a link to these or didn't spend budget on them. This is the cell that separates 'displaced' from 'never found'.",
    });
  }
  if (sitemapAudit && sitemapAudit.lastmodLies.length > 0) {
    severities.push({
      level: "low",
      title: `Sitemap lastmod claims changes the corpus never saw (${sitemapAudit.lastmodLies.length} URLs)`,
      detail: "Captures before and after the claimed date have identical content digests. CMSes that stamp lastmod on every build train crawlers to ignore the field.",
    });
  }
  if (mimeMismatchCount > 0) {
    severities.push({
      level: "low",
      title: `${mimeMismatchCount} content-type mismatches`,
      detail: "The server declared one MIME type; Common Crawl's detector saw another. Usually a misconfigured content-type header.",
    });
  }
  if (localeMismatches.length > 0) {
    severities.push({
      level: "low",
      title: "Locale paths detected as the wrong language",
      detail: "Pages under a locale path were language-detected as something else — often thin translations where the navigation dominates the body.",
    });
  }
  if (publicPdfs.length > 0) {
    severities.push({
      level: "info",
      title: `${publicPdfs.length} PDFs publicly in the corpus`,
      detail: "Gated lead magnets at public URLs are in the corpus. May be fine (citable) or not (lead capture bypassed) — it should be a decision.",
    });
  }

  return {
    crawlId: latest.crawlId,
    totalRecords: total,
    truncated: latest.truncated,
    presence: { records: total, cleanPages, rating },
    robots: {
      inCorpus: !!robotsRec,
      status: robotsRec?.s ?? null,
      liveChecked: robotsLive.checked,
      liveBlockedBots: robotsLive.blockedBots,
    },
    statusDistribution,
    crawlEfficiency: Math.round(crawlEfficiency * 1000) / 1000,
    duplication: { factor: duplicationFactor, topPaths },
    paramClasses,
    brokenParams,
    canonicalMissing: canonicalMissing.slice(0, 20),
    jsBlindPages,
    redirects,
    notFound,
    mimeBreakdown,
    publicPdfs,
    subdomains,
    deepPagination,
    healthScore: { total: healthTotal, components },
    severities,
    coverageTrend,
    recrawlTop,
    displacement,
    decayedUrls,
    dupFamily,
    depthCurve,
    mimeMismatches: { count: mimeMismatchCount, examples: mimeMismatches },
    paramCardinality,
    redirectChains,
    languages: { breakdown: languageBreakdown, localeMismatches },
    inception,
    inspection,
    sitemapAudit,
    robotsHistory,
  };
}
