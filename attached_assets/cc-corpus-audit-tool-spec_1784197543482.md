# Common Crawl Corpus Audit — Tool Specification

A free domain-level auditor built on Common Crawl's public CDX index.

**Positioning:** Ahrefs shows you what links to you. GSC shows you what Google did.
Nothing shows you what a plain, unauthenticated, JS-blind crawler saw when it
visited — which is exactly what GPTBot, ClaudeBot, and PerplexityBot are.
CCBot is the only one that publishes its work.

**The honest claim:** this doesn't tell you what's in any model. It tells you
what a crawler saw. That's a smaller claim and a defensible one.

---

## 0. Data sources

| Source | URL | Use |
|---|---|---|
| Crawl list | `https://index.commoncrawl.org/collinfo.json` | Get crawl IDs. Changes monthly — cache it. |
| CDX index | `https://index.commoncrawl.org/{CRAWL_ID}-index` | Per-URL records. Single server, rate-limit yourself. |
| WARC bytes | `https://data.commoncrawl.org/{filename}` + Range header | Fetch actual stored HTML |
| Columnar index | S3 / Athena | Bulk work. Use this at scale, not the CDX server. |
| Webgraph | CC webgraph releases | HC / PageRank |

**Base query pattern:**

```
https://index.commoncrawl.org/CC-MAIN-2026-25-index
  ?url=example.com
  &matchType=domain
  &output=json
```

**Lessons from building this:**

- `matchType=domain` covers subdomains and www variants. `exact` (the default)
  will return "No Captures" on a live site and fool you.
- Server-side `filter=` is unreliable. Dump once, filter locally.
- 502s are routine. The index server is one machine. Retry with backoff.
- Every record is one JSON line. `wc -l` is a valid count. Ctrl+F in a browser
  is not — it counts string occurrences, not rows.

**CDX record fields:**

```json
{
  "urlkey": "com,example)/path?param=x",   // SURT — sort key
  "timestamp": "20260610115943",            // fetch time
  "url": "https://example.com/path",
  "mime": "text/html",
  "mime-detected": "text/html",
  "status": "200",
  "digest": "LN4PCJ2VGXXUEDU6YMBLX4YB3NOLXDWO",  // SHA-1 of body, base32
  "length": "37059",                        // compressed bytes
  "offset": "506604958",                    // byte offset in WARC
  "filename": "crawl-data/.../warc/....warc.gz",
  "languages": "eng",
  "encoding": "UTF-8",
  "redirect": "https://example.com/path/"   // only on 3xx
}
```

**Two fields carry most of the signal:**

- `digest` — content hash. Same digest = byte-identical. Different digest on
  what should be the same page = the page isn't stable.
- `filename` path segment — `warc/` means archived. `crawldiagnostics/` means
  fetched and discarded (3xx/4xx). `robotstxt/` is its own bucket.

**Known values:**
- `3I42H3S6NNFQ2MSVX7XZKYAYSCX5QBYJ` = SHA-1 of empty string. Empty response body.

---

## 1. Single-crawl checks

Everything in this section runs off one dump. This is the free tier.

### 1.1 Presence

```bash
curl -s "$BASE" > dump.jsonl
wc -l < dump.jsonl
```

| Result | Meaning |
|---|---|
| 0 rows | Not discovered, or robots-blocked. Check 1.2. |
| 1–10 | Barely discovered. Link profile problem. |
| 10–100 | Normal small site. |
| 100+ | Well discovered. |

**Do not report 0 without a control.** Run a known-good domain in the same
request batch. If both return 0, your query is broken, not their site.

### 1.2 robots.txt

```bash
grep '"urlkey": "[^"]*)/robots.txt"' dump.jsonl
```

Present with `status: 200` → CCBot was allowed to read it. Absent from an
otherwise-crawled domain → investigate.

**Then check the live file for the crawlers CC doesn't cover:**

```
CCBot, GPTBot, ClaudeBot, Google-Extended, PerplexityBot,
Bytespider, Applebot-Extended, anthropic-ai, cohere-ai, CCBot
```

**Insight:** many sites blocked "AI scrapers" in 2024 without understanding
they were opting out of the corpus. Show them exactly which bots they blocked
and what each one feeds.

### 1.3 Status distribution

