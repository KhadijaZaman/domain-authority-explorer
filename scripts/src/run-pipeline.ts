/**
 * CLI entry for the full monthly pipeline (ranks -> edges -> subdomains ->
 * history backfill), guarded by the same cross-process advisory lock the
 * api-server release watcher uses — a manual run can never overlap an
 * automatic one.
 *
 *   pnpm --filter @workspace/scripts run sync:all
 */
import { pool } from "@workspace/db";
import { runMonthlyPipeline } from "./pipeline";

runMonthlyPipeline()
  .then(async (result) => {
    await pool.end();
    if (result.skipped) {
      console.log("Pipeline already running elsewhere — nothing to do.");
    }
    process.exit(result.ok ? 0 : 1);
  })
  .catch(async (err) => {
    console.error("pipeline failed:", err);
    await pool.end();
    process.exit(1);
  });
