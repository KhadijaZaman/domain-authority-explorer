import {
  pgTable,
  text,
  serial,
  timestamp,
  jsonb,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** 24h cache of DataForSEO backlink summary responses, so repeat lookups don't re-spend API credits. */
export const dataforseoCacheTable = pgTable(
  "dataforseo_cache",
  {
    id: serial("id").primaryKey(),
    domain: text("domain").notNull(),
    payload: jsonb("payload").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("dataforseo_cache_domain_idx").on(table.domain)],
);

export const insertDataforseoCacheSchema = createInsertSchema(
  dataforseoCacheTable,
).omit({ id: true, fetchedAt: true });
export type InsertDataforseoCache = z.infer<typeof insertDataforseoCacheSchema>;
export type DataforseoCache = typeof dataforseoCacheTable.$inferSelect;