```bash
jq -r '.status' dump.jsonl | sort | uniq -c | sort -rn
```

| Code | Meaning | Cost |
|---|---|---|
| 200 | Archived | The only productive fetch |
| 301/302/307/308 | Redirect | Fetch spent, nothing stored |
| 404/410 | Dead | Fetch spent, nothing stored |
| 403/401 | Blocked | Fetch spent, worth flagging |
| 5xx | Server error | Fetch spent, availability signal |

**Metric — Crawl Efficiency:**

```
efficiency = (200 responses without params) / total records
```

Real example: `wellows.com`, `CC-MAIN-2026-25` — 28 param URLs, 27 redirects,
6 404s out of ~180 records. **~34% of every fetch produced nothing useful.**

### 1.4 Parameter pollution — the flagship check

This is the one nobody else runs and it produces the best headline.

```bash
# Group by base path, count variants
jq -r '.url | split("?")[0]' dump.jsonl | sort | uniq -c | sort -rn | head -20
```

```
  19 https://wellows.com/pricing/
   8 https://wellows.com/
   1 https://wellows.com/blog/ai-seo/
```

**Metric — Duplication Factor:**

```
DF(path) = total URLs for that path / 1
```

DF = 1 → clean. DF > 3 → problem. DF = 19 → one page eating 19 crawl slots.

**Parameter taxonomy — tag every param:**

| Class | Examples | Verdict |
|---|---|---|
| Tracking | `utm_*`, `ref`, `fbclid`, `gclid`, `mc_cid` | Always duplicate |
| Session | `sid`, `sessionid`, `PHPSESSID` | Always duplicate |
| Pagination | `page`, `p`, `offset` | Legitimate, distinct content |
| Filter/facet | `sort`, `color`, `size` | Usually duplicate, sometimes not |
| Functional | `id`, `q`, `search` | Usually legitimate |

**Broken-param detection — flag these specifically:**

```
utm_campaign=-           # literal placeholder, never replaced
utm_source=organic       # contradiction: UTM means NOT organic
utm_source=newsletter%20 # trailing space, URL-encoded
utm_source=blog          # internal link — should never carry UTM
```

Each one is a permanent phantom URL born from a typo.

### 1.5 Canonical presence — the finding that matters

This is the check nobody is running. It's what produced the headline in our
audit.

```bash
# Does the clean version of each polluted path exist in the corpus?
jq -r '.url' dump.jsonl | sed 's/?.*//' | sort -u > paths.txt
jq -r 'select(.url | contains("?") | not) | .url' dump.jsonl | sort -u > clean.txt
comm -23 paths.txt clean.txt
```

**Output = paths that exist ONLY in parameterized form.**

Real result for `wellows.com`:

```
https://wellows.com/                              ← homepage. 8 tagged copies, no clean version.
https://wellows.com/blog/repurpose-content-with-ai/  ← only ?ref=bottalk.io version exists
```

**Why this happens:** external links arrive tagged. Directories tag you.
Partners tag you. Your own blog CTAs tag you. If literally nobody links to
`https://example.com/` bare, the crawler may never fetch it bare — it only ever
follows what it finds.

**Severity: critical.** This is the brand-defining page. Absent from the corpus
as a canonical entity, present as eight fragments.

**Headline for the report:**
> "Your homepage isn't in Common Crawl. Eight copies of it are."

### 1.6 Digest variance — dedup escape

```bash
# Same base path, how many distinct digests?
jq -r '[(.url | split("?")[0]), .digest] | @tsv' dump.jsonl \
  | sort -u | cut -f1 | uniq -c | sort -rn
```

If `/pricing/` has 19 URLs and 19 distinct digests, the page renders differently
on every request.

**Why it matters:** exact-match dedup (the cheap first pass in every corpus
pipeline) keys on the hash. Identical digests collapse to one. **Distinct
digests survive as distinct documents.** Near-dedup (MinHash / SimHash) may
catch them downstream — but that's someone else's pipeline choice, not yours.

**Diagnose the variance:**

```bash
# Fetch two variants, diff them
curl -s "https://example.com/pricing/" > a.html
curl -s "https://example.com/pricing/?utm_source=test" > b.html
diff <(fold -w80 a.html) <(fold -w80 b.html)
```

