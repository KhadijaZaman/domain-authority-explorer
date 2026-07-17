/**
 * Extra data sources for the corpus audit beyond the CC CDX index:
 * - the site's live sitemap.xml (declared URLs + lastmod)
 * - the Internet Archive Wayback CDX (same pywb protocol, history to 1996)
 */
import { fetchPublicText } from "./routes/insights";

function log(message: string, extra: Record<string, unknown> = {}) {
  console.log(JSON.stringify({ src: "corpus-sources", message, ...extra }));
}

// -------------------------------------------------------------------- sitemap

export interface SitemapUrl {
  u: string;
  lm?: string; // lastmod, as declared
}

export interface SitemapData {
  found: boolean;
  source: string | null; // which sitemap URL worked
  urls: SitemapUrl[];
  truncated: boolean;
  childSitemaps: number;
}

const SITEMAP_URL_CAP = 2000;
const SITEMAP_CHILD_CAP = 3;

function parseSitemapXml(xml: string): { urls: SitemapUrl[]; children: string[] } {
  const children: string[] = [];
  const urls: SitemapUrl[] = [];
  if (/<sitemapindex/i.test(xml)) {
    for (const m of xml.matchAll(/<sitemap>([\s\S]*?)<\/sitemap>/gi)) {
      const loc = /<loc>\s*([^<]+?)\s*<\/loc>/i.exec(m[1]!)?.[1];
      if (loc) children.push(loc.trim());
    }
    return { urls, children };
  }
  for (const m of xml.matchAll(/<url>([\s\S]*?)<\/url>/gi)) {
    const block = m[1]!;
    const loc = /<loc>\s*([^<]+?)\s*<\/loc>/i.exec(block)?.[1];
    if (!loc) continue;
    const lm = /<lastmod>\s*([^<]+?)\s*<\/lastmod>/i.exec(block)?.[1];
    const entry: SitemapUrl = { u: loc.trim() };
    if (lm) entry.lm = lm.trim();
    urls.push(entry);
    if (urls.length >= SITEMAP_URL_CAP) break;
  }
  return { urls, children };
}

/** Fetch the live sitemap (robots.txt `Sitemap:` directive first, then defaults). */
export async function fetchSitemap(domain: string): Promise<SitemapData> {
  const candidates: string[] = [];
  const robots = await fetchPublicText(`https://${domain}/robots.txt`);
  if (robots) {
    for (const line of robots.split("\n")) {
      const m = /^\s*sitemap\s*:\s*(\S+)/i.exec(line);
      if (m) candidates.push(m[1]!);
    }
  }
  candidates.push(
    `https://${domain}/sitemap.xml`,
    `https://${domain}/sitemap_index.xml`,
    `https://www.${domain}/sitemap.xml`,
  );

  for (const url of [...new Set(candidates)].slice(0, 5)) {
    const xml = await fetchPublicText(url);
    if (!xml || (!/<urlset/i.test(xml) && !/<sitemapindex/i.test(xml))) continue;
    const { urls, children } = parseSitemapXml(xml);
    let all = urls;
    let fetchedChildren = 0;
    for (const child of children.slice(0, SITEMAP_CHILD_CAP)) {
      if (all.length >= SITEMAP_URL_CAP) break;
      const childXml = await fetchPublicText(child);
      if (!childXml) continue;
      fetchedChildren++;
      all = all.concat(parseSitemapXml(childXml).urls).slice(0, SITEMAP_URL_CAP);
    }
    log("sitemap fetched", { domain, source: url, urls: all.length });
    return {
      found: true,
      source: url,
      urls: all,
      truncated: all.length >= SITEMAP_URL_CAP,
      childSitemaps: fetchedChildren,
    };
  }
  return { found: false, source: null, urls: [], truncated: false, childSitemaps: 0 };
}

// -------------------------------------------------------------------- wayback

export interface WaybackData {
  reachable: boolean;
  firstCapture: string | null; // YYYYMMDDhhmmss of earliest snapshot
  firstUrl: string | null;
  yearsActive: string[]; // years with at least one capture
}

const WAYBACK_CDX = "https://web.archive.org/cdx/search/cdx";

async function waybackQuery(params: string): Promise<string[][] | null> {
  try {
    const r = await fetch(`${WAYBACK_CDX}?${params}`, {
      signal: AbortSignal.timeout(60_000),
      headers: { "user-agent": "DomainAuthorityExplorer-CorpusAudit/1.0" },
    });
    if (!r.ok) return null;
    const rows = (await r.json()) as string[][];
    return rows.slice(1); // drop header row
  } catch (err) {
    log("wayback query failed", { params, error: String(err) });
    return null;
  }
}

/** First-ever capture + which years the domain shows up in the Wayback Machine. */
export async function fetchWayback(domain: string): Promise<WaybackData> {
  const enc = encodeURIComponent(domain);
  const first = await waybackQuery(
    `url=${enc}&matchType=domain&output=json&limit=1&fl=timestamp,original`,
  );
  const years = await waybackQuery(
    `url=${enc}&matchType=domain&output=json&fl=timestamp&collapse=timestamp:4&limit=200`,
  );
  const reachable = first !== null || years !== null;
  return {
    reachable,
    firstCapture: first?.[0]?.[0] ?? null,
    firstUrl: first?.[0]?.[1] ?? null,
    yearsActive: [...new Set((years ?? []).map((r) => (r[0] ?? "").slice(0, 4)))]
      .filter(Boolean)
      .sort(),
  };
}
