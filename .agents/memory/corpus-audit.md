---
name: Corpus Audit (Common Crawl CDX)
description: CDX index quirks and design rules for the corpus audit feature
---
- CDX index (`index.commoncrawl.org/{CRAWL}-index`) answers **HTTP 404 with an error body when there are zero captures** — that's a real, cacheable empty result, not a failure. 502s are routine; retry with backoff. One machine: keep ≥2s politeness delay between requests.
- Crawl data is immutable → dumps cached forever in `corpus_snapshots` (jsonb slim records, short keys u/s/d/l/m/g/b/r/t). Pseudo-row crawlId `__robots_live__` caches the live AI-bot robots check (7-day TTL).
- **Why cohort consistency matters:** analysis checks must all define "content" the same way — archived clean pages (status 200, WARC bucket, no params). Mixing "all 200s" with "archived" cohorts produced false displacement/decay signals (caught in review).
- Audit endpoint returns `building=true` whenever crawls are missing, even if enqueue was throttled — otherwise the frontend stops polling and stalls on partial data. Per-IP limit applies only to NEW-domain enqueues; cached audits are free.

## Deep enrichment lessons (July 2026)
- WARC byte-range fetches: use data.commoncrawl.org (CDN, tolerant of many small Range requests), NOT index.commoncrawl.org; gunzip the range, split WARC/HTTP headers/body on double CRLF.
- robots.txt history: one exact-match CDX query per crawl (~105+ crawls × 2.2s ≈ 4-5 min = the long pole); fetch WARC content once per distinct digest and stamp bot-blocks across crawls sharing it.
- **Enrichment failures must throw at the end of the job** (after persisting successes) so the domain hits the standard failure cooldown — silently swallowed step failures + `enriching:true` polling = clients hot-loop re-enqueueing expensive jobs.
- **How to apply:** never mark a crawl "checked" on a failed CDX fetch — track failures separately, bail after ~5 consecutive, compute `complete` from checked-set coverage, retry unchecked on next run.
- Analysis example lists shown in React must dedupe by URL — the same URL appears multiple times per crawl and duplicate keys break rendering.
