import * as React from "react"
import { Navbar } from "@/components/Navbar"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { useGetStatus } from "@workspace/api-client-react"
import { BookOpen, Database, Calculator, PieChart, RefreshCw, AlertTriangle, Shield } from "lucide-react"

function Section({ icon: Icon, title, children }: { icon: React.ElementType; title: string; children: React.ReactNode }) {
  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2.5">
          <Icon className="w-5 h-5 text-primary" />
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground leading-relaxed space-y-3">
        {children}
      </CardContent>
    </Card>
  )
}

export default function Methodology() {
  const { data: status } = useGetStatus()
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="container max-w-4xl px-4 md:px-6 py-10 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <BookOpen className="w-7 h-7 text-primary" />
            Methodology
          </h1>
          <p className="text-muted-foreground">
            Exactly where the numbers come from, how they're computed, and what they can and can't tell you.
          </p>
        </div>

        <Section icon={Database} title="Data source: the Common Crawl web graph">
          <p>
            All authority and popularity scores come from{" "}
            <a href="https://commoncrawl.org/web-graphs" target="_blank" rel="noreferrer" className="underline hover:text-foreground">Common Crawl's public web graphs</a> —
            open datasets built from Common Crawl's page archives. Each web-graph release aggregates several monthly
            crawls and ships a domain-level link graph of roughly <strong>121 million domains</strong>, along with two
            precomputed centrality rankings: <strong>harmonic centrality</strong> (our "Authority") and{" "}
            <strong>PageRank</strong> (our "Popularity"). We ingest those ranking files directly — we do not compute
            or modify the centrality math ourselves.
          </p>
          <p>
            <strong>About release names:</strong> web-graph releases use Common Crawl's official naming, e.g.{" "}
            <code className="font-mono text-foreground">cc-main-2026-apr-may-jun</code> — the months the graph covers.
            This is different from the <code className="font-mono text-foreground">CC-MAIN-YYYY-WW</code> names used
            for individual weekly <em>page-crawl</em> archives. Both naming schemes are Common Crawl's own; a graph
            release just spans several crawls. Current release loaded here:{" "}
            <code className="font-mono text-foreground">{status?.releaseName ?? "…"}</code>.
          </p>
        </Section>

        <Section icon={Calculator} title="Score formula (0–100)">
          <p>
            Raw centrality ranks are converted to a 0–100 score with a <strong>log-rank scale</strong>:
          </p>
          <pre className="bg-muted/40 border border-border rounded-md p-3 font-mono text-xs text-foreground overflow-x-auto">
score = 100 × (1 − ln(rank) / ln(N))     where N = total domains in the release (~121M)</pre>
          <p>
            Rank #1 scores 100; the last-ranked domain scores 0. We use log-rank rather than a linear percentile
            because web centrality is extremely heavy-tailed — on a linear scale, every domain in the top million
            would round to ~100 and the number would be meaningless. This is the same reason commercial "domain
            authority" tools use logarithmic scales. Scores are computed against the <em>full</em> release size,
            so they're exact regardless of how many domains we store.
          </p>
          <p>
            <strong>What the score is:</strong> a measure of how well-referenced a domain is in the open web's link
            graph. <strong>What it is not:</strong> Google PageRank, a search-ranking predictor, a traffic estimate,
            or a content-quality judgment. Reserved placeholder domains like example.com score highly purely because
            documentation across the web references them constantly — the tool flags these explicitly.
          </p>
        </Section>

        <Section icon={PieChart} title="Sampling and coverage">
          <p>
            <strong>Domain ranks:</strong> we store the top 1,000,000 ranked domains per release (the ranks file is
            sorted by harmonic centrality). Domains outside the top 1M show as "not found" even though they exist in
            the full graph.
          </p>
          <p>
            <strong>Referring / outbound domains:</strong> the full edge list is ~13.6 GB compressed, so we scan a
            portion of it per domain and label the result with the exact <strong>coverage percentage</strong> scanned.
            Any count shown with a coverage badge below 100% is a <strong>lower bound from a sample</strong> — the
            true count is at least that large. Strength buckets and TLD breakdowns inherit the same sampling.
          </p>
          <p>
            <strong>Historical trends:</strong> past releases are scanned on demand the first time a domain is looked
            up, so a chart may start with one point and fill in as backfill completes (releases back to Jan 2018 —
            earlier web-graph releases have no domain ranking files).
          </p>
          <p>
            <strong>Hybrid Score:</strong> the only section using a commercial provider (DataForSEO backlink data);
            it blends that with the Common Crawl structural score and is labeled where shown.
          </p>
        </Section>

        <Section icon={RefreshCw} title="Update cadence">
          <p>
            Common Crawl publishes a new web graph every 1–3 months. This app checks for new releases automatically
            (twice daily) and ingests them as soon as they appear — ranks first, then referring-domain edges,
            subdomain counts, and history points for previously looked-up domains. Scores change only when a new
            release lands; new or lost links won't show up between releases.
          </p>
        </Section>

        <Section icon={AlertTriangle} title="Known limitations">
          <ul className="list-disc pl-5 space-y-2">
            <li>Common Crawl doesn't crawl the whole web and skews toward already-well-linked sites — smaller, newer, and JavaScript-heavy sites are underrepresented, which can depress their scores.</li>
            <li>Centrality conflates "widely referenced" with "authoritative" — placeholder and infrastructure domains rank high without being content destinations.</li>
            <li>Referring-domain data is sampled (see coverage badges) — never treat sub-100%-coverage counts as exhaustive in competitive analysis.</li>
            <li>Data lags real time by weeks to months; use it as a directional structural signal, not a live backlink monitor.</li>
          </ul>
        </Section>

        <Section icon={Shield} title="Service notes">
          <p>
            This is a free tool hosted on Replit with no uptime guarantee or SLA. Domains you look up are stored
            (domain name only) to power the history-trend and watchlist features; no personal data is collected.
            External data requests go to Common Crawl's public servers and, for the Hybrid Score only, to DataForSEO.
            If you cite these numbers in client reports, link this page so readers can see the formula and sampling
            caveats.
          </p>
        </Section>
      </main>
    </div>
  )
}
