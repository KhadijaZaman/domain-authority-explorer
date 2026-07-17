# Domain Authority Explorer — How It Works & How It Compares

*Last updated: July 16, 2026*

---

## 1. What the tool is

- A free domain authority checker built entirely on **open data** — Common Crawl's Web Graph, a public dataset that maps how ~121 million domains link to each other.
- It answers one core question: **"How well-referenced is a domain on the web?"** — not content quality, not Google rankings.
- Extra tools built on the same data: Bulk Compare, Link Gap Finder, Top 1000 leaderboard, Corpus Audit (is your site visible to AI crawlers?), and a historical trend chart.

## 2. Where the data comes from

- **Common Crawl Web Graph** — released roughly monthly. Each release lists every domain's position in the web's link structure, computed from billions of links.
- Every month, the app **automatically detects the new release** and ingests the **top 1 million domains** into its own database (the full release is ~121M domains — the long tail is mostly noise).
- **Referring-domain data** comes from the release's edges files (the actual links between domains), synced for domains people have looked up. Where coverage is sampled rather than complete, the UI says so.
- **Corpus Audit** pulls from two more open sources: the Common Crawl **CDX index** (which pages were actually captured) and archived **robots.txt history back to 2013**.
- Some enrichment (backlink details) comes from DataForSEO, cached for 24 hours.

## 3. The scoring logic

- Two scores, both 0–100:
  - **Authority Score** — based on *harmonic centrality*: how close a domain is to everything else in the web graph. Good at spotting central, well-connected hubs.
  - **Popularity Score** — based on *PageRank*: how much link "trust" flows into the domain from other trusted domains.
- **Why not a simple percentile?** With 121M domains, every notable site would score ~100. So the score uses a **logarithmic rank scale**: `100 × (1 − ln(rank) / ln(total))`. That spreads the top of the curve out so a #700 site and a #70,000 site get meaningfully different numbers — similar in feel to commercial DA tools, but fully transparent.
- Rankings are **registrable-domain level** (`ycombinator.com`). If you search a subdomain, the tool tells you it's showing parent-domain data.

## 4. History logic

- Trend charts go back to **January 2018** (the earliest release with usable ranking data — nothing older exists in the dataset).
- History is built **on demand**: the first time a domain is looked up, the app scans past releases in the background (15–30 min for a full build) and remembers the result forever — including "wasn't ranked then," so it never rescans.

---

## 5. Benchmark vs. webgraph.metehan.ai (CC Rank Checker)

Both tools sit on the **same underlying dataset** (Common Crawl Web Graph), so this is an apples-to-apples comparison of *how* each one uses the data.

### What's similar
- Same source data, same two core metrics (harmonic centrality + PageRank).
- Both refresh with new Common Crawl releases and both now offer referring-domains and link-gap features.

### Key data differences

| | **Domain Authority Explorer (this tool)** | **webgraph.metehan.ai** |
|---|---|---|
| **Depth per release** | Top **1M** domains fully ingested, ranked against all ~121M | Top **10M** domains per period |
| **Storage/lookup** | Postgres database (rich queries, joins, history) | Cloudflare KV (fast key-value lookups) |
| **Score format** | **0–100 log-rank scores** (comparable across domains and time) | **Raw ranks** + tier badges (Elite, Top 1K, …) |
| **History range** | Monthly, back to **Jan 2018** (~8.5 years) | **12 periods, 2023–2026** (~3 years) |
| **History building** | On-demand full backfill per domain, then cached forever | Pre-indexed snapshots only |
| **Referring domains** | Real edges from the graph + coverage honesty labels + DataForSEO enrichment | Built on the single latest release |
| **Crawl-level data** | **Corpus Audit**: page-capture counts (CDX), robots.txt time machine to 2013, sitemap-vs-corpus matrix | Not offered — domain ranks only |
| **Freshness model** | Fully automatic monthly pipeline (release watcher + safety lock) | Manually updated per release |

### The practical difference, in one line each

- **Their tool is wider and shallower**: 10M domains per period, instant raw-rank lookups — great for "does my domain appear at all, and in which tier?"
- **This tool is narrower and deeper**: top 1M domains, but with normalized scores, 8+ years of monthly history, real link-edge data, and crawl-level visibility (what AI crawlers can actually see of your site).
- **Datawise, the biggest gaps in our favor**: longer history (2018 vs 2023), scores instead of raw ranks (so trends and comparisons are readable), and the corpus/robots layer that no rank-only tool has.
- **Datawise, their biggest gap in their favor**: coverage — a domain ranked between #1M and #10M will show up there but read as "outside the indexed set" here.
