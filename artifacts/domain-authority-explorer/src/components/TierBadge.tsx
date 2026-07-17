import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { Sparkles, Medal, Award, Star, Shield } from "lucide-react"
import { InfoTooltip } from "@/components/ui/tooltip"

export type Tier = "elite" | "top_1k" | "top_10k" | "top_100k" | "top_1m"

export function computeTier(rank: number | null | undefined): Tier | null {
  if (!rank) return null
  if (rank <= 100) return "elite"
  if (rank <= 1000) return "top_1k"
  if (rank <= 10000) return "top_10k"
  if (rank <= 100000) return "top_100k"
  return "top_1m"
}

export function TierBadge({ tier, rank }: { tier?: string | null; rank?: number | null }) {
  const effectiveTier = tier || computeTier(rank)
  
  if (!effectiveTier) return null

  const renderBadge = () => {
    switch (effectiveTier) {
      case "elite":
        return (
          <Badge tabIndex={0} variant="secondary" className="bg-amber-400/20 text-amber-600 dark:text-amber-400 hover:bg-amber-400/30 border-amber-400/30 font-mono text-xs uppercase tracking-wider flex items-center gap-1 cursor-help">
            <Sparkles className="w-3 h-3" />
            Elite
          </Badge>
        )
      case "top_1k":
        return (
          <Badge tabIndex={0} variant="secondary" className="bg-slate-300/30 text-slate-700 dark:text-slate-300 hover:bg-slate-300/40 border-slate-300/40 font-mono text-xs uppercase tracking-wider flex items-center gap-1 cursor-help">
            <Medal className="w-3 h-3" />
            Top 1K
          </Badge>
        )
      case "top_10k":
        return (
          <Badge tabIndex={0} variant="secondary" className="bg-primary/10 text-primary hover:bg-primary/20 border-primary/20 font-mono text-xs uppercase tracking-wider flex items-center gap-1 cursor-help">
            <Award className="w-3 h-3" />
            Top 10K
          </Badge>
        )
      case "top_100k":
        return (
          <Badge tabIndex={0} variant="secondary" className="bg-muted text-muted-foreground hover:bg-muted/80 border-border font-mono text-xs uppercase tracking-wider flex items-center gap-1 cursor-help">
            <Star className="w-3 h-3" />
            Top 100K
          </Badge>
        )
      default:
        return (
          <Badge tabIndex={0} variant="secondary" className="bg-muted/50 text-muted-foreground/70 hover:bg-muted/80 border-border/50 font-mono text-xs uppercase tracking-wider flex items-center gap-1 cursor-help">
            <Shield className="w-3 h-3" />
            Top 1M
          </Badge>
        )
    }
  }

  return (
    <InfoTooltip text="Rank tier in the current Common Crawl release: Elite ≤100, then top 1k / 10k / 100k / 1M.">
      {renderBadge()}
    </InfoTooltip>
  )
}
