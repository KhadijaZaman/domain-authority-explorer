import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Distinct-host (subdomain) counts per watchlist domain, extracted from the
 * Common Crawl HOST-level vertices file by the subdomains sync job.
 * subdomainCount excludes the apex host itself.
 * complete=false means the scan hit its byte cap before fully passing this
 * domain's block, so the count is a lower bound.
 */
export const subdomainCountsTable = pgTable(
  "subdomain_counts",
  {
    id: serial("id").primaryKey(),
    releaseName: text("release_name").notNull(),
    domain: text("domain").notNull(),
    subdomainCount: integer("subdomain_count").notNull(),
    complete: boolean("complete").notNull(),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("subdomain_counts_unique_idx").on(
      table.releaseName,
      table.domain,
    ),
  ],
);

export const insertSubdomainCountSchema = createInsertSchema(
  subdomainCountsTable,
).omit({ id: true, syncedAt: true });
export type InsertSubdomainCount = z.infer<typeof insertSubdomainCountSchema>;
export type SubdomainCount = typeof subdomainCountsTable.$inferSelect;