Usual culprits: CSRF nonce, timestamp, cache-buster, the UTM value reflected
into a hidden form field or analytics snippet.

**Report the delta:** lengths of 22257 / 22295 / 22297 / 22285 / 22274 = ~40
bytes of churn producing five separate documents.

### 1.7 Content length — thin content and JS detection

```bash
jq -r '[.length, .url] | @tsv' dump.jsonl | sort -n | head -20
```

| Length | Interpretation |
|---|---|
| < 5 KB | Likely empty shell — client-side render, no SSR |
| 5–15 KB | Thin |
| 15–25 KB | Marketing page or archive |
| 25 KB+ | Real content |

**JS-blindness test:** `length` small AND `languages` field absent → CCBot got
markup with no extractable text. The page is in WARC but the WET file is empty.
It contributed nothing to any text corpus.

**Caveat learned the hard way:** don't call JS-rendering from length alone.
36 KB with `languages: eng` means extraction worked fine. I got this wrong
before checking.

### 1.8 Redirect inventory

```bash
jq -r 'select(.status | startswith("3")) | [.status, .url, .redirect] | @tsv' dump.jsonl
```

**Classify:**

| Pattern | Meaning | Action |
|---|---|---|
| `/x` → `/x/` | Trailing slash | Fix internal links |
| `/old/*` → `/new/*` bulk | Legacy taxonomy still linked | Update source links |
| `/x` → `/generic-parent/` | Non-equivalent target | Soft-404 — redirect to the real equivalent |
| `/x` → `/gone/` | Should be 410 | Wrong pattern entirely |
| Param survives redirect | Chain terminates in a duplicate | Strip params at redirect |

**Critical logic — and this is the whole trick:**

> **CC only fetches URLs it found links to.**

A 3xx in the index is not a config artifact. **It is proof that a live link to
that URL exists somewhere.** Count them:

Real result: `/geo/*` ×8, `/content/*` ×5, `/seo/*` ×3 = **16 legacy URLs still
being linked from somewhere.** Three abandoned taxonomies, still wired up.

**Mixed status codes reveal architecture:**
- 301 with empty digest → origin (nginx/WordPress)
- 308 with a body → edge (Vercel/Cloudflare)

Both present = two redirect layers = fix in two places or you'll fix half.

### 1.9 404 inventory

```bash
jq -r 'select(.status=="404") | .url' dump.jsonl
```

Same logic: every 404 in the index has a live link pointing at it.

**Auto-classify:**

| Pattern | Diagnosis |
|---|---|
| `/example.com/path/` | Malformed `href` — written without `https://`, resolved as relative |
| `/author/x/` 404 but `/blog/author/x/` 200 | Missing path prefix in a template |
| `/book-a-call/` 404, `/book-a-demo/` 200 | Wrong CTA URL — direct revenue leak |
| Legacy path where siblings 301 | Redirect map has gaps |

The malformed-href one is worth a dedicated regex — search the CMS for
`href="domain.com` without a scheme.

### 1.10 MIME inventory

```bash
jq -r '.mime' dump.jsonl | sort | uniq -c | sort -rn
jq -r 'select(.mime=="application/pdf") | .url' dump.jsonl
```

**Insight:** gated lead magnets sitting at public `/wp-content/uploads/` URLs
are in the corpus. Four of them, in our case. Anyone can fetch them; so did
CCBot.

This may be fine (citation-worthy) or not (lead capture bypassed). The point is
it should be a decision, not an accident.

### 1.11 Subdomain coverage

```bash
jq -r '.url | capture("https?://(?<h>[^/]+)").h' dump.jsonl | sort | uniq -c
```

`matchType=domain` covers subdomains. Zero rows for a subdomain that should
exist → that subdomain is invisible to crawlers entirely.

### 1.12 Thin archive / pagination bloat

```bash
jq -r 'select(.url | test("/page/[0-9]+/")) | .url' dump.jsonl
```

Deep pagination (`page/2`, `page/8`) crawled while `page/1` isn't = the crawler
is walking your archive instead of reading your content. Recommend `noindex` on
`page/2+` or canonical to page 1.

---

## 2. Multi-crawl analysis

Two or more crawls unlocks the temporal dimension. This is where it stops being
an audit and starts being intelligence.

### 2.1 Recrawl frequency = importance proxy

