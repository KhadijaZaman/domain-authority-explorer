import * as React from "react"
import { useLocation, useSearch } from "wouter"
import { useGetLinkGap, getGetLinkGapQueryKey } from "@workspace/api-client-react"
import { Navbar } from "@/components/Navbar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Search, AlertCircle, CheckCircle2, ShieldAlert, Sparkles, ExternalLink } from "lucide-react"
import { normalizeDomain } from "@/lib/normalizeDomain"
import { InfoTooltip } from "@/components/ui/tooltip"

export default function LinkGap() {
  // useSearch subscribes to query-string changes; window.location.search
  // alone never re-renders after client-side navigation.
  const searchParams = new URLSearchParams(useSearch())
  const queryDomain = searchParams.get("domain") || ""
  const queryCompetitors = searchParams.get("competitors") || ""
  
  const [, setLocation] = useLocation()
  const [domainInput, setDomainInput] = React.useState(queryDomain)
  const [competitorsInput, setCompetitorsInput] = React.useState(queryCompetitors)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (domainInput.trim() && competitorsInput.trim()) {
      const d = normalizeDomain(domainInput)
      const comps = competitorsInput.split(/[,\s]+/)
        .map(c => normalizeDomain(c))
        .filter(Boolean)
        .slice(0, 4)
        .join(',')
      
      setLocation(`/gap?domain=${encodeURIComponent(d)}&competitors=${encodeURIComponent(comps)}`)
    }
  }

  const { data, isLoading, error } = useGetLinkGap(
    { domain: queryDomain, competitors: queryCompetitors },
    {
      query: {
        queryKey: getGetLinkGapQueryKey({ domain: queryDomain, competitors: queryCompetitors }),
        enabled: !!queryDomain && !!queryCompetitors,
        retry: false
      }
    }
  )

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <Navbar />
      
      <main className="flex-1 p-6 md:p-10 lg:p-12 w-full max-w-screen-xl mx-auto flex flex-col gap-8">
        
        <div className="flex flex-col gap-4 border-b border-border/50 pb-8">
          <h1 className="text-3xl font-bold tracking-tight">Link Gap Finder</h1>
          <p className="text-muted-foreground max-w-2xl">
            See who links to your competitors but not to you. Paste your domain and up to 4 competitors to find new link opportunities.
          </p>
          
          <form onSubmit={handleSubmit} className="flex flex-col md:flex-row gap-4 mt-4 max-w-4xl">
            <div className="flex-1">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">Your Domain</label>
              <Input
                value={domainInput}
                onChange={(e) => setDomainInput(e.target.value)}
                placeholder="e.g. yoursite.com"
                className="h-12 font-mono"
              />
            </div>
            <div className="flex-[2]">
              <label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">Competitors (up to 4, comma separated)</label>
              <div className="flex gap-3">
                <Input
                  value={competitorsInput}
                  onChange={(e) => setCompetitorsInput(e.target.value)}
                  placeholder="e.g. comp1.com, comp2.com"
                  className="h-12 font-mono flex-1"
                />
                <Button type="submit" size="lg" className="h-12 px-6 font-bold" disabled={!domainInput.trim() || !competitorsInput.trim()}>
                  <Search className="w-4 h-4 mr-2" /> Find Gaps
                </Button>
              </div>
            </div>
          </form>
        </div>

        {(!data || data.competitors.length === 0) && !isLoading && !error && (
          <div className="mt-4 border-2 border-dashed border-border/50 rounded-xl p-12 flex flex-col items-center justify-center text-center bg-muted/5">
            <h3 className="text-lg font-semibold mb-2">Looking for link gaps?</h3>
            <p className="text-muted-foreground mb-6 max-w-sm">Enter your domain and competitors above to uncover sites you could get links from.</p>
            <Button variant="secondary" onClick={() => {
              const myDomain = "peec.ai"
              const comps = "replit.com, vercel.com"
              setDomainInput(myDomain)
              setCompetitorsInput(comps)
              setLocation(`/gap?domain=${encodeURIComponent(myDomain)}&competitors=${encodeURIComponent(comps)}`)
            }}>
              Try an example
            </Button>
          </div>
        )}

        {isLoading && (
          <Card className="border-border">
            <CardContent className="p-10 flex justify-center items-center">
              <div className="animate-pulse flex gap-2 items-center text-muted-foreground font-mono">
                <span className="w-3 h-3 bg-primary rounded-full"></span>
                Analyzing intersection...
              </div>
            </CardContent>
          </Card>
        )}

        {data && data.competitors.length > 0 && (
          <div className="flex flex-col gap-6 animate-in fade-in duration-500">
            {/* Summary & Competitor Status */}
            <div className="flex flex-col lg:flex-row gap-6">
              <div className="flex-1 flex gap-4">
                <Card className="flex-1 bg-muted/10 border-border/50">
                  <CardContent className="p-6 flex flex-col justify-center text-center">
                    <span className="text-4xl font-mono font-bold text-foreground mb-1">{new Intl.NumberFormat().format(data.gapCount)}</span>
                    <span className="text-sm text-muted-foreground font-semibold uppercase tracking-wider">Total Gaps</span>
                  </CardContent>
                </Card>
                <Card className="flex-1 border-chart-2/20 bg-chart-2/5">
                  <CardContent className="p-6 flex flex-col justify-center text-center">
                    <span className="text-4xl font-mono font-bold text-chart-2 mb-1">{new Intl.NumberFormat().format(data.attainableCount)}</span>
                    <span className="text-sm text-chart-2/70 font-semibold uppercase tracking-wider flex items-center justify-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Attainable
                    </span>
                  </CardContent>
                </Card>
              </div>

              <Card className="flex-[2] border-border/50 bg-background shadow-sm">
                <CardHeader className="pb-2 pt-4 px-6">
                  <CardTitle className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Competitors Analysed</CardTitle>
                </CardHeader>
                <CardContent className="px-6 pb-4">
                  <div className="flex flex-wrap gap-2">
                    {data.competitors.map(c => (
                      <Badge key={c.domain} variant="secondary" className={`font-mono px-3 py-1 ${!c.available ? 'opacity-50 line-through decoration-muted-foreground/50' : ''}`}>
                        {c.domain}
                      </Badge>
                    ))}
                  </div>
                  {data.competitors.some(c => !c.available) && (
                    <p className="text-xs text-muted-foreground mt-3 flex items-start gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      Crossed out domains have no data yet. They have been added to the watchlist and will appear after the next sync.
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Warning Banner */}
            {data.message && (
              <div className="bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 p-4 text-sm rounded-sm flex items-center gap-3">
                <AlertCircle className="w-5 h-5 shrink-0" />
                <span>{data.message}</span>
              </div>
            )}

            {/* Truncation indicator */}
            {data.entries.length > 0 && data.gapCount > data.entries.length && (
              <p className="text-sm text-muted-foreground flex items-center gap-2 -mb-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Showing the top {new Intl.NumberFormat().format(data.entries.length)} of{" "}
                {new Intl.NumberFormat().format(data.gapCount)} gaps — sorted attainable-first, then
                by authority, so this list is the best-opportunity slice (which is why most rows are
                marked attainable). Narrow the competitor list to surface different gaps.
              </p>
            )}

            {/* Results Table */}
            <Card className="border-border shadow-sm overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/30">
                  <TableRow>
                    <TableHead className="font-semibold uppercase tracking-wider text-xs w-[300px] flex items-center gap-1.5 h-12">
                      Gap Domain
                      <InfoTooltip text="Domains linking to your competitors but not to you (set difference on the Common Crawl graph)." />
                    </TableHead>
                    <TableHead className="font-semibold uppercase tracking-wider text-xs">
                      <span className="flex items-center gap-1.5">
                        Overlap
                        <InfoTooltip text="How many of your competitors this domain links to." />
                      </span>
                    </TableHead>
                    <TableHead className="font-semibold uppercase tracking-wider text-xs">Flags</TableHead>
                    <TableHead className="font-semibold uppercase tracking-wider text-xs text-right whitespace-nowrap">Authority Score</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.entries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center py-12 text-muted-foreground">
                        {data.available === false ? "Data not ready for intersection." : "No gaps found in sample."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.entries.map((entry) => (
                      <TableRow key={entry.domain} className="group">
                        <TableCell className="font-mono font-medium">
                          <a href={`/?d=${entry.domain}`} className="hover:text-primary transition-colors flex items-center gap-1 w-fit">
                            {entry.domain} <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                          </a>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-sm">{entry.linksToCount} of {data.competitors.filter(c => c.available).length}</span>
                            {entry.attainable && (
                              <InfoTooltip text="Heuristic filter: authority 20–80, not a mega-platform, and links to 2+ of your competitors — realistically winnable.">
                                <Badge tabIndex={0} variant="outline" className="text-[10px] uppercase border-chart-2/30 text-chart-2 bg-chart-2/10 cursor-help">
                                  Attainable
                                </Badge>
                              </InfoTooltip>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-2">
                            {entry.flag === "low_diversity" && (
                              <InfoTooltip text="Heuristic spam signals (low outbound diversity, PBN-style patterns) to help prep a disavow list — not a verdict.">
                                <Badge tabIndex={0} variant="secondary" className="bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/20 text-xs py-0 h-5 cursor-help whitespace-nowrap">
                                  <ShieldAlert className="w-3 h-3 mr-1" />
                                  Low Diversity
                                </Badge>
                              </InfoTooltip>
                            )}
                            {entry.flag === "platform" && (
                              <InfoTooltip text="Very high outbound-link count (e.g. github.io-style) — an open platform you can list on, not an editorial link to pitch.">
                                <Badge tabIndex={0} variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20 border-primary/20 text-xs py-0 h-5 cursor-help whitespace-nowrap">
                                  <Sparkles className="w-3 h-3 mr-1" />
                                  Platform
                                </Badge>
                              </InfoTooltip>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-muted-foreground group-hover:text-foreground transition-colors">
                          {entry.authorityScore !== null ? entry.authorityScore.toFixed(2) : '-'}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </Card>

          </div>
        )}
      </main>
    </div>
  )
}
