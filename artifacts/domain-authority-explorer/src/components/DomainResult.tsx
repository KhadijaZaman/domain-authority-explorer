import * as React from "react"
import { useGetDomain, useGetDomainHistory, useGetStatus, getGetDomainQueryKey, getGetDomainHistoryQueryKey } from "@workspace/api-client-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Badge } from "@/components/ui/badge"
import { AlertCircle, TrendingUp, Search, Activity, Link as LinkIcon, ArrowUpRight, Tag, ShieldAlert, BellRing, ChevronDown, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid } from "recharts"
import { InfoTooltip } from "@/components/ui/tooltip"
import { normalizeDomain } from "@/lib/normalizeDomain"

import { DomainNiche } from "./DomainNiche"
import { HybridScore } from "./HybridScore"
import { ReferringDomains } from "./ReferringDomains"
import { OutboundDomains } from "./OutboundDomains"
import { NewLostDomains } from "./NewLostDomains"
import { SpamFlags } from "./SpamFlags"
import { TierBadge } from "./TierBadge"

type RangeKey = "3m" | "6m" | "1y" | "all" | "custom"

const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "3m", label: "3M" },
  { key: "6m", label: "6M" },
  { key: "1y", label: "1Y" },
  { key: "all", label: "All" },
  { key: "custom", label: "Custom" },
]

