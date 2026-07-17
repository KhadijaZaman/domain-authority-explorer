import * as React from "react"
import { useLocation, useSearch } from "wouter"
import {
  useCompareDomains,
  getCompareDomainsQueryKey,
  useGetReferringDomains,
  getGetReferringDomainsQueryKey,
} from "@workspace/api-client-react"
import { Navbar } from "@/components/Navbar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { ArrowRightLeft, AlertCircle, FileUp, Link2, ExternalLink } from "lucide-react"
import { normalizeDomain } from "@/lib/normalizeDomain"
import { TierBadge } from "@/components/TierBadge"
import { InfoTooltip } from "@/components/ui/tooltip"

const TOP_REFERRERS_SHOWN = 8

// Per-domain link profile card: referring-domain count + top linked domains.
function LinkDetailsCard({ domain }: { domain: string }) {
  const { data, isLoading } = useGetReferringDomains(domain, undefined, {
    query: {
      queryKey: getGetReferringDomainsQueryKey(domain),
      enabled: !!domain,
      retry: false,
    },
  })

  return (
    <Card className="border-border overflow-hidden flex flex-col">
      <CardHeader className="bg-muted/20 border-b border-border/50 py-3 px-4">
        <CardTitle className="text-sm font-mono flex items-center justify-between gap-2">
          <span className="truncate">{domain}</span>
          {data?.available && (
            <Badge variant="secondary" className="font-mono text-[10px] bg-background border-border shrink-0">
              {new Intl.NumberFormat().format(data.referringCount)} referring domains
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0 flex-1">
        {isLoading ? (
          <div className="p-4 flex flex-col gap-2">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
          </div>
        ) : !data?.available ? (
          <p className="p-4 text-xs text-muted-foreground">
            {data?.message || "Link data isn't available for this domain yet. It's collected by the link sync after a domain has been looked up."}
          </p>
        ) : data.entries.length === 0 ? (
          <p className="p-4 text-xs text-muted-foreground">No referring domains found.</p>
        ) : (
          <ul className="divide-y divide-border/50">
            {data.entries.slice(0, TOP_REFERRERS_SHOWN).map((entry, i) => (
              <li key={i} className="flex items-center justify-between gap-2 px-4 py-2 group">
                <a
                  href={`/?d=${entry.domain}`}
                  className="font-mono text-xs truncate hover:text-primary transition-colors flex items-center gap-1"
                >
                  {entry.domain}
                  <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity shrink-0" />
                </a>
                <span className="font-mono text-xs text-muted-foreground shrink-0">
                  {entry.authorityScore !== null ? entry.authorityScore.toFixed(1) : "-"}
                </span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export default function Compare() {
  // useSearch subscribes to query-string changes; window.location.search
  // alone never re-renders after client-side navigation.
  const searchParams = new URLSearchParams(useSearch())
  const queryDomains = searchParams.get("domains") || ""
  
  const [, setLocation] = useLocation()
  const [inputValue, setInputValue] = React.useState(queryDomains)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (inputValue.trim()) {
      const clean = inputValue.split(/[,\s]+/)
        .map(d => normalizeDomain(d))
        .filter(Boolean)
        .slice(0,5)
        .join(',')
      setLocation(`/compare?domains=${encodeURIComponent(clean)}`)
    }
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const text = event.target?.result as string
      if (!text) return
      
      const lines = text.split(/\r?\n/)
      const parsedDomains: string[] = []
      
      for (const line of lines) {
        const firstCol = line.split(',')[0]?.trim()
        if (!firstCol) continue
        
        // Skip obvious headers
        if (firstCol.toLowerCase().includes('domain') || firstCol.toLowerCase().includes('url')) {
          continue
        }

        const normalized = normalizeDomain(firstCol)
        if (normalized) {
          parsedDomains.push(normalized)
        }
      }

      // Dedupe
      const uniqueDomains = Array.from(new Set(parsedDomains))
      
      if (uniqueDomains.length > 5) {
        alert(`Found ${uniqueDomains.length} unique domains. Taking only the first 5 for comparison.`)
      } else if (uniqueDomains.length === 0) {
        alert("No valid domains found in the CSV.")
        return
      }

      const top5 = uniqueDomains.slice(0, 5)
      setInputValue(top5.join(', '))
      setLocation(`/compare?domains=${encodeURIComponent(top5.join(','))}`)
    }
    reader.readAsText(file)
    
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  const { data, isLoading, error } = useCompareDomains(
    { domains: queryDomains },
    {
      query: {
        queryKey: getCompareDomainsQueryKey({ domains: queryDomains }),
        enabled: !!queryDomains,
        retry: false
      }
    }
  )

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <Navbar />
      
      <main className="flex-1 p-6 md:p-10 lg:p-12 w-full max-w-screen-xl mx-auto flex flex-col gap-10">
        
        <div className="flex flex-col gap-4">
          <h1 className="text-3xl font-bold tracking-tight">Bulk Compare</h1>
          <p className="text-muted-foreground max-w-2xl">
            Competitive research at a glance: paste your domain plus up to 4 competitors (spaces or
            commas both work), or upload a CSV, and see everyone ranked side by side on the latest
            Common Crawl graph. The strongest domain is marked as the leader, and the best value in
            each column is highlighted.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 max-w-3xl mt-2 items-start sm:items-center">
            <form onSubmit={handleSubmit} className="flex-1 flex gap-3 w-full">
              <Input
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                placeholder="e.g. github.com, stripe.com"
                className="h-12 font-mono"
              />
              <Button type="submit" size="lg" className="h-12 px-6 font-bold">
                Compare <ArrowRightLeft className="ml-2 w-4 h-4 hidden sm:block" />
              </Button>
            </form>
            <div className="flex items-center gap-3">
              <span className="text-sm text-muted-foreground uppercase font-bold tracking-wider hidden sm:block">OR</span>
              <div className="relative">
                <Input 
                  type="file" 
                  accept=".csv"
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  onChange={handleFileUpload}
                  ref={fileInputRef}
                />
                <Button variant="outline" size="lg" className="h-12 px-6 w-full pointer-events-none">
                  <FileUp className="mr-2 w-4 h-4" /> Upload CSV
                </Button>
              </div>
            </div>
          </div>
        </div>

        {(!data || data.length === 0) && !isLoading && !error && (
          <div className="mt-4 border-2 border-dashed border-border/50 rounded-xl p-12 flex flex-col items-center justify-center text-center bg-muted/5">
            <h3 className="text-lg font-semibold mb-2">Ready to compare?</h3>
            <p className="text-muted-foreground mb-6 max-w-sm">Enter domains above or try a sample comparison to see how it works.</p>
            <Button variant="secondary" onClick={() => {
              const sample = "replit.com, github.com, vercel.com"
              setInputValue(sample)
              setLocation(`/compare?domains=${encodeURIComponent(sample)}`)
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
                Loading comparisons...
              </div>
            </CardContent>
          </Card>
        )}

        {error && (
          <div className="p-4 bg-destructive/10 text-destructive text-sm rounded-sm font-mono flex items-center gap-3 border border-destructive/20">
            <AlertCircle className="w-4 h-4" />
            Failed to load comparison data. Please check your domains.
          </div>
        )}

        {data && data.length > 0 && (() => {
          const found = data.filter((r) => r.found)
          const bestAuth = found.length ? Math.max(...found.map((r) => r.authorityScore ?? -1)) : null
          const bestPop = found.length ? Math.max(...found.map((r) => r.popularityScore ?? -1)) : null
          return (
          <>
          <Card className="border-border shadow-sm overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead className="font-semibold uppercase tracking-wider text-xs">Domain</TableHead>
                  <TableHead className="font-semibold uppercase tracking-wider text-xs">
                    <span className="flex items-center gap-1.5">
                      Tier
                      <InfoTooltip text="Rank tier in the current Common Crawl release: Elite ≤100, then top 1k / 10k / 100k / 1M." />
                    </span>
                  </TableHead>
                  <TableHead className="font-semibold uppercase tracking-wider text-xs text-right">
                    <span className="flex items-center justify-end gap-1.5">
                      Authority Score
                      <InfoTooltip text="Harmonic centrality from Common Crawl's public web graph (121M domains). Measures how reachable this domain is from everywhere else in the link graph — hard to inflate with link spam. Percentile-scaled 0–100. Source: Common Crawl." />
                    </span>
                  </TableHead>
                  <TableHead className="font-semibold uppercase tracking-wider text-xs text-right">
                    <span className="flex items-center justify-end gap-1.5">
                      Popularity Score
                      <InfoTooltip text="PageRank on the same Common Crawl graph — links from heavily-linked domains count more. Reflects raw link popularity rather than centrality. Percentile-scaled 0–100. Source: Common Crawl." />
                    </span>
                  </TableHead>
                  <TableHead className="font-semibold uppercase tracking-wider text-xs text-right">
                    <span className="flex items-center justify-end gap-1.5">
                      Auth Rank
                      <InfoTooltip text="Position among all 121M domains in the current release, ranked by this metric." />
                    </span>
                  </TableHead>
                  <TableHead className="font-semibold uppercase tracking-wider text-xs text-right">
                    <span className="flex items-center justify-end gap-1.5">
                      Pop Rank
                      <InfoTooltip text="Position among all 121M domains in the current release, ranked by this metric." />
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row) => {
                  // Tie-aware: every row sharing the top authority score gets the badge
                  const isLeader = row.found && bestAuth !== null && row.authorityScore === bestAuth
                  const isBestAuth = row.found && bestAuth !== null && row.authorityScore === bestAuth
                  const isBestPop = row.found && bestPop !== null && row.popularityScore === bestPop
                  return (
                  <TableRow key={row.domain} className={`group ${isLeader ? "bg-primary/5" : ""}`}>
                    <TableCell className="font-mono font-medium text-base">
                      {row.domain}
                      {isLeader && <Badge className="ml-3 text-[10px] bg-primary text-primary-foreground">LEADER</Badge>}
                      {!row.found && (
                        <InfoTooltip text="Not in the top 1M ranked domains of this Common Crawl release — every ranked domain here outranks it.">
                          <Badge tabIndex={0} variant="secondary" className="ml-3 text-[10px] cursor-help">NOT RANKED</Badge>
                        </InfoTooltip>
                      )}
                    </TableCell>
                    <TableCell>
                      {row.found ? <TierBadge rank={row.authorityRank} /> : '-'}
                    </TableCell>
                    <TableCell className={`text-right font-mono font-bold text-lg ${isBestAuth ? "text-primary" : "text-foreground/70"}`}>
                      {row.found ? row.authorityScore?.toFixed(2) : '-'}
                    </TableCell>
                    <TableCell className={`text-right font-mono text-lg ${isBestPop ? "font-bold" : "text-foreground/70"}`}>
                      {row.found ? row.popularityScore?.toFixed(2) : '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {row.found && row.authorityRank ? `#${new Intl.NumberFormat().format(row.authorityRank)}` : '-'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted-foreground">
                      {row.found && row.popularityRank ? `#${new Intl.NumberFormat().format(row.popularityRank)}` : '-'}
                    </TableCell>
                  </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </Card>

          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-2">
              <Link2 className="w-4 h-4 text-primary" />
              <h2 className="text-lg font-semibold tracking-tight">Link Profiles</h2>
              <InfoTooltip text="Each domain's top referring domains from the Common Crawl edge list, with the referrer's own Authority Score. Link data is collected for domains that have been looked up before, so new domains may show no data until the next sync." />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
              {data.map((row) => (
                <LinkDetailsCard key={row.domain} domain={row.domain} />
              ))}
            </div>
          </div>
          </>
          )
        })()}

      </main>
    </div>
  )
}
