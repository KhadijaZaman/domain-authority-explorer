import * as React from "react"
import { Navbar } from "@/components/Navbar"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"

export default function Cheatsheet() {
  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <Navbar />
      
      <main className="flex-1 p-6 md:p-10 lg:p-12 w-full max-w-screen-md mx-auto flex flex-col gap-10">
        
        <div className="flex flex-col gap-4 border-b border-border/50 pb-8">
          <h1 className="text-3xl font-bold tracking-tight">SEO Cheatsheet</h1>
          <p className="text-lg text-muted-foreground">
            How to read the web graph and build meaningful authority, based on how the algorithms actually work.
          </p>
        </div>

        <div className="prose prose-slate dark:prose-invert prose-headings:font-bold prose-headings:tracking-tight max-w-none flex flex-col gap-12">
          
          <section>
            <h2 className="text-xl flex items-center gap-2 mb-4">
              <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-mono">01</span>
              Authority vs Popularity
            </h2>
            <Card className="bg-muted/10 border-border/50">
              <CardContent className="p-6 flex flex-col gap-4">
                <p>
                  <strong>Authority Score</strong> (Harmonic Centrality) rewards being widely and diversely linked across the internet structure. It measures how close you are to <em>everyone else</em>.
                </p>
                <p>
                  <strong>Popularity Score</strong> (PageRank-style) rewards links from a few very powerful sites. A single link from a famous publication like NYT or Wikipedia can beat 50 links from small directories.
                </p>
              </CardContent>
            </Card>
          </section>

          <section>
            <h2 className="text-xl flex items-center gap-2 mb-4">
              <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-mono">02</span>
              Diversity Beats Volume
            </h2>
            <p className="text-muted-foreground">
              Getting 10 links from 10 distinct referring domains is vastly superior to getting 1,000 links from the footer of a single website. The web graph penalizes repetitive clustering.
            </p>
          </section>

          <section>
            <h2 className="text-xl flex items-center gap-2 mb-4">
              <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-mono">03</span>
              Weak vs Strong Referrers
            </h2>
            <p className="text-muted-foreground">
              A few strong referrers (Authority Score ≥ 60) move your needle significantly more than piles of weak ones. However, a healthy organic link profile naturally contains a mix of both. An unnatural profile that only has strong links looks manipulated.
            </p>
          </section>

          <section>
            <h2 className="text-xl flex items-center gap-2 mb-4">
              <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-mono">04</span>
              Platforms are for Profiles, not Outreach
            </h2>
            <p className="text-muted-foreground">
              We flag high-outbound domains (like github.io, medium.com) as <strong>Platforms</strong>. Treat these as places to list yourself or host your own content. Do not waste time doing outreach to get links from them — you can usually just create a profile.
            </p>
          </section>

          <section>
            <h2 className="text-xl flex items-center gap-2 mb-4">
              <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-mono">05</span>
              Avoid Low-Diversity Referrers
            </h2>
            <p className="text-muted-foreground">
              Domains flagged as <strong>Low Diversity</strong> (having ≤ 2 outbound links total) are often Private Blog Networks (PBNs) or very low-quality parked sites. Do not chase links from these sources. They pass little to no value and are prone to being devalued entirely.
            </p>
          </section>

          <section>
            <h2 className="text-xl flex items-center gap-2 mb-4">
              <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-mono">06</span>
              Watch the Flux
            </h2>
            <p className="text-muted-foreground">
              Pay close attention to the "New" and "Lost" referring domains between releases. Dropping a few weak domains doesn't matter, but losing a link from a strong domain can instantly hit your authority score.
            </p>
          </section>

          <section>
            <h2 className="text-xl flex items-center gap-2 mb-4">
              <span className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-sm font-mono">07</span>
              Data Freshness Reality
            </h2>
            <p className="text-muted-foreground">
              This tool is tied to Common Crawl's release cadence (roughly monthly). When you get a new backlink, it takes time for the crawler to find it, include it in a release, and for the global graph to recompute. Patience is required.
            </p>
          </section>

        </div>
      </main>
    </div>
  )
}