Pull the same domain across N crawls. Count appearances per URL.

```
appearances(url) / N = recrawl rate
```

**The logic:** crawl schedulers allocate budget by estimated importance and
estimated change rate. Google's crawl-scheduling work and its historical-data
patent family both describe recrawl frequency as a function of a page's
importance score and observed rate of change. CCBot is simpler than Google, but
it's the same family of heuristic — link-derived priority plus politeness.

**So:** recrawl rate is an observable, free proxy for how important your link
graph makes a page look from the outside.

| Rate | Reading |
|---|---|
| Every crawl | Crawler considers it important |
| Intermittent | Marginal priority |
| Once, never again | Discovered and deprioritized |

**Deliverable:** rank the user's pages by recrawl rate. Then ask them to rank
their pages by business value. **The gap between those two lists is the report.**

### 2.2 Displacement detection

**The hypothesis this tool exists to test.**

```
crawled_in_may = set(urls from CC-MAIN-2026-21)
crawled_in_june = set(urls from CC-MAIN-2026-25)

dropped = may - june
added   = june - may

# The specific test:
dropped_real_content = [u for u in dropped if "?" not in u]
added_param_urls     = [u for u in added if "?" in u]
```

**If dropped content correlates with added param URLs, that is displacement:**
new parameterized URLs look novel to the scheduler, get priority, and crowd out
known-but-unchanged real pages.

Real setup: 16 blog slugs appear as `utm_term` values on `/pricing/` copies.
None of those 16 posts are in the June crawl. Every `/pricing/` duplicate is.

**Status: unproven.** Three explanations remain live:
1. Displacement (the interesting one)
2. Posts live at a different path
3. Links reaching CC from a different source

**Test it before publishing.** May crawl (`CC-MAIN-2026-21`) settles it.

If confirmed, this is the finding of the year for GEO:
> "Your UTM tags are evicting your own content from the corpus."

If not confirmed, say so. The tool is still worth building.

### 2.3 Content churn

```bash
# Same URL, digest across crawls
```

| Pattern | Reading |
|---|---|
| Digest identical every crawl | Static. Fine for reference content, bad for a "latest 2026" page. |
| Digest changes every crawl | Either genuine updates or instability (see 1.6) |
| Digest changes but length ±50 bytes | Instability, not updates. This is the dedup-escape signature. |

Distinguishing "genuinely updated" from "nonce churn" is the length delta.

### 2.4 Coverage trend

```
coverage(crawl) = count of clean 200s
```

Plot across all available crawls. Rising = healthy. Falling = investigate.

Pair it with publish velocity: if they published 30 posts and coverage went up
by 4, something is eating the budget.

### 2.5 Discovery lag

```
lag = first_crawl_timestamp - publish_date
```

Publish date from the sitemap or the page. This measures how fast the open web
notices a new page. Long lag = weak link profile, weak internal linking, or
sitemap not being read.

### 2.6 Decay

Pages present in older crawls, absent in recent ones. Cross-reference with
traffic. A page dropping out of CC while still ranking is early warning.

**Direct tie-in to any content-decay tooling** — this is the corpus-side signal
that pairs with the traffic-side signal.

---

## 3. Competitive analysis

### 3.1 Footprint comparison

Run the same audit across N competitors. Normalize.

| Metric | Formula |
|---|---|
| Corpus footprint | clean 200s |
| Crawl efficiency | clean 200s / total records |
| Duplication factor | total records / distinct base paths |
| Waste rate | (3xx + 4xx + param dupes) / total |

Rank them. **This is a shareable asset and it's free to produce.**

### 3.2 Industry benchmark

Run it across the top 50 in any vertical. Publish the distribution.

Suggested first study: **AI visibility / GEO tools.** The irony writes itself,
and the population is small enough to do by hand.

Predicted result (untested): most have param pollution; several have a missing
canonical homepage; at least one blocks CCBot.

### 3.3 Share of corpus

For a topic cluster, count the distinct domains present. Compute each domain's
share.

Weak-but-honest proxy for "who does the open web let a model see on this topic."

---

## 4. Beyond CDX — fetching the actual bytes

The CDX index tells you a URL exists. WARC tells you what was stored.

### 4.1 Byte-range fetch

