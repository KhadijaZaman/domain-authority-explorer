import {
  pgTable,
  text,
  serial,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Outbound link rows extracted from the Common Crawl edges file for
 * watchlisted domains: domains that a watchlist domain links OUT to.
 * Used for prospecting lists ("domains this site already trusts").
 */
export const outboundDomainsTable = pgTable(
  "outbound_domains",
  {
    id: serial("id").primaryKey(),
    releaseName: text("release_name").notNull(),
    sourceDomain: text("source_domain").notNull(),
    outboundDomain: text("outbound_domain").notNull(),
  },
  (table) => [
    uniqueIndex("outbound_domains_unique_idx").on(
      table.releaseName,
      table.sourceDomain,
      table.outboundDomain,
    ),
    index("outbound_domains_source_idx").on(
      table.releaseName,
      table.sourceDomain,
    ),
  ],
);

export const insertOutboundDomainSchema = createInsertSchema(
  outboundDomainsTable,
).omit({ id: true });
export type InsertOutboundDomain = z.infer<typeof insertOutboundDomainSchema>;
export type OutboundDomain = typeof outboundDomainsTable.$inferSelect;
