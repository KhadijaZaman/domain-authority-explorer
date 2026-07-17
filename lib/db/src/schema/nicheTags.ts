import {
  pgTable,
  text,
  serial,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** User-assigned industry/niche label per domain (powers niche-relative scoring). */
export const nicheTagsTable = pgTable(
  "niche_tags",
  {
    id: serial("id").primaryKey(),
    domain: text("domain").notNull(),
    tag: text("tag").notNull(),
    taggedAt: timestamp("tagged_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("niche_tags_domain_idx").on(table.domain),
    index("niche_tags_tag_idx").on(table.tag),
  ],
);

export const insertNicheTagSchema = createInsertSchema(nicheTagsTable).omit({
  id: true,
  taggedAt: true,
});
export type InsertNicheTag = z.infer<typeof insertNicheTagSchema>;
export type NicheTag = typeof nicheTagsTable.$inferSelect;
