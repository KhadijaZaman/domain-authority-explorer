import {
  pgTable,
  text,
  serial,
  boolean,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/** Every domain lookup made through the app (drives "recent lookups" and history tracking). */
export const lookupsTable = pgTable(
  "lookups",
  {
    id: serial("id").primaryKey(),
    domain: text("domain").notNull(),
    found: boolean("found").notNull(),
    lookedUpAt: timestamp("looked_up_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("lookups_looked_up_at_idx").on(table.lookedUpAt)],
);

export const insertLookupSchema = createInsertSchema(lookupsTable).omit({
  id: true,
  lookedUpAt: true,
});
export type InsertLookup = z.infer<typeof insertLookupSchema>;
export type Lookup = typeof lookupsTable.$inferSelect;
