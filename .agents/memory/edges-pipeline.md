---
name: Edges sync pipeline constraints
description: How the Common Crawl edges (referring domains) sync must be run and its correctness/memory rules
---

# Edges sync pipeline (referring domains)

- The edges file is ~13.6 GB gz (~3.9 B lines); a full scan takes far longer than the 5-min dev shell cap. Full runs belong on the monthly Scheduled Deployment; dev runs use `EDGES_MAX_BYTES` (1 GB ≈ 7% coverage, ~3.5 min) and coverage % is recorded so the UI labels data as sampled/lower-bound.
- **Why watchlist-only:** referring-domain extraction only covers previously looked-up + niche-tagged domains; per-lookup on-demand scanning of the edges file is infeasible (sorted by *from*, inbound edges are scattered).
- Correctness rules learned via review: early-stop must finish the current from-block (degree would otherwise be undercounted, corrupting spam flags); memory must be bounded with a per-target referrer cap (popular targets like google.com have tens of millions of inbound links → OOM on full scans).
- Niche percentile population = tagged domains **with rank data in the current release**; keep nicheSize/rank/percentile on the same set or the API contract lies.
- DataForSEO responses are cached 24h in Postgres specifically to avoid re-spending API credits on repeat lookups; keep any new DataForSEO calls behind that cache.
- Host-level vertices are NOT a single file: only a `-host-vertices.paths.gz` manifest exists, listing sorted part files (globally sorted by reversed host name). Stream parts in order; a sorted watchlist pointer allows early exit once all watchlist blocks pass (a 6-domain scan finished in ~90s at ~124M lines instead of scanning the whole file).
- Sorted-block boundary subtlety: `-` sorts before `.`, so "ai.peec-x" appears between "ai.peec" and "ai.peec.*"; only mark a block passed when the line sorts after `rev + "."` AND doesn't start with it.
- `nohup ... &` background jobs die when a dev shell session ends here; run long syncs in the foreground of a single shell command (`a & b & wait`) or on a Scheduled Deployment.
- A one-off full scan CAN run in dev: use a temporary console workflow (no 5-min shell cap) with `FORCE_EDGES=1` (sync skips a release already marked done) and no `EDGES_MAX_BYTES`; full 3.9B-line pass took ~27 min. Remove the workflow after.
- Prod DB is a snapshot from publish time — dev-side syncs do NOT reach the live app. Refresh paths: re-publish with the "copy development data" option, or a Scheduled Deployment running the sync in the production env.
- Any per-source/per-target cap or partial byte scan must be surfaced as a sampling caveat in the API response, and derived UI/data must never claim completeness (code-review recurring theme).
