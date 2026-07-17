import * as React from "react"
import { useGetTopDomains, getGetTopDomainsQueryKey } from "@workspace/api-client-react"
import { Navbar } from "@/components/Navbar"
import { Card, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Input } from "@/components/ui/input"
import { TierBadge } from "@/components/TierBadge"
import { Link } from "wouter"
import { Search } from "lucide-react"
import { InfoTooltip } from "@/components/ui/tooltip"

export default function Leaderboard() {
  const [searchTerm, setSearchTerm] = React.useState("")
  
  const { data, isLoading } = useGetTopDomains({ limit: 1000 }, {
    query: {
      queryKey: getGetTopDomainsQueryKey({ limit: 1000 }),
      staleTime: 1000 * 60 * 5 // cache for 5 min
    }
  })

  const filteredData = React.useMemo(() => {
    if (!data) return []
    if (!searchTerm.trim()) return data
    const term = searchTerm.toLowerCase().trim()
    return data.filter(d => d.domain.toLowerCase().includes(term))
  }, [data, searchTerm])

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <Navbar />
      
      <main className="flex-1 p-6 md:p-10 lg:p-12 w-full max-w-screen-xl mx-auto flex flex-col gap-8">
        
        <div className="flex flex-col gap-4">
          <h1 className="text-3xl font-bold tracking-tight">Top 1000 Domains</h1>
          <p className="text-muted-foreground max-w-2xl">
            Browse the 1,000 most authoritative domains on the open web, based on Common Crawl's latest release.
          </p>
          
          <div className="relative max-w-md mt-2">
            <div className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
              <Search className="h-4 w-4" />
            </div>
            <Input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search within top 1000..."
              className="pl-9 h-10"
            />
          </div>
        </div>

        {isLoading ? (
          <Card className="border-border">
            <CardContent className="p-10 flex justify-center items-center">
              <div className="animate-pulse flex gap-2 items-center text-muted-foreground font-mono">
                <span className="w-3 h-3 bg-primary rounded-full"></span>
                Loading top 1000...
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-border shadow-sm overflow-x-auto">
            <Table>
              <TableHeader className="bg-muted/30 sticky top-0 backdrop-blur-sm z-10">
                <TableRow>
                  <TableHead className="font-semibold uppercase tracking-wider text-xs w-[100px] h-12">
                    <span className="flex items-center gap-1.5">
                      Rank
                      <InfoTooltip text="Overall rank across 121M domains measured by Harmonic Centrality." />
                    </span>
                  </TableHead>
                  <TableHead className="font-semibold uppercase tracking-wider text-xs">Domain</TableHead>
                  <TableHead className="font-semibold uppercase tracking-wider text-xs">
                    <span className="flex items-center gap-1.5">
                      Tier
                      <InfoTooltip text="Rank tier in the current Common Crawl release: Elite ≤100, then top 1k / 10k / 100k / 1M." />
                    </span>
                  </TableHead>
                  <TableHead className="font-semibold uppercase tracking-wider text-xs text-right">
                    <span className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                      Authority Score
                      <InfoTooltip text="Harmonic centrality from Common Crawl's public web graph (121M domains). Measures how reachable this domain is from everywhere else in the link graph — hard to inflate with link spam. Percentile-scaled 0–100. Source: Common Crawl." />
                    </span>
                  </TableHead>
                  <TableHead className="font-semibold uppercase tracking-wider text-xs text-right">
                    <span className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                      Popularity Score
                      <InfoTooltip text="PageRank on the same Common Crawl graph — links from heavily-linked domains count more. Reflects raw link popularity rather than centrality. Percentile-scaled 0–100. Source: Common Crawl." />
                    </span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredData.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                      No domains found matching "{searchTerm}".
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredData.map((row) => (
                    <TableRow key={row.domain} className="group">
                      <TableCell className="font-mono text-muted-foreground">
                        #{row.rank}
                      </TableCell>
                      <TableCell className="font-mono font-medium text-base">
                        <Link href={`/?d=${row.domain}`} className="hover:text-primary transition-colors">
                          {row.domain}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <TierBadge rank={row.rank} />
                      </TableCell>
                      <TableCell className="text-right font-mono font-bold text-primary text-lg">
                        {row.authorityScore.toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-lg">
                        {row.popularityScore.toFixed(2)}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </Card>
        )}

      </main>
    </div>
  )
}