export function DomainResult({ domain }: { domain: string }) {
  const { data: status } = useGetStatus()
  const { data, error, isLoading } = useGetDomain(domain, {
    query: {
      queryKey: getGetDomainQueryKey(domain),
      enabled: !!domain,
      retry: false
    }
  })

  const { data: historyData } = useGetDomainHistory(domain, {
    query: {
      queryKey: getGetDomainHistoryQueryKey(domain),
      enabled: !!domain && !!data,
      // While the server is still scanning past releases for this domain,
      // poll so new points appear as they're found.
      refetchInterval: (q) => (q.state.data?.building ? 5000 : false),
    }
  })
  const history = historyData?.points
  const historyBuilding = historyData?.building ?? false

  const [range, setRange] = React.useState<RangeKey>("all")
  const [customFrom, setCustomFrom] = React.useState("")
  const [customTo, setCustomTo] = React.useState("")

  const filteredHistory = React.useMemo(() => {
    if (!history) return []
    if (range === "all") return history
    if (range === "custom") {
      if (!customFrom && !customTo) return history
      return history.filter((h) => {
        const t = new Date(h.recordedAt).getTime()
        // month inputs are "YYYY-MM"; make the "to" bound inclusive of that month
        const fromOk = !customFrom || t >= new Date(`${customFrom}-01`).getTime()
        let toOk = true
        if (customTo) {
          const [y, m] = customTo.split("-").map(Number)
          toOk = t < new Date(y, m, 1).getTime()
        }
        return fromOk && toOk
      })
    }
    const months = range === "3m" ? 3 : range === "6m" ? 6 : 12
    const latest = history.reduce(
      (max, h) => Math.max(max, new Date(h.recordedAt).getTime()),
      0,
    )
    const cutoff = new Date(latest)
    cutoff.setMonth(cutoff.getMonth() - months)
    // Strict > keeps the window at exactly N months back from the latest
    // point — a release landing exactly on the boundary would otherwise
    // add an extra month bucket (e.g. 4 points shown under "3M").
    return history.filter((h) => new Date(h.recordedAt).getTime() > cutoff.getTime())
  }, [history, range, customFrom, customTo])

  if (isLoading) {
    return (
      <div className="w-full flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card className="h-48 border-2"><Skeleton className="w-full h-full" /></Card>
          <Card className="h-48 border-2"><Skeleton className="w-full h-full" /></Card>
        </div>
        <Card className="h-64 border-2"><Skeleton className="w-full h-full" /></Card>
      </div>
    )
  }

  // Handle 404 cleanly
  if (error && (error as any).status === 404) {
    return (
      <Card className="w-full border-2 border-dashed bg-muted/20">
        <CardContent className="flex flex-col items-center justify-center p-12 text-center">
          <AlertCircle className="w-12 h-12 text-muted-foreground mb-4 opacity-50" />
          <h2 className="text-xl font-bold mb-2">Domain Not Found</h2>
          <p className="text-muted-foreground max-w-md">
            <span className="font-mono text-foreground font-bold">{domain}</span> is not in the top 1M domains of this release — likely a smaller site. It can still appear in a future release.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (!data) return null

  // Format numbers nicely
  const pctAuth = data.authorityScore.toFixed(2)
  const pctPop = data.popularityScore.toFixed(2)
  const rankAuth = new Intl.NumberFormat().format(data.authorityRank)
  const rankPop = new Intl.NumberFormat().format(data.popularityRank)
  const totalDomains = data.totalDomainsInRelease ? new Intl.NumberFormat().format(data.totalDomainsInRelease) : "unknown"

  const getVerdict = () => {
    const score = data.authorityScore
    let tierText = "Low"
    if (score > 80) tierText = "Elite"
    else if (score > 60) tierText = "High"
    else if (score > 40) tierText = "Moderate"
    else if (score > 20) tierText = "Developing"

    // Compare against the ranked top 1M, not all 121M crawled domains —
    // otherwise every ranked domain reads "stronger than 99% of the web",
    // which contradicts a "Developing"/"Low" label.
    const RANKED_SET = 1_000_000
    const betterThan = Math.min(
      99.9,
      Math.max(0, 100 - (data.authorityRank / RANKED_SET) * 100),
    )
    const pct = betterThan >= 99 ? betterThan.toFixed(1) : betterThan.toFixed(0)
    return `${tierText} link-graph centrality — better linked than ${pct}% of the web's top 1M ranked domains`
  }

  // Reserved / placeholder domains (RFC 2606) get referenced constantly in
  // documentation and code samples, which inflates their link-graph
  // centrality. Flag them so the score isn't mistaken for site quality.
  const RESERVED_DOMAINS = new Set([
    "example.com", "example.org", "example.net", "example.edu",
    "iana.org", "localhost",
  ])
  const isReservedDomain =
    RESERVED_DOMAINS.has(data.domain) ||
    /\.(test|invalid|example|localhost)$/.test(data.domain)

  return (
    <div className="w-full flex flex-col gap-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Header Section */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between flex-wrap gap-4 pb-4 border-b border-border/50">
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold font-mono tracking-tight">{data.domain}</h1>
              <TierBadge tier={data.tier} />
            </div>
            <p className="text-muted-foreground text-sm font-medium">{getVerdict()}</p>
            <p className="text-xs text-muted-foreground/70">
              Scores measure position in Common Crawl's link graph — how well-referenced a domain is — not content quality or search rankings.{" "}
              <a href={`${import.meta.env.BASE_URL}methodology`} className="underline hover:text-foreground">See methodology</a>
            </p>
          </div>
          <InfoTooltip text="Common Crawl's official web-graph release ID. Web-graph releases are named by the months they cover (e.g. cc-main-2026-apr-may-jun) and each combines several monthly crawls — this differs from the CC-MAIN-YYYY-WW names used for individual page-crawl archives. New graph releases ship every 1–3 months; scores update then, not continuously.">
            <Badge tabIndex={0} variant="outline" className="font-mono bg-background cursor-help">
              {data.releaseName}
            </Badge>
          </InfoTooltip>
        </div>

        {normalizeDomain(domain) !== data.domain && (
          <div className="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              You searched <span className="font-mono font-semibold">{normalizeDomain(domain)}</span>,
              but the web graph tracks registrable domains — so everything below is data for the
              parent domain <span className="font-mono font-semibold">{data.domain}</span>, not
              subdomain-specific authority.
            </span>
          </div>
        )}

        {isReservedDomain && (
          <div className="flex items-start gap-2.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              <strong>{data.domain} is a reserved placeholder domain</strong>, not an active site.
              It ranks highly only because documentation, specs, and code samples across the web
              reference it constantly — a reminder that these scores measure link-graph structure,
              not whether a site is a real, authoritative destination.
            </span>
          </div>
        )}
        
        <div className="flex items-center justify-end flex-wrap gap-4">
          {data.subdomainCount !== null ? (
            <InfoTooltip text="Distinct subdomains of this domain that appear in Common Crawl's host-level graph.">
              <div tabIndex={0} className="text-sm text-muted-foreground flex items-center gap-1.5 font-mono bg-muted/30 px-3 py-1 rounded-sm border border-border/50 cursor-help">
                <Search className="w-3.5 h-3.5 opacity-70" />
                {data.subdomainCountComplete === false ? '≥ ' : ''}
                <span className="font-bold text-foreground">{new Intl.NumberFormat().format(data.subdomainCount)}</span>
                <span className="opacity-80">subdomains {data.subdomainCountComplete === false ? '(partial)' : ''}</span>
              </div>
            </InfoTooltip>
          ) : (
            <div className="text-xs text-muted-foreground/60 italic">Subdomains not scanned yet</div>
          )}
        </div>
      </div>

      {/* Core Scores Section */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold flex items-center gap-2 text-foreground/80 pb-2 border-b border-border/30">
          <Activity className="w-5 h-5 text-primary" />
          Core Authority Scores
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Authority Card */}
          <Card className="border-2 border-primary/20 bg-gradient-to-br from-background to-primary/5 relative overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                Authority Score
                <InfoTooltip text="Harmonic centrality from Common Crawl's public web graph (121M domains). Measures how reachable this domain is from everywhere else in the link graph — hard to inflate with link spam. Percentile-scaled 0–100. Source: Common Crawl." />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-6xl font-mono font-bold tracking-tighter text-primary">
                  {pctAuth}
                </span>
                <span className="text-xl font-mono text-primary/50">/100</span>
              </div>
              <p className="text-sm text-muted-foreground mt-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-primary inline-block"></span>
                Ranked <strong className="font-mono text-foreground">#{rankAuth}</strong> out of {totalDomains}
                <InfoTooltip text="Position among all 121M domains in the current release, ranked by this metric." />
              </p>
            </CardContent>
            <div className="absolute -right-12 -bottom-12 opacity-5 pointer-events-none">
              <TrendingUp className="w-64 h-64" />
            </div>
          </Card>

          {/* Popularity Card */}
          <Card className="border-2 border-border relative overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
                Popularity Score
                <InfoTooltip text="PageRank on the same Common Crawl graph — links from heavily-linked domains count more. Reflects raw link popularity rather than centrality. Percentile-scaled 0–100. Source: Common Crawl." />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-6xl font-mono font-bold tracking-tighter text-foreground">
                  {pctPop}
                </span>
                <span className="text-xl font-mono text-muted-foreground">/100</span>
              </div>
              <p className="text-sm text-muted-foreground mt-4 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-muted-foreground inline-block"></span>
                Ranked <strong className="font-mono text-foreground">#{rankPop}</strong> out of {totalDomains}
                <InfoTooltip text="Position among all 121M domains in the current release, ranked by this metric." />
              </p>
            </CardContent>
          </Card>
        </div>
      </section>

      {/* Niche Standing Section */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold flex items-center gap-2 text-foreground/80 pb-2 border-b border-border/30">
          <Tag className="w-5 h-5 text-primary" />
          Niche Standing
        </h2>
        <Card className="border-border shadow-sm">
          <CardContent className="p-6 flex flex-col gap-4">
            <p className="text-sm text-muted-foreground max-w-2xl">
              A domain with modest global authority can still dominate its niche. Tag this domain
              with an industry (e.g. "AI SEO tools") and it is ranked only against other domains
              sharing that tag — a relative standing global DR-style metrics don't give you.
            </p>
            <DomainNiche domain={data.domain} />
          </CardContent>
        </Card>
      </section>

      {/* History Graph Section */}
      {history && history.length > 0 && (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-semibold flex items-center gap-2 text-foreground/80 pb-2 border-b border-border/30">
            <TrendingUp className="w-5 h-5 text-primary" />
            Historical Trend
          </h2>
          <Card className="border-border shadow-sm">
            <CardHeader>
              <div className="flex items-center justify-between flex-wrap gap-3">
                <CardTitle className="text-base flex items-center gap-2">
                  Authority Over Time
                  <InfoTooltip text="One point per Common Crawl release since 2018. Shows whether authority is rising or falling — the graph is republished regularly and we keep every snapshot. Domains only get points for releases where they ranked in the top 1M." />
                </CardTitle>
                <div className="flex items-center gap-1 bg-muted/40 rounded-md p-1">
                  {RANGE_OPTIONS.map((opt) => (
                    <Button
                      key={opt.key}
                      variant={range === opt.key ? "secondary" : "ghost"}
                      size="sm"
                      className="h-7 px-2.5 text-xs font-mono"
                      onClick={() => setRange(opt.key)}
                    >
                      {opt.label}
                    </Button>
                  ))}
                </div>
              </div>
              {range === "custom" && (
                <div className="flex items-center gap-2 mt-3 flex-wrap text-sm">
                  <input
                    type="month"
                    value={customFrom}
                    onChange={(e) => setCustomFrom(e.target.value)}
                    className="h-8 px-2 rounded-md border border-border bg-background font-mono text-xs"
                    aria-label="From month"
                  />
                  <span className="text-muted-foreground text-xs">to</span>
                  <input
                    type="month"
                    value={customTo}
                    onChange={(e) => setCustomTo(e.target.value)}
                    className="h-8 px-2 rounded-md border border-border bg-background font-mono text-xs"
                    aria-label="To month"
                  />
                </div>
              )}
            </CardHeader>
            <CardContent>
              {historyBuilding && (
                <div className="mb-4 text-sm text-muted-foreground bg-muted/30 border border-border/50 rounded-sm p-3 flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin shrink-0 text-primary" />
                  <span>
                    Building history for{" "}
                    <span className="font-mono text-foreground">{data.domain}</span> — we're scanning
                    past Common Crawl releases back to 2018 right now. Each release is a large file
                    scanned one at a time, so a full history can take 15–30 minutes to build. New
                    points appear here automatically as they're found — you can leave and come back.
                  </span>
                </div>
              )}
              {!historyBuilding && history.length === 1 && (
                <div className="mb-4 text-sm text-muted-foreground bg-muted/30 border border-border/50 rounded-sm p-3">
                  <span className="font-mono text-foreground">{data.domain}</span> first entered the
                  top 1M ranked domains in{" "}
                  {new Date(history[0].recordedAt).toLocaleDateString("en-US", { month: "long", year: "numeric" })}.
                  We checked every release back to 2018 — it wasn't ranked in the top 1M before, so
                  there's only one point so far. The trend line grows with each new release.
                </div>
              )}
              {history.length > 1 && range !== "all" && filteredHistory.length < 2 && (
                <div className="mb-4 text-sm text-muted-foreground bg-muted/30 border border-border/50 rounded-sm p-3">
                  Only {filteredHistory.length === 0 ? "no releases" : "one release"} fall{filteredHistory.length === 1 ? "s" : ""} inside
                  this window — Common Crawl publishes a new web graph roughly every 2 months, not
                  monthly, so short ranges can contain very few points. Try a wider range like 1Y or All
                  ({history.length} points total).
                </div>
              )}
              {filteredHistory.length === 0 ? (
                <div className="h-[250px] w-full mt-2 flex items-center justify-center text-sm text-muted-foreground">
                  No data points in this time range — try a wider range.
                </div>
              ) : (
              <div className="h-[250px] w-full mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={filteredHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorAuth" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis 
                      dataKey="recordedAt" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fontFamily: 'var(--font-mono)' }} 
                      dy={10}
                      tickFormatter={(v) =>
                        new Date(v).toLocaleDateString("en-US", { month: "short", year: "2-digit" })
                      }
                    />
                    <YAxis 
                      domain={[0, 100]} 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fontSize: 10, fontFamily: 'var(--font-mono)' }}
                    />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))', 
                        borderColor: 'hsl(var(--border))',
                        fontFamily: 'var(--font-mono)',
                        fontSize: '12px'
                      }}
                      labelStyle={{ color: 'hsl(var(--muted-foreground))', marginBottom: '4px' }}
                      labelFormatter={(v) =>
                        new Date(v).toLocaleDateString("en-US", { month: "long", year: "numeric" })
                      }
                    />
                    <Area 
                      type="monotone" 
                      dataKey="authorityScore" 
                      name="Authority"
                      stroke="hsl(var(--primary))" 
                      strokeWidth={2}
                      fillOpacity={1} 
                      fill="url(#colorAuth)" 
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
              )}
            </CardContent>
          </Card>
        </section>
      )}

      {/* Referring Domains Section */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold flex items-center gap-2 text-foreground/80 pb-2 border-b border-border/30 mt-2">
          <LinkIcon className="w-5 h-5 text-primary" />
          Referring Domains
        </h2>
        <ReferringDomains domain={data.domain} />
      </section>

      {/* New & Lost Referring Domains (monitoring) */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold flex items-center gap-2 text-foreground/80 pb-2 border-b border-border/30 mt-2">
          <BellRing className="w-5 h-5 text-primary" />
          New &amp; Lost Referring Domains
        </h2>
        <NewLostDomains domain={data.domain} />
      </section>

      {/* Spam & Toxicity Flags */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold flex items-center gap-2 text-foreground/80 pb-2 border-b border-border/30 mt-2">
          <ShieldAlert className="w-5 h-5 text-primary" />
          Spam &amp; Toxicity Flags
        </h2>
        <SpamFlags domain={data.domain} />
      </section>

      {/* Outbound Prospecting Section (collapsible) */}
      <section className="flex flex-col gap-4">
        <Collapsible>
          <CollapsibleTrigger className="w-full group">
            <h2 className="text-lg font-semibold flex items-center gap-2 text-foreground/80 pb-2 border-b border-border/30 mt-2 cursor-pointer hover:text-foreground transition-colors">
              <ArrowUpRight className="w-5 h-5 text-primary" />
              Outbound Prospecting
              <ChevronDown className="w-4 h-4 ml-auto text-muted-foreground transition-transform group-data-[state=open]:rotate-180" />
            </h2>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <OutboundDomains domain={data.domain} />
          </CollapsibleContent>
        </Collapsible>
      </section>

      {/* Hybrid Score Section */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-semibold flex items-center gap-2 text-foreground/80 pb-2 border-b border-border/30 mt-2">
          <Activity className="w-5 h-5 text-chart-4" />
          Hybrid Score
          <InfoTooltip text="Blends free Common Crawl structural authority with fresh commercial backlink data from DataForSEO into a single 0–100 score. The only section that depends on the paid provider." />
        </h2>
        <HybridScore domain={data.domain} />
      </section>

      {/* Footnote */}
      <div className="bg-muted/30 p-4 rounded-sm border border-border text-xs text-muted-foreground leading-relaxed mt-4">
        <strong>Data Source:</strong> These metrics are derived directly from the Common Crawl web graph ({data.releaseName}{data.releaseDate ? ` - ${data.releaseDate}` : ''}). 
        <br/><br/>
        <strong>Important:</strong> These are Common Crawl's own harmonic centrality (Authority) and PageRank-style (Popularity) metrics, computed globally across the entire open web graph. They are <strong>NOT</strong> Google's PageRank or any proprietary search engine metric. The data refreshes with each web-graph release (every 1–3 months).
        <br/><br/>
        Full formulas, sampling details, and limitations: <a href={`${import.meta.env.BASE_URL}methodology`} className="underline hover:text-foreground">Methodology</a>.
      </div>
    </div>
  )
}
