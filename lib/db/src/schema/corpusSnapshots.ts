import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  jsonb,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/**
 * Cached Common Crawl CDX dumps, one row per (domain, crawl). CC crawl data is
 * immutable, so a snapshot never expires — the corpus audit recomputes its
 * analysis from these rows instead of re-hitting the rate-limited CDX server.
 *
 * `records` is a jsonb array of slim capture records with short keys:
 *   u=url s=status d=digest l=length(compressed bytes) m=mime
 *   g=languages b=bucket(warc|diag|robots) r=redirect t=timestamp
 *
 * A special crawlId "__robots_live__" row caches the live robots.txt AI-bot
 * check (records = string[] of blocked bot names); refreshed after 7 days.
 */
export const corpusSnapshotsTable = pgTable(
  "corpus_snapshots",
  {
    id: serial("id").primaryKey(),
    domain: text("domain").notNull(),
    crawlId: text("crawl_id").notNull(),
    records: jsonb("records").notNull(),
    recordCount: integer("record_count").notNull(),
    truncated: boolean("truncated").notNull().default(false),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("corpus_snapshots_domain_crawl_idx").on(
      table.domain,
      table.crawlId,
    ),
  ],
);

export type CorpusSnapshot = typeof corpusSnapshotsTable.$inferSelect;
