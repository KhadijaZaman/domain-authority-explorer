import {
  pgTable,
  text,
  serial,
  integer,
  doublePrecision,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Domain rank rows loaded from a Common Crawl web graph release.
 * Rows are keyed by (releaseName, domain); a "current" release pointer in
 * sync_meta decides which release is live, so a half-loaded release is never
 * served.
 */
export const domainRanksTable = pgTable(
  "domain_ranks",
  {
    id: serial("id").primaryKey(),
    releaseName: text("release_name").notNull(),
    domain: text("domain").notNull(),
    harmonicPos: integer("harmonic_pos").notNull(),
    harmonicVal: doublePrecision("harmonic_val").notNull(),
    pagerankPos: integer("pagerank_pos").notNull(),
    pagerankVal: doublePrecision("pagerank_val").notNull(),
    authorityScore: doublePrecision("authority_score").notNull(),
    popularityScore: doublePrecision("popularity_score").notNull(),
  },
  (table) => [
    uniqueIndex("domain_ranks_release_domain_idx").on(
      table.releaseName,
      table.domain,
    ),
    index("domain_ranks_release_harmonic_idx").on(
      table.releaseName,
      table.harmonicPos,
    ),
  ],
);

export const insertDomainRankSchema = createInsertSchema(
  domainRanksTable,
).omit({ id: true });
export type InsertDomainRank = z.infer<typeof insertDomainRankSchema>;
export type DomainRank = typeof domainRanksTable.$inferSelect;
