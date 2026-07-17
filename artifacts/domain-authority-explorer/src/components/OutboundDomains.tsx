import * as React from "react"
import { useGetOutboundDomains, getGetOutboundDomainsQueryKey } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AlertCircle, ExternalLink, ChevronDown, ChevronUp } from "lucide-react"
import { InfoTooltip } from "@/components/ui/tooltip"

const DEFAULT_VISIBLE = 50

export function OutboundDomains({ domain }: { domain: string }) {
  const [showAll, setShowAll] = React.useState(false)
  const { data, isLoading } = useGetOutboundDomains(domain, {
    query: {
      queryKey: getGetOutboundDomainsQueryKey(domain),
      enabled: !!domain,
      retry: false
    }
  })

  // Collapse back to the default view when looking up a new domain
  React.useEffect(() => {
    setShowAll(false)
  }, [domain])

  if (isLoading) {
    return <Card className="border-border mt-6"><Skeleton className="w-full h-64" /></Card>
  }

  if (!data) return null

  const visibleEntries = showAll ? data.entries : data.entries.slice(0, DEFAULT_VISIBLE)

  if (!data.available) {
    return (
      <Card className="border-border bg-muted/10 mt-6">
        <CardContent className="p-8 flex flex-col items-center justify-center text-center">
          <AlertCircle className="w-10 h-10 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground max-w-md">
            {data.message || "Outbound domains data is not yet available for this release."}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border mt-6 overflow-hidden">
      <CardHeader className="bg-muted/20 border-b border-border/50 pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            Domains {domain} links out to
            <InfoTooltip text="The same edge list read in reverse: domains this site links out to — a prospecting list of sites it already trusts.">
              <Badge tabIndex={0} variant="secondary" className="font-mono ml-2 bg-background border-border cursor-help">{new Intl.NumberFormat().format(data.count)} targets</Badge>
            </InfoTooltip>
          </CardTitle>
          {data.message && (
             <span className="text-xs text-muted-foreground bg-background px-2 py-1 rounded-sm border border-border/50 shadow-sm flex items-center gap-1.5">
               <AlertCircle className="w-3.5 h-3.5" />
               {data.message}
             </span>
          )}
        </div>
      </CardHeader>

      <div className="overflow-x-auto w-full">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[300px]">Domain</TableHead>
              <TableHead className="text-right flex items-center justify-end gap-1.5 h-12">
                Authority Score
                <InfoTooltip text="The target's own Authority Score — Harmonic centrality from Common Crawl's public web graph (121M domains)." />
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {data.entries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={2} className="text-center py-8 text-muted-foreground">
                  No outbound domains found in sample.
                </TableCell>
              </TableRow>
            ) : (
              visibleEntries.map((entry, idx) => (
                <TableRow key={idx} className="group">
                  <TableCell className="font-mono font-medium flex items-center gap-2">
                    <a href={`/?d=${entry.domain}`} className="hover:text-primary transition-colors flex items-center gap-1">
                      {entry.domain} <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                    </a>
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground group-hover:text-foreground transition-colors">
                    {entry.authorityScore !== null ? entry.authorityScore.toFixed(2) : '-'}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {data.entries.length > DEFAULT_VISIBLE && (
        <div className="border-t border-border/50 bg-muted/10">
          <button
            onClick={() => setShowAll(!showAll)}
            className="w-full py-3 flex items-center justify-center gap-2 text-xs font-mono text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
          >
            {showAll ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                Show less
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                Show all {new Intl.NumberFormat().format(data.entries.length)} domains
              </>
            )}
          </button>
        </div>
      )}
    </Card>
  )
}
