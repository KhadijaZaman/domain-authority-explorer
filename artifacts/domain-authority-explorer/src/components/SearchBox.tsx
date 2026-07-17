import * as React from "react"
import { useLocation } from "wouter"
import { Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { normalizeDomain } from "@/lib/normalizeDomain"

export function SearchBox({ initialValue = "" }: { initialValue?: string }) {
  const [, setLocation] = useLocation()
  const [domain, setDomain] = React.useState(initialValue)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (domain.trim()) {
      setLocation(`/?d=${encodeURIComponent(normalizeDomain(domain.trim()))}`)
    }
  }

  React.useEffect(() => {
    setDomain(initialValue)
  }, [initialValue])

  return (
    <form onSubmit={handleSubmit} className="relative flex w-full max-w-2xl items-center">
      <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">
        <Search className="h-5 w-5" />
      </div>
      <Input
        value={domain}
        onChange={(e) => setDomain(e.target.value)}
        placeholder="Enter a domain (e.g. news.ycombinator.com)"
        className="h-14 pl-12 pr-28 text-lg font-mono placeholder:font-sans bg-card border-2 border-border focus-visible:ring-0 focus-visible:border-primary transition-colors"
      />
      <Button 
        type="submit" 
        size="lg" 
        className="absolute right-2 top-1/2 -translate-y-1/2 h-10 px-6 font-bold uppercase tracking-wider text-xs"
        disabled={!domain.trim()}
      >
        Check
      </Button>
    </form>
  )
}
