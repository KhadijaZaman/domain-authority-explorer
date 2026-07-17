import { Link } from "wouter"
import { useGetRecentLookups, useGetTopDomains } from "@workspace/api-client-react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"

export function Sidebar() {
  const { data: topDomains, isLoading: topLoading } = useGetTopDomains({ limit: 10 })
  const { data: recentLookups, isLoading: recentLoading } = useGetRecentLookups({ limit: 10 })

  return (
    <div className="flex flex-col gap-6 w-full lg:w-80 shrink-0">
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground font-semibold">
            Top Ranked Domains
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            {topLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-12" />
                </div>
              ))
            ) : topDomains?.length ? (
              topDomains.map((d, i) => (
                <Link key={d.domain} href={`/?d=${d.domain}`} className="flex items-center justify-between group">
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-muted-foreground w-4">{d.rank}</span>
                    <span className="text-sm font-medium group-hover:text-primary transition-colors truncate max-w-[150px]">
                      {d.domain}
                    </span>
                  </div>
                  <span className="font-mono text-xs font-bold text-primary bg-primary/5 px-2 py-0.5">
                    {d.authorityScore.toFixed(1)}
                  </span>
                </Link>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">No data available</div>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-sm uppercase tracking-wider text-muted-foreground font-semibold">
            Recent Lookups
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3">
            {recentLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <Skeleton className="h-4 w-24" />
                </div>
              ))
            ) : recentLookups?.length ? (
              recentLookups.map((r, i) => (
                <Link key={i} href={`/?d=${r.domain}`} className="flex items-center justify-between group">
                  <span className="text-sm font-medium group-hover:text-primary transition-colors truncate max-w-[180px]">
                    {r.domain}
                  </span>
                  {!r.found && (
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 uppercase">not ranked</Badge>
                  )}
                </Link>
              ))
            ) : (
              <div className="text-sm text-muted-foreground">No recent lookups</div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
