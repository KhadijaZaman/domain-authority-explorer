import * as React from "react"
import { useGetStatus } from "@workspace/api-client-react"
import { Link, useLocation } from "wouter"
import { Activity, Database, Menu } from "lucide-react"
import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet"
import { InfoTooltip } from "@/components/ui/tooltip"

export function Navbar() {
  const [location] = useLocation()
  const { data: status } = useGetStatus()

  const navLinks = [
    { href: "/", label: "Check a Domain" },
    { href: "/compare", label: "Bulk Compare" },
    { href: "/gap", label: "Link Gap Finder" },
    { href: "/leaderboard", label: "Top 1000" },
    { href: "/corpus", label: "Corpus Audit" },
    { href: "/cheatsheet", label: "Guide" },
    { href: "/methodology", label: "Methodology" },
  ]

  // For subpages like /?d=something, location is still "/" in wouter
  const isActive = (href: string) => location === href

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/40 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-14 max-w-screen-2xl items-center px-4 md:px-6">
        <div className="mr-4 flex items-center">
          {/* Mobile Nav */}
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden mr-2 -ml-2">
                <Menu className="h-5 w-5" />
                <span className="sr-only">Toggle Menu</span>
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="pr-0">
              <Link href="/" className="flex items-center space-x-2 mb-8">
                <div className="bg-primary text-primary-foreground w-8 h-8 flex items-center justify-center font-mono font-bold text-lg leading-none tracking-tighter">
                  DA
                </div>
                <span className="font-bold tracking-tight text-lg">
                  Authority Explorer
                </span>
              </Link>
              <nav className="flex flex-col gap-2 px-2">
                {navLinks.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className={cn(
                      "transition-colors text-sm font-medium px-4 py-2 rounded-md",
                      isActive(link.href) 
                        ? "bg-primary/10 text-primary" 
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                    )}
                  >
                    {link.label}
                  </Link>
                ))}
              </nav>
            </SheetContent>
          </Sheet>

          {/* Logo */}
          <Link href="/" className="mr-6 flex items-center space-x-2">
            <div className="bg-primary text-primary-foreground w-8 h-8 flex items-center justify-center font-mono font-bold text-lg leading-none tracking-tighter rounded-sm">
              DA
            </div>
            <span className="hidden lg:inline-block font-bold tracking-tight text-lg">
              Authority Explorer
            </span>
          </Link>
          
          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center space-x-1 text-sm font-medium">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={cn(
                  "transition-colors whitespace-nowrap px-3 py-1.5 rounded-full",
                  isActive(link.href) 
                    ? "bg-primary/10 text-primary" 
                    : "text-foreground/60 hover:text-foreground/80 hover:bg-muted/50"
                )}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
        
        <div className="flex flex-1 items-center justify-end space-x-2">
          <nav className="flex items-center">
            {status ? (
              <div className="flex items-center gap-3 text-sm">
                {!status.ready ? (
                  <Badge variant="secondary" className="flex gap-1.5 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 border-amber-500/20">
                    <Activity className="w-3 h-3 animate-pulse" />
                    Dataset Loading
                  </Badge>
                ) : (
                  <div className="flex items-center gap-4 text-muted-foreground">
                    <span className="hidden sm:flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5" />
                      <span className="font-mono text-xs">{status.releaseName}</span>
                    </span>
                    <InfoTooltip text="Dataset status — top 1M domains of the current release loaded and queryable.">
                      <Badge tabIndex={0} variant="outline" className="text-primary border-primary/20 bg-primary/5 cursor-help">
                        Ready
                      </Badge>
                    </InfoTooltip>
                  </div>
                )}
              </div>
            ) : (
              <Skeleton className="h-6 w-32" />
            )}
          </nav>
        </div>
      </div>
    </header>
  )
}

function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />
}
