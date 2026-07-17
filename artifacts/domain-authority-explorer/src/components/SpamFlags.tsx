import * as React from "react"
import { useGetReferringDomains, getGetReferringDomainsQueryKey } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { ShieldAlert, ShieldCheck, Sparkles } from "lucide-react"
import { InfoTooltip } from "@/components/ui/tooltip"

/**
 * Disavow-prep view: heuristic spam/toxicity signals over the referring
 * domains list (low outbound diversity, PBN-style patterns, open platforms).
 */
export function SpamFlags({ domain }: { domain: string }) {
  const { data, isLoading } = useGetReferringDomains(domain, undefined, {
    query: {
      queryKey: getGetReferringDomainsQueryKey(domain),
      enabled: !!domain,
      retry: false,
    },
  })

  if (isLoading) {
    return <Card className="border-border"><Skeleton className="w-full h-40" /></Card>
  }

  if (!data || !data.available) {
    return (
      <Card className="border-border bg-muted/10">
        <CardContent className="p-6 text-center text-sm text-muted-foreground">
          Spam signals are computed from the referring-domains list, which has not been synced for
          this domain yet.
        </CardContent>
      </Card>
    )
  }

  const flagged = (data.entries ?? []).filter((e) => e.flag === "low_diversity")
  const platforms = (data.entries ?? []).filter((e) => e.flag === "platform")

  return (
    <Card className="border-border overflow-hidden">
      <CardHeader className="bg-muted/20 border-b border-border/50 pb-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <CardTitle className="text-lg flex items-center gap-2">
            {flagged.length > 0 ? (
              <ShieldAlert className="w-5 h-5 text-destructive" />
            ) : (
              <ShieldCheck className="w-5 h-5 text-chart-2" />
            )}
            {flagged.length > 0
              ? `${flagged.length} referrer${flagged.length === 1 ? "" : "s"} flagged`
              : "No spam signals detected"}
            <InfoTooltip text="Heuristic pass over referring domains: 'Low Diversity' = links out to very few domains, a common PBN/link-farm pattern. 'Platform' = massive outbound count typical of open platforms (not spam, just a weaker link). These are signals for a disavow shortlist, not verdicts." />
          </CardTitle>
          {platforms.length > 0 && (
            <Badge variant="secondary" className="font-mono bg-primary/10 text-primary border-primary/20">
              <Sparkles className="w-3 h-3 mr-1" />
              {platforms.length} open platform{platforms.length === 1 ? "" : "s"}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {flagged.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            None of the top referring domains show PBN-style patterns (low outbound diversity). A
            clean profile — nothing to prep for disavow right now.
          </p>
        ) : (
          <>
            <p className="p-4 text-sm text-muted-foreground border-b border-border/50">
              These referrers link out to unusually few domains — a pattern typical of private blog
              networks and paid-link farms. Review them before adding to a disavow file; some may be
              legitimate niche sites.
            </p>
            <div className="overflow-x-auto w-full">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent bg-muted/5">
                    <TableHead>Flagged Domain</TableHead>
                    <TableHead className="text-right">Auth Score</TableHead>
                    <TableHead className="text-right">
                      <span className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                        Outbound Degree
                        <InfoTooltip text="How many distinct domains it links out to — very low counts are the red flag here." />
                      </span>
                    </TableHead>
                    <TableHead>Signal</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {flagged.map((entry, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="font-mono font-medium">
                        <a href={`/?d=${entry.domain}`} className="hover:text-primary transition-colors">
                          {entry.domain}
                        </a>
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {entry.authorityScore !== null ? entry.authorityScore.toFixed(2) : "-"}
                      </TableCell>
                      <TableCell className="text-right font-mono text-muted-foreground">
                        {new Intl.NumberFormat().format(entry.outboundDegree)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="bg-destructive/10 text-destructive border-destructive/20 text-xs py-0 h-5 whitespace-nowrap">
                          <ShieldAlert className="w-3 h-3 mr-1" />
                          Low Diversity
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}
