import * as React from "react"
import { keepPreviousData } from "@tanstack/react-query"
import { useGetReferringDomains, getGetReferringDomainsQueryKey } from "@workspace/api-client-react"
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Cell, Tooltip as RechartsTooltip } from "recharts"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { AlertCircle, ShieldAlert, Sparkles, ExternalLink, X } from "lucide-react"
import { InfoTooltip } from "@/components/ui/tooltip"

// A simple radial graph for top referrers
function RadialReferrersGraph({ centerDomain, entries }: { centerDomain: string, entries: any[] }) {
  if (entries.length === 0) return null

  const size = 340
  const center = size / 2
  const maxNodes = Math.min(16, entries.length)
  const nodes = entries.slice(0, maxNodes)
  const nodeRadius = center - 60 // distance from center, leaves room for labels

  return (
    <div className="flex justify-center items-center py-6 px-16 border-b border-border/50 bg-background/50 overflow-x-auto relative">
      <div className="absolute top-4 right-4">
        <InfoTooltip text="Top referring domains by authority. Node size = authority; teal = strong (≥60)." />
      </div>
      <svg width={size} height={size} className="overflow-visible shrink-0">
        {/* Draw lines first so they are under nodes */}
        {nodes.map((node, i) => {
          const angle = (i / maxNodes) * 2 * Math.PI
          const radius = nodeRadius
          const x = center + radius * Math.cos(angle)
          const y = center + radius * Math.sin(angle)
          
          return (
            <line 
              key={`line-${i}`} 
              x1={center} y1={center} x2={x} y2={y} 
              stroke="currentColor" 
              strokeWidth="1" 
              className="text-border opacity-50" 
            />
          )
        })}

        {/* Center Node */}
        <circle cx={center} cy={center} r={32} className="fill-primary" />
        <text x={center} y={center} textAnchor="middle" dominantBaseline="middle" className="fill-primary-foreground font-mono text-[10px] font-bold" dy={4}>
          {centerDomain.substring(0, 10)}{centerDomain.length > 10 ? '…' : ''}
        </text>

        {/* Outer Nodes */}
        {nodes.map((node, i) => {
          const angle = (i / maxNodes) * 2 * Math.PI
          const x = center + nodeRadius * Math.cos(angle)
          const y = center + nodeRadius * Math.sin(angle)

          // Size based on authority
          const r = node.authorityScore ? Math.max(12, Math.min(24, node.authorityScore / 3)) : 14
          const isStrong = node.authorityScore && node.authorityScore >= 60

          // Always-visible label, placed radially outside the node so labels
          // don't collide; anchor flips with the side of the circle.
          const cos = Math.cos(angle)
          const sin = Math.sin(angle)
          const lx = x + (r + 6) * cos
          const ly = y + (r + 6) * sin
          const anchor = cos > 0.35 ? "start" : cos < -0.35 ? "end" : "middle"
          const label =
            node.domain.length > 18 ? node.domain.slice(0, 17) + "…" : node.domain

          return (
            <g key={`node-${i}`} className="group cursor-pointer">
              <circle 
                cx={x} cy={y} r={r} 
                className={isStrong ? "fill-chart-2" : (node.authorityScore ? "fill-muted-foreground" : "fill-muted")} 
              />
              <text
                x={lx}
                y={ly + (Math.abs(cos) <= 0.35 ? (sin > 0 ? 10 : -4) : 3)}
                textAnchor={anchor}
                className="fill-foreground font-mono text-[9px]"
              >
                {label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

function StrengthBar({ buckets }: { buckets: any }) {
  if (!buckets) return null
  const total = (buckets.strong || 0) + (buckets.medium || 0) + (buckets.weak || 0) + (buckets.unknown || 0)
  if (total === 0) return null

  const getPct = (val: number) => `${((val / total) * 100).toFixed(1)}%`

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground uppercase tracking-wider">
        <span className="flex items-center gap-1.5">
          Referrer Strength
          <InfoTooltip text="Referring domains bucketed by their own Authority Score: Strong ≥60, Medium 30–60, Weak <30. A few strong links beat many weak ones." />
        </span>
      </div>
      <div className="h-3 w-full flex rounded-sm overflow-hidden bg-muted">
        {buckets.strong > 0 && <div style={{ width: getPct(buckets.strong) }} className="bg-chart-2" title={`Strong: ${buckets.strong}`} />}
        {buckets.medium > 0 && <div style={{ width: getPct(buckets.medium) }} className="bg-chart-4" title={`Medium: ${buckets.medium}`} />}
        {buckets.weak > 0 && <div style={{ width: getPct(buckets.weak) }} className="bg-muted-foreground" title={`Weak: ${buckets.weak}`} />}
      </div>
      <div className="flex items-center gap-4 text-xs font-mono mt-1 text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-chart-2"></span>Strong (≥60): {buckets.strong}</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-chart-4"></span>Medium: {buckets.medium}</span>
        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-muted-foreground"></span>Weak: {buckets.weak}</span>
      </div>
    </div>
  )
}

// Horizontal bar chart of the TLD breakdown; bars are clickable filters.
function TldBarChart({
  breakdown,
  active,
  onSelect,
}: {
  breakdown: { tld: string; count: number }[]
  active: string | null
  onSelect: (tld: string) => void
}) {
  if (breakdown.length === 0) return null
  return (
    <div className="w-full" style={{ height: Math.max(120, breakdown.length * 26) }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={breakdown} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="tld"
            width={72}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 11, fontFamily: "var(--font-mono, monospace)" }}
          />
          <RechartsTooltip
            cursor={{ fill: "hsl(var(--muted) / 0.4)" }}
            formatter={(value: number) => [new Intl.NumberFormat().format(value), "referrers"]}
            labelFormatter={(label: string) => `.${label}`}
            contentStyle={{
              background: "hsl(var(--background))",
              border: "1px solid hsl(var(--border))",
              borderRadius: 4,
              fontSize: 12,
              fontFamily: "var(--font-mono, monospace)",
            }}
          />
          <Bar
            dataKey="count"
            radius={[0, 3, 3, 0]}
            className="cursor-pointer"
            onClick={(entry: any) => entry?.tld && onSelect(entry.tld)}
            label={{
              position: "right",
              fontSize: 10,
              fontFamily: "var(--font-mono, monospace)",
              fill: "hsl(var(--muted-foreground))",
              formatter: (v: number) => new Intl.NumberFormat().format(v),
            }}
          >
            {breakdown.map((t) => (
              <Cell
                key={t.tld}
                fill={
                  active === null || active === t.tld
                    ? "hsl(var(--primary))"
                    : "hsl(var(--muted-foreground) / 0.25)"
                }
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function ReferringDomains({ domain }: { domain: string }) {
  const [tldFilter, setTldFilter] = React.useState<string | null>(null)
  const params = tldFilter ? { tld: tldFilter } : undefined
  const { data, isLoading, isFetching } = useGetReferringDomains(domain, params, {
    query: {
      queryKey: getGetReferringDomainsQueryKey(domain, params),
      enabled: !!domain,
      retry: false,
      placeholderData: keepPreviousData
    }
  })

  // Reset the TLD filter when looking up a new domain
  React.useEffect(() => {
    setTldFilter(null)
  }, [domain])

  if (isLoading) {
    return <Card className="border-border"><Skeleton className="w-full h-64" /></Card>
  }

  if (!data) return null

  // Filtering happens on the server: when a TLD is selected, the API returns
  // the top referrers with that TLD from the full dataset (not just this page).
  const filteredEntries = data.entries

  if (!data.available) {
    return (
      <Card className="border-border bg-muted/10">
        <CardContent className="p-8 flex flex-col items-center justify-center text-center">
          <AlertCircle className="w-10 h-10 text-muted-foreground/50 mb-4" />
          <p className="text-muted-foreground max-w-md">
            {data.message || "Referring domains data is not yet available for this release."}
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="border-border overflow-hidden">
      <CardHeader className="bg-muted/20 border-b border-border/50 pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            Referring Domains
            <InfoTooltip text="Distinct referring domains — each linking domain counts once no matter how many links it sends. Source: Common Crawl edge list. When coverage is below 100%, this is a lower bound from a sample, not the full count.">
              <Badge tabIndex={0} variant="secondary" className="font-mono ml-2 bg-background border-border cursor-help">
                {data.coveragePercent !== null && data.coveragePercent < 100 ? '\u2265 ' : ''}
                {new Intl.NumberFormat().format(data.referringCount)}
                {data.coveragePercent !== null && data.coveragePercent < 100 ? ' found so far' : ' total'}
              </Badge>
            </InfoTooltip>
          </CardTitle>
        </div>
        {data.coveragePercent !== null && data.coveragePercent < 100 && (
          <div className="mt-3 flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong>Sampled data — {data.coveragePercent.toFixed(1)}% of this release's link graph scanned.</strong>{" "}
              Every number below (counts, strength buckets, TLD mix) is a lower bound from that sample, not
              the complete picture. Treat these as directional, especially for competitive comparisons.
              {data.message ? ` ${data.message}` : ""}
            </span>
          </div>
        )}
      </CardHeader>
      
      {/* Visualizations Section */}
      {data.entries.length > 0 && (
        <>
          <RadialReferrersGraph centerDomain={domain} entries={data.entries} />
          
          <div className="p-6 border-b border-border/50 grid grid-cols-1 md:grid-cols-2 gap-8">
            <StrengthBar buckets={data.strengthBuckets} />
            
            {data.tldBreakdown && data.tldBreakdown.length > 0 && (
              <div className="flex flex-col gap-3">
                <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                  Top TLDs
                  <InfoTooltip text="Link-profile composition by top-level domain. A natural profile is diverse; heavy concentration in one cheap TLD can be a spam signal. Click a TLD to filter the referrers table below." />
                </span>
                <TldBarChart
                  breakdown={data.tldBreakdown}
                  active={tldFilter}
                  onSelect={(tld) => setTldFilter(tldFilter === tld ? null : tld)}
                />
                <div className="flex flex-wrap gap-2">
                  {data.tldBreakdown.map((tldObj, i) => {
                    const isActive = tldFilter === tldObj.tld
                    return (
                      <Badge
                        key={i}
                        variant="outline"
                        role="button"
                        tabIndex={0}
                        aria-pressed={isActive}
                        onClick={() => setTldFilter(isActive ? null : tldObj.tld)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault()
                            setTldFilter(isActive ? null : tldObj.tld)
                          }
                        }}
                        className={`font-mono text-xs px-2 py-0.5 cursor-pointer select-none transition-colors ${
                          isActive
                            ? "bg-primary text-primary-foreground border-primary hover:bg-primary/90"
                            : "text-muted-foreground bg-muted/10 border-border/50 hover:bg-muted/40 hover:text-foreground"
                        }`}
                      >
                        {tldObj.tld} <span className={`ml-1.5 opacity-70 ${isActive ? "" : "text-foreground"}`}>{tldObj.count}</span>
                      </Badge>
                    )
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {tldFilter && (
        <div className="px-6 py-2.5 border-b border-border/50 bg-primary/5 flex items-center gap-2 text-xs font-mono">
          <span className="text-muted-foreground">Showing top referrers ending in</span>
          <span className="text-primary font-semibold">.{tldFilter}</span>
          {isFetching && <span className="text-muted-foreground animate-pulse ml-1">loading…</span>}
          <button
            onClick={() => setTldFilter(null)}
            className="ml-1 inline-flex items-center gap-1 text-muted-foreground hover:text-foreground border border-border/50 rounded-sm px-1.5 py-0.5 transition-colors"
          >
            <X className="w-3 h-3" /> Clear filter
          </button>
        </div>
      )}
      <div className="overflow-x-auto w-full">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent bg-muted/5">
              <TableHead className="w-[300px]">Domain</TableHead>
              <TableHead className="text-right flex items-center justify-end gap-1.5 h-12">
                Auth Score
                <InfoTooltip text="The referrer's own Authority Score — links from strong domains carry more weight." />
              </TableHead>
              <TableHead className="text-right">
                <span className="flex items-center justify-end gap-1.5 whitespace-nowrap">
                  Outbound Degree
                  <InfoTooltip text="How many distinct domains this referrer links out to. Very high = open platform/directory; links there are easier but weaker." />
                </span>
              </TableHead>
              <TableHead>
                <span className="flex items-center gap-1.5">
                  Flags
                  <InfoTooltip text="Heuristic spam signals (low outbound diversity, PBN-style patterns) to help prep a disavow list — not a verdict." />
                </span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredEntries.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                  {tldFilter
                    ? `No referring domains ending in .${tldFilter} were found.`
                    : "No top referrers found in sample."}
                </TableCell>
              </TableRow>
            ) : (
              filteredEntries.map((entry, idx) => (
                <TableRow key={idx} className="group">
                  <TableCell className="font-mono font-medium flex items-center gap-2">
                    <a href={`/?d=${entry.domain}`} className="hover:text-primary transition-colors flex items-center gap-1">
                      {entry.domain} <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />
                    </a>
                    {entry.isNew && (
                      <Badge variant="outline" className="text-[10px] uppercase h-4 px-1 py-0 text-chart-3 border-chart-3/30 bg-chart-3/10">New</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground group-hover:text-foreground transition-colors">
                    {entry.authorityScore !== null ? entry.authorityScore.toFixed(2) : '-'}
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground group-hover:text-foreground transition-colors">
                    {new Intl.NumberFormat().format(entry.outboundDegree)}
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
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </Card>
  )
}
