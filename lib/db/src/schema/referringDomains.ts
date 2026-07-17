import {
  pgTable,
  text,
  serial,
  integer,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Inbound link rows extracted from the Common Crawl edges file by the edges
 * sync job, for watchlisted (previously looked-up) domains only.
 * outboundDegree is the referring domain's total distinct outbound targets,
 * used for spam ("low diversity") and platform-opportunity flags.
 */
export const referringDomainsTable = pgTable(
  "referring_domains",
  {
    id: serial("id").primaryKey(),
    releaseName: text("release_name").notNull(),
    targetDomain: text("target_domain").notNull(),
    referringDomain: text("referring_domain").notNull(),
    outboundDegree: integer("outbound_degree").notNull(),
  },
  (table) => [
    uniqueIndex("referring_domains_unique_idx").on(
      table.releaseName,
      table.targetDomain,
      table.referringDomain,
    ),
    index("referring_domains_target_idx").on(
      table.releaseName,
      table.targetDomain,
    ),
  ],
);

export const insertReferringDomainSchema = createInsertSchema(
  referringDomainsTable,
).omit({ id: true });
export type InsertReferringDomain = z.infer<
  typeof insertReferringDomainSchema
>;
export type ReferringDomain = typeof referringDomainsTable.$inferSelect;