```python
url = "https://data.commoncrawl.org/" + record["filename"]
start = int(record["offset"])
end = start + int(record["length"])
r = requests.get(url, headers={"Range": f"bytes={start}-{end}"})
# gzip member -> WARC record -> HTTP response -> HTML
```

You now have the exact HTML CCBot stored. Not the live page — **the archived
one.**

### 4.2 Drift detection

Diff archived HTML vs live. Everything in that gap is content the corpus never
saw.

**This is the highest-value check in the whole spec** and nobody is doing it.
"You rewrote that page in March. The corpus still has the January version."

### 4.3 Structured data extraction

Parse JSON-LD out of the archived HTML.

- Is `Organization` schema present in what was *stored*?
- `sameAs` links to LinkedIn/Crunchbase/Wikidata?
- `Person` schema on author pages?
- Does `Product` / `SoftwareApplication` describe the brand accurately?

**Entity logic:** models build brand understanding from entity signals in the
corpus. If your schema is injected client-side, it isn't in WARC, so it isn't in
the corpus. Server-side or nothing.

### 4.4 Internal link graph

Extract every `<a href>` from archived HTML. Build the graph.

- Internal PageRank per page
- Orphans — pages with no inbound internal links
- Links pointing at 404s or redirects (cross-ref §1.8/1.9)
- **Param-tagged internal links** — the root cause of §1.4, found at source

Google's reasonable-surfer work (US 8,180,761 — verify the number before
citing) argues link value varies by position, prominence, and click likelihood
rather than being split evenly. So weight body links above footer links when
scoring. This is a refinement, not a foundation — don't overclaim it.

### 4.5 WET text quality

The WET file is what actually reaches a text corpus.

- Text-to-HTML ratio
- Boilerplate ratio (nav/footer vs body)
- Is the main content even present?

A page can be 40 KB of HTML and produce 300 words of extractable text. **That's
what the corpus gets.**

---

## 5. Webgraph

### 5.1 HC and PageRank

From CC's webgraph releases (domain-level).

- **Harmonic Centrality** — Σ(1/distance) to every other domain. Hub signal.
  Lower rank number = better.
- **PageRank** — authority weighted by who links to you.

They answer different questions. High HC + low PR = many links from unimportant
places. Low HC + high PR = few links from important places.

Note: `webgraph.metehan.ai` truncates to top 10M domains per period. "Not found"
there means outside the top 10M, **not** absent from Common Crawl. Our entire
investigation started from that confusion — build the distinction into the UI.

### 5.2 The correlation study

Join CC presence/HC against actual AI citation data.

**Three outcomes, all publishable:**

| Result | Meaning |
|---|---|
| Strong correlation | Corpus presence predicts citations. Argument proven. |
| Weak correlation | Retrieval dominates. **Bigger story** — reframes GEO. |
| Varies by engine | Most useful. Tells you which engines reward corpus presence vs live crawlability — that's a per-platform strategy split. |

Nobody has published this. It requires a large citation dataset joined to CC —
which is a rare combination.

---

## 6. Scoring model

### Corpus Health Score (0–100)

| Component | Weight | Formula |
|---|---|---|
| Presence | 20 | clean 200s, log-scaled against site size |
| Canonical integrity | 25 | % of paths whose clean version exists |
| Crawl efficiency | 20 | clean 200s / total records |
| Duplication | 15 | inverse of duplication factor |
| Waste | 10 | inverse of (3xx + 4xx) rate |
| Extractability | 10 | % of 200s with a `languages` field |

**Canonical integrity gets the heaviest weight** because it's the failure that's
invisible everywhere else and most severe when it hits the homepage.

### Severity ladder

| Level | Trigger |
|---|---|
| Critical | Homepage has no clean version in corpus |
| Critical | robots.txt blocks CCBot/GPTBot/ClaudeBot unintentionally |
| Critical | Live CTA returns 404 |
| High | DF > 5 on any commercial page |
| High | Malformed href generating phantom 404s |
| High | Legacy taxonomy still internally linked |
| Medium | Redirect to non-equivalent page |
| Medium | 3xx→ target carries params through |
| Medium | Thin pagination consuming budget |
| Low | Trailing-slash redirects |
| Info | PDFs publicly in corpus |

---

## 7. Build order

