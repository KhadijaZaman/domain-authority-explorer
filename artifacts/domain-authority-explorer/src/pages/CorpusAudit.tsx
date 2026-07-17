import * as React from "react"
import { useLocation, useSearch } from "wouter"
import { useGetCorpusAudit, getGetCorpusAuditQueryKey } from "@workspace/api-client-react"
import { Navbar } from "@/components/Navbar"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Search, AlertCircle, Loader2, FileWarning, Bot, Repeat, TrendingUp, FileText, Layers, GitBranch, History, Map as MapIcon, Globe, Link2 } from "lucide-react"
import { normalizeDomain } from "@/lib/normalizeDomain"
import { InfoTooltip } from "@/components/ui/tooltip"
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RTooltip } from "recharts"

const SEVERITY_STYLE: Record<string, string> = {
  critical: "bg-destructive/10 text-destructive border-destructive/30",
  high: "bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30",
  medium: "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30",
  low: "bg-muted text-muted-foreground border-border",
  info: "bg-primary/5 text-primary border-primary/20",
}

function scoreColor(total: number): string {
  if (total >= 80) return "text-green-600 dark:text-green-400"
  if (total >= 60) return "text-yellow-600 dark:text-yellow-400"
  return "text-destructive"
}

function SectionTitle({ icon: Icon, children, tooltip }: { icon: React.ElementType; children: React.ReactNode; tooltip?: string }) {
  return (
    <h2 className="text-lg font-semibold flex items-center gap-2 text-foreground/80 pb-2 border-b border-border/30">
      <Icon className="w-5 h-5 text-primary" />
      {children}
      {tooltip && <InfoTooltip text={tooltip} />}
    </h2>
  )
}

