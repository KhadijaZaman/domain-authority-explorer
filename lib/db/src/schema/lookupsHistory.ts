import {
  pgTable,
  text,
  serial,
  doublePrecision,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * One score snapshot per (domain, release). Appended when a domain is looked
 * up, and by the sync job for previously looked-up domains on each new
 * release — this powers the historical trend line.
 */
export const lookupsHistoryTable = pgTable(
  "lookups_history",
  {
    id: serial("id").primaryKey(),
    domain: text("domain").notNull(),
    releaseName: text("release_name").notNull(),
    authorityScore: doublePrecision("authority_score").notNull(),
    popularityScore: doublePrecision("popularity_score").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("lookups_history_domain_release_idx").on(
      table.domain,
      table.releaseName,
    ),
  ],
);

export const insertLookupHistorySchema = createInsertSchema(
  lookupsHistoryTable,
).omit({ id: true, recordedAt: true });
export type InsertLookupHistory = z.infer<typeof insertLookupHistorySchema>;
export type LookupHistory = typeof lookupsHistoryTable.$inferSelect;
