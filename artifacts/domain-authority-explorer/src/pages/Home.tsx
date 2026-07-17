import * as React from "react"
import { useSearch, Link } from "wouter"
import { Navbar } from "@/components/Navbar"
import { Sidebar } from "@/components/Sidebar"
import { SearchBox } from "@/components/SearchBox"
import { DomainResult } from "@/components/DomainResult"
import { useGetStatus } from "@workspace/api-client-react"
import { Activity, ArrowRightLeft, Search, Trophy } from "lucide-react"
import { normalizeDomain } from "@/lib/normalizeDomain"

export default function Home() {
  // useSearch subscribes to query-string changes; reading
  // window.location.search directly never re-renders after navigation.
  const search = useSearch()
  const queryDomain = normalizeDomain(new URLSearchParams(search).get("d") || "")
  
  const { data: status } = useGetStatus()

  // Clean layout when no domain is searched
  const isCleanLayout = !queryDomain

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-primary/20">
      <Navbar />
      
      <main className="flex-1 flex flex-col items-center p-6 md:p-10 lg:p-12 w-full max-w-screen-2xl mx-auto">
        {!status?.ready ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center max-w-md mx-auto animate-pulse">
            <Activity className="w-12 h-12 text-primary mb-6" />
            <h2 className="text-2xl font-bold mb-2">Warming up the Web Graph</h2>
            <p className="text-muted-foreground">
              The dataset is currently loading into memory. This can take a minute on fresh starts.
            </p>
          </div>
        ) : (
          <div className={`w-full flex flex-col ${isCleanLayout ? 'flex-1 items-center justify-center' : 'items-start'} gap-12`}>
            
            {/* Search Section */}
            <div className={`w-full flex flex-col ${isCleanLayout ? 'items-center text-center max-w-3xl' : 'items-start max-w-2xl'} transition-all duration-500`}>
              {isCleanLayout && (
                <>
                  <h1 className="text-4xl md:text-6xl font-bold tracking-tight mb-6 bg-gradient-to-br from-foreground to-foreground/70 bg-clip-text text-transparent">
                    The open web's honest read.
                  </h1>
                  <p className="text-lg text-muted-foreground mb-10 max-w-2xl">
                    Instant domain authority and backlink-graph checking powered by Common Crawl's public datasets. No paywalls, no SEO snake oil.
                  </p>
                </>
              )}
              
              <div className="w-full">
                <SearchBox initialValue={queryDomain} />
              </div>

              {isCleanLayout && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 w-full mt-10">
                  <Link href="/compare" className="flex flex-col gap-2 p-4 rounded-xl border border-border/50 bg-card hover:bg-muted/50 hover:border-border transition-colors text-left group">
                    <span className="font-semibold flex items-center gap-2 text-foreground group-hover:text-primary transition-colors"><ArrowRightLeft className="w-4 h-4"/> Compare competitors</span>
                    <span className="text-xs text-muted-foreground leading-relaxed">Rank domains side by side to see who leads.</span>
                  </Link>
                  <Link href="/gap" className="flex flex-col gap-2 p-4 rounded-xl border border-border/50 bg-card hover:bg-muted/50 hover:border-border transition-colors text-left group">
                    <span className="font-semibold flex items-center gap-2 text-foreground group-hover:text-primary transition-colors"><Search className="w-4 h-4"/> Find link opportunities</span>
                    <span className="text-xs text-muted-foreground leading-relaxed">Discover sites linking to them, but not you.</span>
                  </Link>
                  <Link href="/leaderboard" className="flex flex-col gap-2 p-4 rounded-xl border border-border/50 bg-card hover:bg-muted/50 hover:border-border transition-colors text-left group">
                    <span className="font-semibold flex items-center gap-2 text-foreground group-hover:text-primary transition-colors"><Trophy className="w-4 h-4"/> Browse Top 1000</span>
                    <span className="text-xs text-muted-foreground leading-relaxed">See the most authoritative sites on the open web.</span>
                  </Link>
                </div>
              )}
            </div>

            {/* Results & Layout */}
            {!isCleanLayout && (
              <div className="w-full flex flex-col lg:flex-row gap-10">
                <div className="flex-1 min-w-0">
                  <DomainResult domain={queryDomain} />
                </div>
                <Sidebar />
              </div>
            )}
            
            {/* Show sidebar below hero in clean layout */}
            {isCleanLayout && (
              <div className="w-full max-w-5xl mt-8 grid grid-cols-1 md:grid-cols-2 gap-8 opacity-70 hover:opacity-100 transition-opacity">
                <div className="w-full border-t border-border/50 pt-8">
                  <Sidebar />
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  )
}
