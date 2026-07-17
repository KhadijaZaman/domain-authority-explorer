import * as React from "react"
import { useGetBacklinkSummary, getGetBacklinkSummaryQueryKey } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Link as LinkIcon, Database, Unlink, ServerCrash, ExternalLink, AlertCircle } from "lucide-react"
import { InfoTooltip } from "@/components/ui/tooltip"

export function HybridScore({ domain }: { domain: string }) {
  const { data, isLoading, error, refetch } = useGetBacklinkSummary(domain, {
    query: {
      queryKey: getGetBacklinkSummaryQueryKey(domain),
      enabled: !!domain,
      retry: false
    }
  })

  if (isLoading) {
    return <Card className="border-2 border-border h-48"><Skeleton className="w-full h-full" /></Card>
  }

  if (error) {
    const status = (error as any).status
    if (status === 502) {
      return (
        <Card className="border border-amber-500/20 bg-amber-500/5">
          <CardContent className="p-6 flex flex-col items-center justify-center text-center gap-2">
            <AlertCircle className="w-6 h-6 text-amber-500/50" />
            <p className="text-sm text-amber-600 dark:text-amber-400 font-medium">
              The Hybrid Score blends Common Crawl authority with live DataForSEO backlink data — but the
              DataForSEO account needs credit, so the live half can't be fetched right now. All Common Crawl
              scores above are unaffected.
            </p>
            <button onClick={() => refetch()} className="text-xs text-amber-600 dark:text-amber-400 underline hover:opacity-80">Try again</button>
          </CardContent>
        </Card>
      )
    }
    return null
  }

  if (!data) return null

  if (!data.configured) {
    return (
      <Card className="border-2 border-dashed border-border/50 bg-muted/10 relative overflow-hidden">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            Hybrid Score
            <InfoTooltip text="Blend of two sources: Common Crawl structural authority (free, transparent, monthly) + DataForSEO backlink & anchor-text data (fresher, commercial). Each component is labeled with its source." />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-6 text-center">
            <Database className="w-8 h-8 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground max-w-sm">{data.message || "Configure external credentials to enable Hybrid Score."}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-2 border-chart-4/20 bg-gradient-to-br from-background to-chart-4/5 relative overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          Hybrid Score
          <InfoTooltip text="Blend of two sources: Common Crawl structural authority (free, transparent, monthly) + DataForSEO backlink & anchor-text data (fresher, commercial). Each component is labeled with its source." />
        </CardTitle>
        <CardDescription className="text-xs">
          Blends Common Crawl structure with DataForSEO fresh links
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2 mb-6">
          <span className="text-6xl font-mono font-bold tracking-tighter text-chart-4">
            {data.hybridScore !== null ? data.hybridScore.toFixed(2) : '-'}
          </span>
          <span className="text-xl font-mono text-chart-4/50">/100</span>
        </div>
        
        <div className="grid grid-cols-2 gap-4 pt-4 border-t border-border/50">
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase font-semibold text-muted-foreground tracking-wider flex items-center gap-1">
              Common Crawl
              <InfoTooltip text="Source: Common Crawl web graph" />
            </span>
            <span className="font-mono text-sm font-medium">Authority: {data.ccAuthorityScore?.toFixed(2) || '-'}</span>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-xs uppercase font-semibold text-muted-foreground tracking-wider flex items-center gap-1">
              DataForSEO
              <ExternalLink className="w-3 h-3 opacity-50" />
              <InfoTooltip text="Source: DataForSEO API (live, cached 24h)" />
            </span>
            <span className="font-mono text-sm font-medium">Score: {data.dataforseoScore?.toFixed(2) || '-'}</span>
            <span className="font-mono text-sm font-medium">Rank: {data.dataforseoRank ? `#${data.dataforseoRank}` : '-'}</span>
          </div>
        </div>

        <div className="flex gap-6 mt-4 pt-4 border-t border-border/50">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <LinkIcon className="w-4 h-4 text-chart-2" />
            <span className="font-mono font-medium text-foreground">{data.backlinks !== null ? new Intl.NumberFormat().format(data.backlinks) : '-'}</span>
            <span className="text-xs">Links (DataForSEO)</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Database className="w-4 h-4 text-chart-3" />
            <span className="font-mono font-medium text-foreground">{data.referringDomains !== null ? new Intl.NumberFormat().format(data.referringDomains) : '-'}</span>
            <span className="text-xs">Ref. Domains (DataForSEO)</span>
          </div>
          {data.brokenBacklinks !== null && data.brokenBacklinks > 0 && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <Unlink className="w-4 h-4" />
              <span className="font-mono font-medium">{new Intl.NumberFormat().format(data.brokenBacklinks)}</span>
              <span className="text-xs">Broken</span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
