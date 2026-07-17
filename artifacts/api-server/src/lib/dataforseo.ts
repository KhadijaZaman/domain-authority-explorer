import { eq } from "drizzle-orm";
import { db, dataforseoCacheTable } from "@workspace/db";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface DfsBacklinkSummary {
  backlinks: number | null;
  referringDomains: number | null;
  referringMainDomains: number | null;
  brokenBacklinks: number | null;
  rank: number | null; // DataForSEO domain rank, 0-1000
}

export function dataforseoConfigured(): boolean {
  return !!(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD);
}

/**
 * Fetch DataForSEO backlink summary for a domain, cached for 24h so repeat
 * lookups don't re-spend API credits.
 * Returns { summary, cachedAt } — throws on API failure.
 */
export async function getBacklinkSummaryCached(
  domain: string,
): Promise<{ summary: DfsBacklinkSummary; cachedAt: Date }> {
  const [cached] = await db
    .select()
    .from(dataforseoCacheTable)
    .where(eq(dataforseoCacheTable.domain, domain))
    .limit(1);

  if (cached && Date.now() - cached.fetchedAt.getTime() < CACHE_TTL_MS) {
    return {
      summary: cached.payload as unknown as DfsBacklinkSummary,
      cachedAt: cached.fetchedAt,
    };
  }

  const auth = Buffer.from(
    `${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`,
  ).toString("base64");

  const res = await fetch(
    "https://api.dataforseo.com/v3/backlinks/summary/live",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify([
        { target: domain, include_subdomains: true, internal_list_limit: 1 },
      ]),
      signal: AbortSignal.timeout(30_000),
    },
  );

  if (!res.ok) {
    throw new Error(`DataForSEO HTTP ${res.status}`);
  }
  const json = (await res.json()) as {
    status_code?: number;
    status_message?: string;
    tasks?: Array<{
      status_code?: number;
      status_message?: string;
      result?: Array<Record<string, unknown>> | null;
    }>;
  };
  if (json.status_code !== 20000) {
    throw new Error(`DataForSEO error: ${json.status_message ?? json.status_code}`);
  }
  const task = json.tasks?.[0];
  if (!task || (task.status_code && task.status_code >= 40000)) {
    throw new Error(`DataForSEO task error: ${task?.status_message ?? "unknown"}`);
  }
  const result = task.result?.[0] ?? null;

  const num = (v: unknown): number | null =>
    typeof v === "number" && Number.isFinite(v) ? v : null;

  const summary: DfsBacklinkSummary = {
    backlinks: num(result?.backlinks),
    referringDomains: num(result?.referring_domains),
    referringMainDomains: num(result?.referring_main_domains),
    brokenBacklinks: num(result?.broken_backlinks),
    rank: num(result?.rank),
  };

  const fetchedAt = new Date();
  await db
    .insert(dataforseoCacheTable)
    .values({ domain, payload: summary as unknown as object })
    .onConflictDoUpdate({
      target: dataforseoCacheTable.domain,
      set: { payload: summary as unknown as object, fetchedAt },
    });

  return { summary, cachedAt: fetchedAt };
}
