# Domain Authority Explorer

A free domain authority checker powered by Common Crawl's public web graph — search any domain to see its Authority Score, Popularity Score, global rank, historical trend, and bulk-compare up to 5 domains.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm --filter @workspace/scripts run sync` — run the Common Crawl sync job (see below)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Frontend: React + Vite (wouter, TanStack Query, Recharts, shadcn/ui)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/domain-authority-explorer/` — React frontend (routes: `/` explorer, `/compare` bulk compare)
- `artifacts/api-server/src/routes/domains.ts` — all API endpoints (`/api/status`, `/api/domain/:domain`, `/api/domain/:domain/history`, `/api/compare`, `/api/domains/top`, `/api/lookups/recent`)
- `lib/api-spec/openapi.yaml` — API contract (source of truth; run codegen after edits)
- `lib/db/src/schema/` — DB schema: `domainRanks`, `syncMeta`, `lookups`, `lookupsHistory`
- `scripts/src/sync-common-crawl.ts` — the Common Crawl sync job

## Sync job

- Fetches the newest web graph release from `index.commoncrawl.org/graphinfo.json`; exits early if already processed (override with `FORCE_SYNC=1`).
- Stream-downloads and stream-decompresses `<release>-domain-ranks.txt.gz` (never fully in memory); the ranks file already includes reversed domain names, so no vertices join is needed. The edges file is skipped.
- Ingests the top `SYNC_LIMIT` domains (default 1,000,000; ~1 min). The full release is ~121M domains.
- Loads under the new release name, then atomically flips the `current_release` pointer, so the live app never serves half-loaded data. Previous release rows are kept; older ones pruned.
- Intended to run monthly (e.g. a Scheduled Deployment running the sync command).

## Architecture decisions

- Scores are a log-rank normalization (`100 * (1 - ln(rank)/ln(total))`), not a linear percentile — linear percentiles round every top-1M domain to ~100 out of 121M total, making the number meaningless. Keep this formula stable: changing it breaks comparability of `lookups_history` across releases.
- Scores are labeled "Common Crawl Authority/Popularity Score" — never present them as Google PageRank.
- Domain lookups fall back to shorter suffixes (`docs.example.com` → `example.com`) since the CC domain graph is registered-domain level.
- History (`lookups_history`) accrues one row per (domain, release): on lookup and, for previously looked-up domains, on each sync.

## Product

- Search a domain → Authority Score + Popularity Score (0–100), absolute ranks, release/date note, not-found state for domains outside the ingested set.
- Historical trend chart per domain, top-ranked domains, recent lookups, bulk compare (up to 5 domains) at `/compare`.
- Footnote clarifies these are Common Crawl harmonic-centrality/PageRank-style metrics, not Google metrics; data refreshes roughly monthly per release.

## User preferences

- Original spec asked for Python/FastAPI + DuckDB; built on the workspace stack (React + Express + Postgres) instead — communicated and accepted.

## Gotchas

- Domains outside the top `SYNC_LIMIT` (1M) return "not found in the latest Common Crawl crawl" — raise `SYNC_LIMIT` and re-sync with `FORCE_SYNC=1` to broaden coverage.
- After editing `lib/api-spec/openapi.yaml`, always re-run codegen before touching routes or frontend hooks.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