**v1 — free, no auth, one crawl**
1. Domain lookup, presence + control-domain sanity check
2. Status distribution
3. Duplication factor per path
4. **Canonical presence check** ← the differentiator, lead with it
5. Redirect + 404 inventory with auto-classification
6. Health score + severity list

Shipping surface: single input box, one dump, all analysis client-side or in a
worker. Same architecture as the Metehan tool — precompute nothing, fetch once,
compute locally.

**v2 — multi-crawl**
7. Coverage trend
8. Recrawl frequency ranking
9. Displacement detection
10. Decay flags

**v3 — WARC fetch**
11. Live vs archived drift
12. Schema extraction from archived HTML
13. Internal link graph + param-tagged link source finder

**v4 — competitive**
14. Multi-domain comparison
15. Industry benchmarks

**v5 — webgraph + correlation**
16. HC/PR overlay
17. Citation correlation

Ship v1. It already contains the finding nobody else has.

---

## 8. Engineering notes

**Rate limiting.** CC state it plainly: they cannot scale the index server. It
is one machine.
- `sleep 2` between requests, minimum
- Cache `collinfo.json` — it changes monthly
- Cache dumps by (domain, crawl) — CC data is immutable, so cache forever
- Expect 502s; exponential backoff
- Beyond ~a few hundred domains, move to the columnar index on Athena

**Correctness traps we actually hit today:**

| Trap | Fix |
|---|---|
| `matchType=exact` returns nothing on a live site | Always `matchType=domain` |
| Ctrl+F counts strings not rows | `wc -l` |
| Server `filter=` silently returns empty | Dump + filter locally |
| Concluding from a screenshot | Pull the full dump before any claim |
| 502 read as "not in CC" | Distinguish infra failure from empty result |
| No control domain | Always run a known-good domain alongside |

That last one is the difference between a tool people trust and one they don't.

---

## 9. Patent and logic grounding

**Be careful here.** Verify every patent number before publishing — SEO content
is full of miscited numbers and getting one wrong undermines everything else.
The concepts below are well established; the numbers should be checked against
Google Patents directly.

| Concept | What it grounds | Confidence |
|---|---|---|
| PageRank (US 6,285,999) | Link-weighted authority; the webgraph PR metric | High |
| Reasonable surfer (US 8,180,761) | Link value varies by position/prominence, not split evenly | Medium — verify |
| Historical data patent family | Document inception date, rate of change, recrawl scheduling | Concept solid, numbers vary |
| Near-duplicate detection (shingling, SimHash) | Why distinct digests survive exact dedup; Broder's shingling and Charikar's SimHash are the canonical references | High |
| URL canonicalization | Why param variants become distinct documents | High as concept |

**How to use them:** as *explanatory scaffolding*, not authority. "Crawl
scheduling allocates by estimated importance and change rate — that's why
recrawl frequency is a usable proxy" is defensible. "Google patent X proves your
UTM tags hurt you" is not, and CCBot isn't Googlebot anyway.

The tool's authority comes from the data being public and reproducible. That's
stronger than a patent citation.

---

## 10. Positioning

**What this tool is:**
> The only public, reproducible view of what a crawler sees when it visits you.
> Every AI crawler you can't observe arrives through the same door.

**What it isn't:**
- Not a training-data checker — you cannot know which crawl any model used
- Not a citation predictor — ~90% of raw CC is filtered out downstream
- Not complete — CC is a sample; robots-blocked, login-walled, and JS-only
  content is absent

**Say the limits out loud.** People who write "be in Common Crawl or be
invisible" get taken apart. People who name their own caveats get trusted — and
get cited.

**Launch content, in order:**
1. "Your homepage isn't in Common Crawl. Eight copies of it are." — the finding,
   with your own site as the subject
2. "We audited 50 AI visibility tools' corpus footprints" — the benchmark
3. "Does corpus presence predict AI citations?" — the study

Post 1 is the hook. Post 3 is the moat.

**Sequence for post 1:** verify displacement against `CC-MAIN-2026-21` → fix →
wait for `CC-MAIN-2026-29` → publish before/after. That makes it an experiment
rather than a case study, and it's the difference between interesting and
citable.

The strongest thing you have is that you found this on your own site. Showing
your own mistakes is what other GEO writers won't do — and it's the part that
earns the link.