export default function CorpusAudit() {
  const searchParams = new URLSearchParams(useSearch())
  const queryDomain = searchParams.get("d") || ""
  const [, setLocation] = useLocation()
  const [input, setInput] = React.useState(queryDomain)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const d = normalizeDomain(input)
    if (d) setLocation(`/corpus?d=${encodeURIComponent(d)}`)
  }

  const { data, error, isLoading } = useGetCorpusAudit(queryDomain, {
    query: {
      queryKey: getGetCorpusAuditQueryKey(queryDomain),
      enabled: !!queryDomain,
      retry: false,
      refetchInterval: (q) =>
        q.state.data?.building || q.state.data?.enriching ? 4000 : false,
    },
  })

  const a = data?.analysis ?? null

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <Navbar />
      <main className="flex-1 p-6 md:p-10 lg:p-12 w-full max-w-screen-xl mx-auto flex flex-col gap-8">
        <div className="flex flex-col gap-4 border-b border-border/50 pb-8">
          <h1 className="text-3xl font-bold tracking-tight">Corpus Audit</h1>
          <p className="text-muted-foreground max-w-3xl">
            Ahrefs shows you what links to you. Search Console shows you what Google did. This shows
            you what a plain, unauthenticated, JS-blind crawler saw when it visited — which is exactly
            what the crawlers behind AI systems are. CCBot is the only one that publishes its work, so
            we audit that. It doesn't tell you what's in any model; it tells you what a crawler saw.
          </p>
          <form onSubmit={handleSubmit} className="flex gap-2 max-w-xl mt-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="example.com"
                className="pl-9 font-mono"
                aria-label="Domain to audit"
              />
            </div>
            <Button type="submit">Audit</Button>
          </form>
        </div>

        {!queryDomain && (
          <Card className="border-2 border-dashed bg-muted/20">
            <CardContent className="p-10 text-center text-muted-foreground">
              Enter a domain to audit its Common Crawl footprint across the {data?.crawlIds.length ?? 4} most recent crawls.
            </CardContent>
          </Card>
        )}

        {error && (
          <Card className="border-destructive/30">
            <CardContent className="p-6 flex items-center gap-3 text-sm">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0" />
              <span>{(error as any)?.data?.error ?? "Something went wrong — try again in a moment."}</span>
            </CardContent>
          </Card>
        )}

        {queryDomain && !error && (isLoading || (data?.building && !a)) && (
          <Card>
            <CardContent className="p-10 flex flex-col items-center gap-3 text-center">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <p className="font-medium">Pulling Common Crawl's index for <span className="font-mono">{queryDomain}</span>…</p>
              <p className="text-sm text-muted-foreground max-w-md">
                {data ? `${data.progress.fetchedCrawls} of ${data.progress.totalCrawls} crawls fetched.` : "Starting…"}{" "}
                Common Crawl's index server is rate-limited, so each crawl can take a minute or more —
                a first audit often runs several minutes. Results are cached forever, so the next
                audit of this domain is instant.
              </p>
            </CardContent>
          </Card>
        )}

        {a && (
          <>
            {data?.building && (
              <div className="text-sm text-muted-foreground bg-muted/30 border border-border/50 rounded-sm p-3 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin shrink-0 text-primary" />
                Showing partial results — {data.progress.fetchedCrawls} of {data.progress.totalCrawls} crawls
                fetched so far. Trends update automatically as the rest arrive.
              </div>
            )}
            {!data?.building && data?.enriching && (
              <div className="text-sm text-muted-foreground bg-muted/30 border border-border/50 rounded-sm p-3 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin shrink-0 text-primary" />
                Deep checks still running in the background — page headers, sitemap, Wayback history, and
                the robots.txt timeline (that one walks every crawl back to 2013, so it takes a few
                minutes). Sections fill in automatically.
              </div>
            )}

            {/* Health score + severities */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="border-2 border-primary/20 shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    Corpus Health Score
                    <InfoTooltip text="Think of this as a report card (0–100) for how easily crawlers can read your site. 80+ is healthy. ‘Canonical integrity’ counts most because it’s the problem you’d never notice on your own. If the score is low, start with the red findings on the right — they’re sorted by impact." />
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className={`text-6xl font-bold font-mono ${scoreColor(a.healthScore.total)}`}>
                    {a.healthScore.total}<span className="text-2xl text-muted-foreground">/100</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {a.healthScore.components.map((c) => (
                      <div key={c.name} className="flex items-center gap-3 text-sm">
                        <span className="w-40 shrink-0 text-muted-foreground">{c.name}</span>
                        <div className="flex-1 h-2 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-primary" style={{ width: `${c.score * 100}%` }} />
                        </div>
                        <span className="font-mono text-xs w-16 text-right">{Math.round(c.score * c.weight)}/{c.weight}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Latest crawl: <span className="font-mono">{a.crawlId}</span> · {a.totalRecords} records
                    {a.truncated && " (capped at 5,000)"} · {a.presence.cleanPages} clean pages archived · {a.presence.rating}
                  </p>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    Findings
                    <InfoTooltip text="Everything we found, sorted by how much it hurts. Red (critical/high) items are worth acting on; yellow and grey ones are worth knowing about. Each finding says what's wrong and hints at the fix — the sections below give the details." />
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {a.severities.length === 0 && (
                    <p className="text-sm text-muted-foreground">No issues found — a clean corpus footprint.</p>
                  )}
                  {a.severities.map((s, i) => (
                    <div key={i} className={`border rounded-sm p-3 text-sm ${SEVERITY_STYLE[s.level] ?? SEVERITY_STYLE.low}`}>
                      <div className="flex items-center gap-2 font-medium">
                        <Badge variant="outline" className="uppercase text-[10px] tracking-wider">{s.level}</Badge>
                        {s.title}
                      </div>
                      <p className="mt-1 text-xs opacity-90">{s.detail}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </section>

            {/* Canonical presence — the flagship */}
            <section className="flex flex-col gap-4">
              <SectionTitle icon={FileWarning} tooltip="Some of your pages only ever got saved with tracking junk (like ?utm=...) stuck on the end of the address — the clean address was never saved at all. To the archive, your ‘real’ page doesn’t exist. What to do: make sure ads, newsletters, and partner links point at the clean address, or redirect tagged addresses to it.">
                Canonical Presence
              </SectionTitle>
              {a.canonicalMissing.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Every archived path also exists in its clean, parameter-free form. This is the check
                  that most often fails silently — passing it is genuinely good news.
                </p>
              ) : (
                <Card className="border-destructive/30">
                  <CardContent className="p-4">
                    <p className="text-sm mb-3">
                      {a.canonicalMissing.some((c) => c.isHomepage) ? (
                        <strong>Your homepage isn't in Common Crawl — {a.canonicalMissing.find((c) => c.isHomepage)?.variantCount} tagged copies of it are.</strong>
                      ) : (
                        <>These paths exist <strong>only</strong> in parameterized form — no clean version was ever archived:</>
                      )}
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Path</TableHead>
                          <TableHead className="text-right">Tagged copies</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {a.canonicalMissing.map((c) => (
                          <TableRow key={c.path}>
                            <TableCell className="font-mono text-xs break-all">
                              {c.path} {c.isHomepage && <Badge variant="destructive" className="ml-2">homepage</Badge>}
                            </TableCell>
                            <TableCell className="text-right font-mono">{c.variantCount}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>
              )}
            </section>

            {/* Declared canonical vs corpus canonical (WARC inspection) */}
            <section className="flex flex-col gap-4">
              <SectionTitle icon={Link2} tooltip="We opened the actual saved copies of your pages and read the hidden labels inside. A page can correctly say ‘my real address is X’ and X still never gets visited — that means the links pointing at you are the problem, not your page. What to do in that case: fix the links, don’t touch the page.">
                Declared vs. Corpus Canonical
              </SectionTitle>
              {!a.inspection ? (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  {data?.enriching && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {data?.enriching ? "Fetching archived page content…" : "No archived pages were available to inspect."}
                </p>
              ) : (
                <Card className="shadow-sm">
                  <CardContent className="p-4 flex flex-col gap-3">
                    {a.inspection.headerNoindex.length > 0 && (
                      <div className="border rounded-sm p-3 text-sm bg-destructive/10 text-destructive border-destructive/30">
                        <p className="font-medium">Header noindex found — invisible in view-source:</p>
                        {a.inspection.headerNoindex.map((h) => (
                          <p key={h.url} className="text-xs mt-1 font-mono break-all">{h.url} — X-Robots-Tag: {h.xRobotsTag}</p>
                        ))}
                      </div>
                    )}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Page</TableHead>
                          <TableHead>Canonical declared</TableHead>
                          <TableHead>Verdict</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {a.inspection.canonicalTable.map((c) => (
                          <TableRow key={c.url}>
                            <TableCell className="font-mono text-xs break-all max-w-[220px]">{c.url.replace(/^https?:\/\/[^/]+/, "") || "/"}</TableCell>
                            <TableCell className="font-mono text-xs break-all max-w-[220px]">
                              {c.declared ? c.declared.replace(/^https?:\/\/[^/]+/, "") || "/" : <span className="text-destructive">none</span>}
                              {c.declaredVia === "header" && <Badge variant="outline" className="ml-1">via header</Badge>}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[300px]">{c.verdict}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <p className="text-xs text-muted-foreground">
                      {a.inspection.pagesInspected} archived responses inspected byte-for-byte from crawl{" "}
                      <span className="font-mono">{a.inspection.crawlId}</span>.
                    </p>
                  </CardContent>
                </Card>
              )}
            </section>

            {/* Status + efficiency + duplication */}
            <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    Where the Crawl Budget Went
                    <InfoTooltip text="Crawlers only spend limited time on your site. Every visit that hits a redirect or an error page is time not spent saving a real page. What to do: fix or remove links that lead to errors and redirects so more of the crawler’s visits land on real content." />
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={a.statusDistribution} layout="vertical" margin={{ left: 10, right: 30 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="hsl(var(--border))" />
                        <XAxis type="number" tick={{ fontSize: 11 }} />
                        <YAxis type="category" dataKey="status" width={40} tick={{ fontSize: 12, fontFamily: "monospace" }} />
                        <RTooltip cursor={{ fill: "hsl(var(--muted))" }} />
                        <Bar dataKey="count" fill="hsl(var(--primary))" radius={[0, 3, 3, 0]} label={{ position: "right", fontSize: 11 }} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    Crawl efficiency: <span className={`font-mono font-semibold ${a.crawlEfficiency < 0.5 ? "text-destructive" : "text-foreground"}`}>{Math.round(a.crawlEfficiency * 100)}%</span> of
                    fetches produced a clean, archived page.
                  </p>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    Parameter Pollution
                    <InfoTooltip text="Addresses with ?tracking=... on the end look like separate pages to a crawler, so one page can get saved 9 times over. That wastes the crawler’s attention and splits your page’s identity into fragments. What to do: use clean addresses in your ads and links, and redirect tagged ones to the clean version." />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {a.duplication.topPaths.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No path has more than one URL variant. Duplication factor {a.duplication.factor} — clean.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Path</TableHead>
                          <TableHead className="text-right">URLs</TableHead>
                          <TableHead className="text-right">Distinct hashes</TableHead>
                          <TableHead className="text-right">Clean copy?</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {a.duplication.topPaths.slice(0, 8).map((p) => (
                          <TableRow key={p.path}>
                            <TableCell className="font-mono text-xs break-all max-w-[240px]">{p.path.replace(/^https?:\/\/[^/]+/, "") || "/"}</TableCell>
                            <TableCell className={`text-right font-mono ${p.variants > 5 ? "text-destructive font-semibold" : ""}`}>{p.variants}</TableCell>
                            <TableCell className="text-right font-mono">{p.distinctDigests}</TableCell>
                            <TableCell className="text-right">{p.cleanExists ? "yes" : <span className="text-destructive font-medium">no</span>}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                  {a.brokenParams.length > 0 && (
                    <div className="mt-4 flex flex-col gap-1">
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Broken params — permanent phantom URLs</p>
                      {a.brokenParams.slice(0, 5).map((b, i) => (
                        <p key={i} className="text-xs text-muted-foreground"><span className="font-mono break-all">{b.url}</span> — {b.reason}</p>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            {/* Robots */}
            <section className="flex flex-col gap-4">
              <SectionTitle icon={Bot} tooltip="robots.txt is the note on your front door telling bots what they may read. We check your live file for the AI crawlers (GPTBot, ClaudeBot, PerplexityBot…). Blocking them keeps your site out of the data AI answers are built from — fine if that’s a deliberate choice, costly if it’s an accident.">
                Crawler Access
              </SectionTitle>
              <Card className="shadow-sm">
                <CardContent className="p-4 text-sm flex flex-col gap-2">
                  <p>
                    robots.txt in corpus:{" "}
                    {a.robots.inCorpus
                      ? <span className="font-mono">yes (status {a.robots.status})</span>
                      : <span className="text-muted-foreground">not captured in this crawl</span>}
                  </p>
                  {a.robots.liveChecked ? (
                    a.robots.liveBlockedBots.length === 0 ? (
                      <p className="text-muted-foreground">Live robots.txt blocks none of the known AI crawlers.</p>
                    ) : (
                      <p>
                        Live robots.txt fully blocks:{" "}
                        {a.robots.liveBlockedBots.map((b) => (
                          <Badge key={b} variant="outline" className="mr-1 font-mono">{b}</Badge>
                        ))}
                        <span className="text-muted-foreground"> — blocking these opts the site out of the corpora they feed. Fine if intentional.</span>
                      </p>
                    )
                  ) : (
                    <p className="text-muted-foreground">Live robots.txt check pending — runs after the crawl dumps finish (a few minutes on a first audit)…</p>
                  )}
                </CardContent>
              </Card>
            </section>

            {/* robots.txt history — the standout */}
            <section className="flex flex-col gap-4">
              <SectionTitle icon={History} tooltip="A year-by-year record of that front-door note, going back to 2013. It shows the exact moment your site started or stopped blocking each AI crawler — handy for answering ‘since when have we been invisible to AI?’ If a block below wasn’t intentional, remove it from your robots.txt.">
                robots.txt Time Machine
              </SectionTitle>
              {!a.robotsHistory ? (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  {data?.enriching && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {data?.enriching ? "Walking every crawl back to 2013 — this is the long one…" : "History not built yet."}
                </p>
              ) : (
                <Card className="shadow-sm">
                  <CardContent className="p-4 flex flex-col gap-3 text-sm">
                    {!a.robotsHistory.complete && (
                      <p className="text-muted-foreground flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {a.robotsHistory.crawlsChecked} crawls checked so far — still walking backwards…
                      </p>
                    )}
                    {a.robotsHistory.botEvents.length === 0 ? (
                      <p className="text-muted-foreground">
                        Across {a.robotsHistory.crawlsChecked} crawls, no version of this robots.txt ever fully
                        blocked a known AI crawler.
                      </p>
                    ) : (
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Bot</TableHead>
                            <TableHead>First blocked</TableHead>
                            <TableHead>Today</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {a.robotsHistory.botEvents.map((e) => (
                            <TableRow key={e.bot}>
                              <TableCell className="font-mono text-xs">{e.bot}</TableCell>
                              <TableCell className="font-mono text-xs">{e.firstBlockedCrawl.replace("CC-MAIN-", "")}</TableCell>
                              <TableCell className="text-xs">{e.stillBlocked ? <Badge variant="destructive">still blocked</Badge> : <Badge variant="outline">unblocked since</Badge>}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    )}
                    <details className="text-xs">
                      <summary className="cursor-pointer font-medium">Full timeline ({a.robotsHistory.timeline.length} captures)</summary>
                      <div className="mt-2 max-h-72 overflow-y-auto flex flex-col gap-1">
                        {[...a.robotsHistory.timeline].reverse().map((t) => (
                          <div key={t.crawlId} className="flex gap-2 items-baseline">
                            <span className="font-mono text-muted-foreground w-24 shrink-0">{t.crawlId.replace("CC-MAIN-", "")}</span>
                            <span className="font-mono w-10 shrink-0">{t.status}</span>
                            <span className="text-muted-foreground break-all">
                              {t.blockedBots === null ? "content not fetched" : t.blockedBots.length === 0 ? "no AI bots blocked" : `blocks ${t.blockedBots.join(", ")}`}
                            </span>
                          </div>
                        ))}
                      </div>
                    </details>
                  </CardContent>
                </Card>
              )}
            </section>

            {/* Sitemap × corpus matrix */}
            <section className="flex flex-col gap-4">
              <SectionTitle icon={MapIcon} tooltip="Your sitemap is the list of pages you say exist. The archive shows what a crawler actually found. ‘Declared, never discovered’ is the number to watch: those pages were announced but never reached. What to do: link to them from your homepage or menus — crawlers follow links, not announcements.">
                Sitemap × Corpus
              </SectionTitle>
              {!a.sitemapAudit ? (
                <p className="text-sm text-muted-foreground flex items-center gap-2">
                  {data?.enriching && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  {data?.enriching ? "Fetching the live sitemap — queued behind the crawl dumps, so this can take a few minutes on a first audit…" : "No sitemap found on the live site."}
                </p>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  <Card className="shadow-sm">
                    <CardContent className="p-4 text-sm flex flex-col gap-3">
                      <div className="grid grid-cols-3 gap-3 text-center">
                        <div className="border rounded-sm p-3">
                          <div className="text-2xl font-bold font-mono">{a.sitemapAudit.inBoth}</div>
                          <div className="text-xs text-muted-foreground">declared + discovered</div>
                        </div>
                        <div className={`border rounded-sm p-3 ${a.sitemapAudit.sitemapOnly > 0 ? "border-destructive/40 bg-destructive/5" : ""}`}>
                          <div className="text-2xl font-bold font-mono">{a.sitemapAudit.sitemapOnly}</div>
                          <div className="text-xs text-muted-foreground">declared, never discovered</div>
                        </div>
                        <div className="border rounded-sm p-3">
                          <div className="text-2xl font-bold font-mono">{a.sitemapAudit.corpusOnly}</div>
                          <div className="text-xs text-muted-foreground">discovered, not declared</div>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {a.sitemapAudit.sitemapUrls} URLs read from <span className="font-mono break-all">{a.sitemapAudit.source}</span>
                        {a.sitemapAudit.truncated && " (capped)"}.
                      </p>
                      {a.sitemapAudit.sitemapOnlyExamples.length > 0 && (
                        <details className="text-xs">
                          <summary className="cursor-pointer font-medium">Declared but never discovered ({a.sitemapAudit.sitemapOnly})</summary>
                          <div className="mt-1 flex flex-col gap-0.5">
                            {a.sitemapAudit.sitemapOnlyExamples.map((u) => <span key={u} className="font-mono break-all text-muted-foreground">{u}</span>)}
                          </div>
                        </details>
                      )}
                    </CardContent>
                  </Card>
                  <Card className="shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-sm flex items-center gap-1">
                        lastmod Lie Detector
                        <InfoTooltip text="Your sitemap claims dates when each page last changed. If we can prove a page did NOT change when the sitemap says it did, crawlers learn to distrust your dates and may revisit you less. What to do: only update the date when the content genuinely changes — not on every site rebuild." />
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="text-sm">
                      {a.sitemapAudit.lastmodLies.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No contradictions found — where the sitemap claims a change, we can't prove otherwise.</p>
                      ) : (
                        <div className="flex flex-col gap-1">
                          {a.sitemapAudit.lastmodLies.map((l) => (
                            <p key={l.url} className="text-xs">
                              <span className="font-mono break-all">{l.url.replace(/^https?:\/\/[^/]+/, "")}</span>{" "}
                              <span className="text-muted-foreground">claims {l.lastmod} — identical across {l.crawlsUnchanged} captures spanning it</span>
                            </p>
                          ))}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>
              )}
            </section>

            {/* Redirects + 404s */}
            {(a.redirects.length > 0 || a.notFound.length > 0) && (
              <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {a.redirects.length > 0 && (
                  <Card className="shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        Redirect Inventory ({a.redirects.length})
                        <InfoTooltip text="Every redirect here means someone, somewhere still links to an old address. Each one is a small detour for visitors and crawlers. What to do: update your own internal links to point straight at the final address; for outside links you can’t change, the redirect is doing its job." />
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2 max-h-80 overflow-y-auto">
                      {a.redirects.map((r, i) => (
                        <div key={i} className="text-xs border-b border-border/30 pb-2">
                          <Badge variant="outline" className="mr-2 font-mono">{r.status}</Badge>
                          <Badge variant="secondary" className="mr-2">{r.kind}</Badge>
                          <span className="font-mono break-all">{r.url.replace(/^https?:\/\/[^/]+/, "")}</span>
                          <span className="text-muted-foreground"> → </span>
                          <span className="font-mono break-all text-muted-foreground">{r.target.replace(/^https?:\/\/[^/]+/, "") || r.target}</span>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
                {a.notFound.length > 0 && (
                  <Card className="shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        404 Inventory ({a.notFound.length})
                        <InfoTooltip text="These dead-end pages are still being linked to from somewhere — every visit to them is wasted. What to do: bring the page back, or redirect the old address to the closest live page so the visit isn’t lost." />
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-2 max-h-80 overflow-y-auto">
                      {a.notFound.map((n, i) => (
                        <div key={i} className="text-xs border-b border-border/30 pb-2">
                          <span className="font-mono break-all">{n.url.replace(/^https?:\/\/[^/]+/, "")}</span>
                          <p className="text-muted-foreground mt-0.5">{n.diagnosis}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </section>
            )}

            {/* Depth wall + crawl traps + dup family */}
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    The Depth Wall
                    <InfoTooltip text="How deep into your site the crawler goes before giving up — ‘depth’ is roughly how many slashes are in the address. If pages 3+ levels deep never get saved, they’re invisible to crawlers. What to do: link your important deep pages from the homepage or main menus to pull them up." />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={a.depthCurve} margin={{ left: -20, right: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                        <XAxis dataKey="depth" tick={{ fontSize: 11 }} label={{ value: "path depth", position: "insideBottom", offset: -2, fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <RTooltip cursor={{ fill: "hsl(var(--muted))" }} />
                        <Bar dataKey="seen" name="URLs seen" fill="hsl(var(--muted-foreground))" radius={[3, 3, 0, 0]} />
                        <Bar dataKey="archived" name="Archived" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    Crawl Traps
                    <InfoTooltip text="A filter, search box, or calendar can generate endless address variations (?page=1, 2, 3…) that trap a crawler in busywork. ‘Trap’ means we found a suspiciously high number of variations. What to do: block that parameter in robots.txt or stop linking to the variations." />
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {a.paramCardinality.length === 0 ? (
                    <p className="text-xs text-muted-foreground">No query parameters in the corpus at all.</p>
                  ) : (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Param</TableHead>
                          <TableHead className="text-right">Distinct values</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {a.paramCardinality.slice(0, 8).map((p) => (
                          <TableRow key={p.key}>
                            <TableCell className="font-mono text-xs break-all">?{p.key}= {p.trap && <Badge variant="destructive" className="ml-1">trap</Badge>}</TableCell>
                            <TableCell className={`text-right font-mono ${p.trap ? "text-destructive font-semibold" : ""}`}>{p.distinctValues}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    Duplication Beyond Params
                    <InfoTooltip text="The same page saved twice under slightly different addresses — http vs https, www vs no-www, with or without a trailing slash. Each duplicate splits your page’s reputation in half. What to do: pick one format and redirect the rest — it’s usually a single server setting, a quick job for whoever manages your hosting." />
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm flex flex-col gap-2">
                  {[
                    { label: "http + https both archived", n: a.dupFamily.protocolDupes },
                    { label: "www + bare host both archived", n: a.dupFamily.hostDupes },
                    { label: "with + without trailing slash", n: a.dupFamily.slashDupes },
                    { label: "/index.html + / both archived", n: a.dupFamily.indexDupes },
                  ].map((r) => (
                    <div key={r.label} className="flex justify-between text-xs">
                      <span className="text-muted-foreground">{r.label}</span>
                      <span className={`font-mono ${r.n > 0 ? "text-destructive font-semibold" : ""}`}>{r.n}</span>
                    </div>
                  ))}
                  {a.dupFamily.examples.length > 0 && (
                    <details className="text-xs mt-1">
                      <summary className="cursor-pointer font-medium">Examples</summary>
                      <div className="mt-1 flex flex-col gap-1">
                        {a.dupFamily.examples.map((e) => (
                          <div key={e.key} className="text-muted-foreground">
                            {e.forms.map((f) => <span key={f} className="font-mono break-all block">{f}</span>)}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </CardContent>
              </Card>
            </section>

            {/* Redirect chains */}
            {a.redirectChains.length > 0 && (
              <section className="flex flex-col gap-4">
                <SectionTitle icon={GitBranch} tooltip="A link that bounces through several addresses before landing — or loops forever, or dies at an error page. Every extra bounce wastes time, and some visitors and crawlers give up along the way. What to do: point the first address straight at the final one, skipping the middle steps.">
                  Redirect Chains & Loops
                </SectionTitle>
                <Card className="shadow-sm">
                  <CardContent className="p-4 flex flex-col gap-3 max-h-80 overflow-y-auto">
                    {a.redirectChains.map((c, i) => (
                      <div key={i} className="text-xs border-b border-border/30 pb-2">
                        {c.loop && <Badge variant="destructive" className="mr-2">loop</Badge>}
                        {c.endsIn404 && <Badge variant="destructive" className="mr-2">ends in 404</Badge>}
                        <Badge variant="outline" className="mr-2">{c.hops.length - 1} hop{c.hops.length > 2 ? "s" : ""}</Badge>
                        <span className="font-mono break-all">
                          {c.hops.map((h, j) => (
                            <React.Fragment key={j}>
                              {j > 0 && <span className="text-muted-foreground"> → </span>}
                              {h.replace(/^https?:\/\/[^/]+/, "") || h}
                            </React.Fragment>
                          ))}
                        </span>
                        {c.finalStatus && <span className="text-muted-foreground"> ({c.finalStatus})</span>}
                      </div>
                    ))}
                  </CardContent>
                </Card>
              </section>
            )}

            {/* Multi-crawl */}
            <section className="flex flex-col gap-4">
              <SectionTitle icon={TrendingUp} tooltip="How many real pages of yours got saved in each crawl (they happen every few weeks). Rising = healthy. Falling while you’re publishing new content = something is eating the crawler’s attention — check the findings at the top for the culprit.">
                Coverage Trend
              </SectionTitle>
              <Card className="shadow-sm">
                <CardContent className="p-4">
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={a.coverageTrend} margin={{ left: -20, right: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                        <XAxis dataKey="crawlId" tick={{ fontSize: 10, fontFamily: "monospace" }} tickFormatter={(v: string) => v.replace("CC-MAIN-", "")} />
                        <YAxis tick={{ fontSize: 11 }} />
                        <RTooltip cursor={{ fill: "hsl(var(--muted))" }} />
                        <Bar dataKey="cleanPages" name="Clean pages" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </CardContent>
              </Card>
            </section>

            <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Repeat className="w-4 h-4 text-primary" />
                    Recrawl Frequency
                    <InfoTooltip text="How often each page gets re-visited — a free signal of how important the web makes each page look. What to do: compare this list to the pages that matter most to your business. If a money page is missing or low, it needs more links pointing at it, internally and externally." />
                  </CardTitle>
                </CardHeader>
                <CardContent className="max-h-96 overflow-y-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Page</TableHead>
                        <TableHead className="text-right">Crawls seen in</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {a.recrawlTop.map((r) => (
                        <TableRow key={r.url}>
                          <TableCell className="font-mono text-xs break-all max-w-[280px]">{r.url.replace(/^https?:\/\/[^/]+/, "") || "/"}</TableCell>
                          <TableCell className="text-right font-mono">{r.appearances}/{r.totalCrawls}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              <div className="flex flex-col gap-6">
                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-base flex items-center gap-2">
                      <GitBranch className="w-4 h-4 text-primary" />
                      Displacement Check
                      <InfoTooltip text="Checks whether junk addresses (tagged tracking links) are crowding out your real pages between the two newest crawls. If real pages dropped while junk got added, tracking links are stealing the attention your content should be getting." />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-sm flex flex-col gap-2">
                    <p className="text-muted-foreground">{a.displacement.verdict}</p>
                    {a.displacement.droppedContent.length > 0 && (
                      <details className="text-xs">
                        <summary className="cursor-pointer font-medium">Dropped content URLs ({a.displacement.droppedContent.length})</summary>
                        <div className="mt-1 flex flex-col gap-0.5">
                          {a.displacement.droppedContent.map((u) => <span key={u} className="font-mono break-all text-muted-foreground">{u}</span>)}
                        </div>
                      </details>
                    )}
                    {a.displacement.addedParamUrls.length > 0 && (
                      <details className="text-xs">
                        <summary className="cursor-pointer font-medium">New param URLs ({a.displacement.addedParamUrls.length})</summary>
                        <div className="mt-1 flex flex-col gap-0.5">
                          {a.displacement.addedParamUrls.map((u) => <span key={u} className="font-mono break-all text-muted-foreground">{u}</span>)}
                        </div>
                      </details>
                    )}
                  </CardContent>
                </Card>

                {a.decayedUrls.length > 0 && (
                  <Card className="shadow-sm">
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Layers className="w-4 h-4 text-primary" />
                        Decayed Pages
                        <InfoTooltip text="Pages the crawler used to save but has recently stopped visiting. If one of these still matters to you, treat it as an early warning: link to it more prominently before it fades out entirely." />
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="max-h-60 overflow-y-auto flex flex-col gap-1">
                      {a.decayedUrls.map((u) => (
                        <span key={u} className="font-mono text-xs break-all text-muted-foreground">{u}</span>
                      ))}
                    </CardContent>
                  </Card>
                )}
              </div>
            </section>

            {/* Inception + languages + mime */}
            <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Globe className="w-4 h-4 text-primary" />
                    Web Inception Date
                    <InfoTooltip text="The first time the wider web ever took a snapshot of this domain, from the Internet Archive (records back to 1996). Older domains tend to carry more trust. Nothing to fix here — it’s useful context, and a fun fact." />
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm flex flex-col gap-2">
                  {!a.inception.waybackReachable ? (
                    <p className="text-xs text-muted-foreground flex items-center gap-2">
                      {data?.enriching && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {data?.enriching ? "Asking the Wayback Machine…" : "Wayback Machine unreachable — will retry on the next audit."}
                    </p>
                  ) : (
                    <>
                      <p>
                        First capture:{" "}
                        {a.inception.waybackFirstCapture ? (
                          <span className="font-mono font-semibold">
                            {a.inception.waybackFirstCapture.slice(0, 4)}-{a.inception.waybackFirstCapture.slice(4, 6)}-{a.inception.waybackFirstCapture.slice(6, 8)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">never captured</span>
                        )}
                      </p>
                      {a.inception.waybackYearsActive.length > 0 && (
                        <p className="text-xs text-muted-foreground">
                          Active in the archive across {a.inception.waybackYearsActive.length} year{a.inception.waybackYearsActive.length !== 1 && "s"}:{" "}
                          <span className="font-mono">{a.inception.waybackYearsActive[0]}–{a.inception.waybackYearsActive[a.inception.waybackYearsActive.length - 1]}</span>
                        </p>
                      )}
                      {a.inception.firstAuditCrawl && (
                        <p className="text-xs text-muted-foreground">
                          Oldest audited CC crawl with captures: <span className="font-mono">{a.inception.firstAuditCrawl.replace("CC-MAIN-", "")}</span>
                        </p>
                      )}
                    </>
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    Language Detection
                    <InfoTooltip text="The crawler guesses each page’s language from its actual text. If your /de/ page reads as English, the translation is probably too thin — menus and boilerplate outweigh the translated content. What to do: add more real translated text to those pages." />
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm flex flex-col gap-2">
                  <div className="flex flex-wrap gap-1">
                    {a.languages.breakdown.map((l) => (
                      <Badge key={l.language} variant="outline" className="font-mono">{l.language} · {l.count}</Badge>
                    ))}
                    {a.languages.breakdown.length === 0 && <p className="text-xs text-muted-foreground">No language data in this crawl.</p>}
                  </div>
                  {a.languages.localeMismatches.length > 0 && (
                    <div className="flex flex-col gap-1 mt-1">
                      <p className="text-xs font-medium text-destructive">Locale paths detected as the wrong language:</p>
                      {a.languages.localeMismatches.map((m) => (
                        <p key={m.url} className="text-xs text-muted-foreground">
                          <span className="font-mono break-all">{m.url.replace(/^https?:\/\/[^/]+/, "")}</span> — /{m.localeInPath}/ but detected <span className="font-mono">{m.detected}</span>
                        </p>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    Content-Type Mismatches
                    <InfoTooltip text="Your server puts a label on every file (‘this is a web page’, ‘this is an image’). A mismatch means the label is wrong — harmless-looking, but it can make crawlers mishandle the file. What to do: it’s usually a one-line server setting; ask whoever manages your hosting." />
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-sm">
                  {a.mimeMismatches.count === 0 ? (
                    <p className="text-xs text-muted-foreground">None — declared and detected types agree everywhere.</p>
                  ) : (
                    <div className="flex flex-col gap-1">
                      <p className="text-xs text-muted-foreground">{a.mimeMismatches.count} mismatched responses. Examples:</p>
                      {a.mimeMismatches.examples.slice(0, 6).map((m) => (
                        <p key={m.url} className="text-xs">
                          <span className="font-mono break-all">{m.url.replace(/^https?:\/\/[^/]+/, "")}</span>{" "}
                          <span className="text-muted-foreground">declared <span className="font-mono">{m.declared}</span>, detected <span className="font-mono">{m.detected}</span></span>
                        </p>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            {/* Odds and ends */}
            <section className="flex flex-col gap-4">
              <SectionTitle icon={FileText}>Also in the Corpus</SectionTitle>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 text-sm">
                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-1">
                      Subdomains captured
                      <InfoTooltip text="Other addresses under your domain (like blog.yoursite.com) that the crawler found. Check for surprises — a staging or test site showing up here is publicly visible and should probably be locked down." />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-1">
                    {a.subdomains.map((s) => (
                      <div key={s.host} className="flex justify-between text-xs">
                        <span className="font-mono break-all">{s.host}</span>
                        <span className="font-mono text-muted-foreground">{s.count}</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-1">
                      Empty-shell pages
                      <InfoTooltip text="The crawler got the wrapping but no words: pages built entirely with JavaScript look empty to simple crawlers, so they contributed nothing to any AI training data. What to do: ask your developer about server-side rendering, which delivers the text ready-made." />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-1">
                    {a.jsBlindPages.length === 0 && <p className="text-xs text-muted-foreground">None — every archived page yielded extractable text.</p>}
                    {a.jsBlindPages.map((p) => (
                      <div key={p.url} className="flex justify-between text-xs gap-2">
                        <span className="font-mono break-all">{p.url.replace(/^https?:\/\/[^/]+/, "")}</span>
                        <span className="font-mono text-muted-foreground shrink-0">{(p.length / 1024).toFixed(1)} KB</span>
                      </div>
                    ))}
                  </CardContent>
                </Card>
                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle className="text-sm flex items-center gap-1">
                      Public PDFs
                      <InfoTooltip text="These PDFs are open to anyone — including every crawler. Great if you want them found and cited; bad if they were supposed to sit behind a sign-up form. Make it a deliberate decision either way." />
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="flex flex-col gap-1">
                    {a.publicPdfs.length === 0 && <p className="text-xs text-muted-foreground">None captured.</p>}
                    {a.publicPdfs.map((u) => (
                      <span key={u} className="font-mono text-xs break-all">{u.replace(/^https?:\/\/[^/]+/, "")}</span>
                    ))}
                  </CardContent>
                </Card>
              </div>
            </section>

            <p className="text-xs text-muted-foreground border-t border-border/30 pt-4 max-w-3xl">
              Limits, out loud: this is not a training-data checker — you cannot know which crawl any
              model used, and ~90% of raw Common Crawl is filtered out downstream. CC is a sample:
              robots-blocked, login-walled, and JS-only content is absent. What it is: a public,
              reproducible view of what a crawler saw — and every AI crawler you can't observe arrives
              through the same door.
            </p>
          </>
        )}

        {queryDomain && !error && !isLoading && data && !data.building && !a && (
          <Card className="border-2 border-dashed bg-muted/20">
            <CardContent className="p-10 text-center text-muted-foreground">
              No Common Crawl captures found for <span className="font-mono">{queryDomain}</span> in the
              last {data.crawlIds.length} crawls. Either the domain isn't being discovered (link profile)
              or it blocks CCBot — check the robots.txt on the site.
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  )
}
