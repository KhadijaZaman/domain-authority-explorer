import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  doublePrecision,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Single-row table holding the "current release" pointer and sync metadata.
 * The sync job loads a new release's rows first, then atomically flips
 * currentRelease inside a transaction, so the live app never serves a
 * half-loaded dataset.
 */
export const syncMetaTable = pgTable("sync_meta", {
  id: serial("id").primaryKey(),
  currentRelease: text("current_release"),
  lastProcessedRelease: text("last_processed_release"),
  releaseDate: text("release_date"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
  domainCount: integer("domain_count").notNull().default(0),
  totalDomainsInRelease: integer("total_domains_in_release"),
  // Edges sync (referring domains) metadata
  edgesRelease: text("edges_release"),
  edgesPreviousRelease: text("edges_previous_release"),
  edgesSyncedAt: timestamp("edges_synced_at", { withTimezone: true }),
  edgesCoveragePercent: doublePrecision("edges_coverage_percent"),
});

export const insertSyncMetaSchema = createInsertSchema(syncMetaTable).omit({
  id: true,
});
export type InsertSyncMeta = z.infer<typeof insertSyncMetaSchema>;
export type SyncMeta = typeof syncMetaTable.$inferSelect;
