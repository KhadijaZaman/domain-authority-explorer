import * as React from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useGetDomainNiche, getGetDomainNicheQueryKey, useSetDomainNiche, useAutoDetectDomainNiche, useListNiches, getListNichesQueryKey } from "@workspace/api-client-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Tag, X, Plus, Sparkles, Loader2 } from "lucide-react"
import { InfoTooltip } from "@/components/ui/tooltip"

export function DomainNiche({ domain }: { domain: string }) {
  const queryClient = useQueryClient()
  const [open, setOpen] = React.useState(false)
  const [inputValue, setInputValue] = React.useState("")

  const { data: nicheData } = useGetDomainNiche(domain, {
    query: {
      queryKey: getGetDomainNicheQueryKey(domain),
      enabled: !!domain
    }
  })

  const { data: nichesList } = useListNiches({
    query: {
      queryKey: getListNichesQueryKey()
    }
  })

  const setNiche = useSetDomainNiche()
  const autoDetect = useAutoDetectDomainNiche()
  const [autoError, setAutoError] = React.useState<string | null>(null)

  const handleAutoDetect = () => {
    setAutoError(null)
    autoDetect.mutate({ domain }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDomainNicheQueryKey(domain) })
        queryClient.invalidateQueries({ queryKey: getListNichesQueryKey() })
      },
      onError: (err: unknown) => {
        const e = err as { data?: { error?: string }; response?: { data?: { error?: string } } }
        const msg = e?.data?.error ?? e?.response?.data?.error
        setAutoError(msg ?? "Auto-detect failed. Try tagging manually.")
      }
    })
  }

  const handleSelect = (tag: string) => {
    setNiche.mutate({ domain, data: { tag } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDomainNicheQueryKey(domain) })
        queryClient.invalidateQueries({ queryKey: getListNichesQueryKey() })
        setOpen(false)
        setInputValue("")
      }
    })
  }

  const handleClear = () => {
    setNiche.mutate({ domain, data: { tag: "" } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetDomainNicheQueryKey(domain) })
        queryClient.invalidateQueries({ queryKey: getListNichesQueryKey() })
      }
    })
  }

  const tooltipText = "Niche-relative standing: authority compared only against domains sharing this topical tag — a modest global score can still dominate a niche."

  return (
    <div className="flex items-center gap-3">
      {nicheData?.tag ? (
        <div className="flex items-center gap-2 flex-wrap">
          <InfoTooltip text={tooltipText}>
            <Badge tabIndex={0} variant="secondary" className="text-sm font-sans bg-primary/10 text-primary border-primary/20 flex items-center gap-1.5 px-3 py-1 cursor-help">
              <Tag className="w-3.5 h-3.5" />
              {nicheData.tag}
              <button onClick={handleClear} className="ml-1 opacity-50 hover:opacity-100 transition-opacity">
                <X className="w-3 h-3" />
              </button>
            </Badge>
          </InfoTooltip>
          
          {nicheData.nichePercentile !== null && nicheData.nicheRank !== null && (
            <InfoTooltip text={tooltipText}>
              <div tabIndex={0} className="text-sm text-muted-foreground flex items-center gap-2 border border-border/50 px-3 py-1 rounded-sm bg-muted/20 cursor-help">
                <span className="font-mono text-foreground font-semibold">
                  {nicheData.nichePercentile.toFixed(1)}
                </span>
                <span className="text-xs opacity-80">percentile</span>
                <span className="mx-1 opacity-30">|</span>
                <span className="font-mono text-foreground font-semibold">
                  #{new Intl.NumberFormat().format(nicheData.nicheRank)}
                </span>
                <span className="text-xs opacity-80">of {new Intl.NumberFormat().format(nicheData.nicheSize)}</span>
              </div>
            </InfoTooltip>
          )}
        </div>
      ) : (
        <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant="outline"
          size="sm"
          className="h-8 text-primary border-primary/40 hover:border-primary hover:text-primary"
          onClick={handleAutoDetect}
          disabled={autoDetect.isPending}
        >
          {autoDetect.isPending ? (
            <>
              <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              Reading homepage...
            </>
          ) : (
            <>
              <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              Auto-detect
            </>
          )}
        </Button>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 border-dashed text-muted-foreground hover:text-foreground hover:border-primary/50">
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Tag Industry/Niche
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-[240px] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search or create niche..." value={inputValue} onValueChange={setInputValue} />
              <CommandList>
                {inputValue && (
                  <CommandEmpty className="py-2 px-1">
                    <Button 
                      variant="ghost" 
                      className="w-full justify-start text-primary text-sm h-9"
                      onClick={() => handleSelect(inputValue)}
                    >
                      <Plus className="w-3.5 h-3.5 mr-2" />
                      Create "{inputValue}"
                    </Button>
                  </CommandEmpty>
                )}
                {nichesList && nichesList.length > 0 && (
                  <CommandGroup heading="Suggestions">
                    {nichesList.map((n) => (
                      <CommandItem
                        key={n.tag}
                        value={n.tag}
                        onSelect={(val) => handleSelect(val)}
                        className="flex justify-between"
                      >
                        <span>{n.tag}</span>
                        <span className="font-mono text-xs text-muted-foreground">{n.count}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                )}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
        {autoError && (
          <span className="text-xs text-destructive">{autoError}</span>
        )}
        </div>
      )}
    </div>
  )
}
