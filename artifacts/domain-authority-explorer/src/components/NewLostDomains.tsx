import * as React from "react"
import { useGetReferringDomains, getGetReferringDomainsQueryKey } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { TrendingUp, TrendingDown, BellRing } from "lucide-react"
import { InfoTooltip } from "@/components/ui/tooltip"

function DomainChips({ domains, tone }: { domains: string[]; tone: "new" | "lost" }) {
  const [expanded, setExpanded] = React.useState(false)
  const shown = expanded ? domains : domains.slice(0, 15)

  if (domains.length === 0) {
    return <p className="text-sm text-muted-foreground italic">None this release.</p>
  }

  return (
    <div className="flex flex-wrap gap-1.5">
      {shown.map((d) => (
        <a key={d} href={`/?d=${d}`}>
          <Badge
            variant="outline"
            className={
              tone === "new"
                ? "font-mono text-xs bg-chart-3/10 text-chart-3 border-chart-3/30 hover:bg-chart-3/20 cursor-pointer"
                : "font-mono text-xs bg-destructive/10 text-destructive border-destructive/30 hover:bg-destructive/20 cursor-pointer"
            }
          >
            {d}
          </Badge>
        </a>
      ))}
      {domains.length > 15 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-primary underline underline-offset-2 hover:opacity-80 ml-1"
        >
          {expanded ? "Show less" : `+${domains.length - 15} more`}
        </button>
      )}
    </div>
  )
}

/**
 * Ongoing monitoring: diffs this release's referring domains against the
 * previous release — who started linking, who dropped off.
 */
export function NewLostDomains({ domain }: { domain: string }) {
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
          Change tracking starts once link-graph data has been synced for this domain. Each monthly
          release is then compared against the previous one automatically.
        </CardContent>
      </Card>
    )
  }

  const hasPrev = !!data.previousReleaseName
  const newDomains = data.newDomains ?? []
  const lostDomains = data.lostDomains ?? []

  if (!hasPrev) {
    return (
      <Card className="border-border bg-muted/10">
        <CardContent className="p-6 flex items-start gap-3 text-sm text-muted-foreground">
          <BellRing className="w-4 h-4 mt-0.5 shrink-0 opacity-60" />
          <span>
            This is the first release with link data for <span className="font-mono text-foreground">{domain}</span> —
            there is no earlier snapshot to compare against yet. From the next monthly sync onward, this
            section will automatically show which domains started or stopped linking here.
          </span>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      <Card className="border-chart-3/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 text-chart-3">
            <TrendingUp className="w-4 h-4" />
            New this release
            <Badge variant="secondary" className="font-mono bg-chart-3/10 text-chart-3 border-chart-3/20">{newDomains.length}</Badge>
            <InfoTooltip text="Domains linking to you in this Common Crawl release that were not in the previous one — your freshest wins. Source: Common Crawl edge list, diffed monthly." />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DomainChips domains={newDomains} tone="new" />
        </CardContent>
      </Card>

      <Card className="border-destructive/30">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2 text-destructive">
            <TrendingDown className="w-4 h-4" />
            Lost this release
            <Badge variant="secondary" className="font-mono bg-destructive/10 text-destructive border-destructive/20">{lostDomains.length}</Badge>
            <InfoTooltip text="Domains that linked to you in the previous release but dropped off in this one — worth checking whether the link was removed or the page vanished. Source: Common Crawl edge list, diffed monthly." />
          </CardTitle>
        </CardHeader>
        <CardContent>
          <DomainChips domains={lostDomains} tone="lost" />
        </CardContent>
      </Card>

      <p className="md:col-span-2 text-xs text-muted-foreground">
        Compared against previous release <span className="font-mono">{data.previousReleaseName}</span>. Updates automatically with every monthly sync.
      </p>
    </div>
  )
}
