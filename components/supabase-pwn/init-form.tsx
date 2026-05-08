"use client"

import { useEffect, useState } from "react"
import { ChevronDown, ChevronRight, Loader2, Globe } from "lucide-react"
import { toast } from "sonner"

import { useSupabase, detectKeyType } from "@/lib/supabase-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

type ExtractCandidate = {
  projectUrl: string
  ref: string
  apiKey: string | null
  keyKind: string | null
  source: string | null
}

const STORAGE_KEY = "supabase-pwn-config"

type PersistedConfig = {
  projectUrl: string
  anonKey?: string
  apiKey?: string
}

function loadConfig(): { projectUrl: string; apiKey: string } | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedConfig
    const apiKey = parsed.apiKey ?? parsed.anonKey ?? ""
    if (parsed.projectUrl && apiKey) return { projectUrl: parsed.projectUrl, apiKey }
    return null
  } catch {
    return null
  }
}

function saveConfig(projectUrl: string, apiKey: string) {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ projectUrl, apiKey }),
    )
  } catch {
    // localStorage may be unavailable — silently ignore
  }
}

const KEY_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  publishable: { label: "Publishable", color: "bg-sky-600" },
  secret: { label: "Secret", color: "bg-red-500" },
  anon: { label: "Anon (JWT)", color: "bg-slate-600" },
  service_role: { label: "Service Role (JWT)", color: "bg-amber-600" },
  unknown: { label: "Unknown", color: "bg-slate-500" },
}

function clearConfig() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // silently ignore
  }
}

export function InitForm() {
  const {
    initialized,
    projectUrl: connectedUrl,
    keyType,
    initialize,
    disconnect,
    mergeHints,
  } = useSupabase()

  const [url, setUrl] = useState("")
  const [key, setKey] = useState("")
  const [isOpen, setIsOpen] = useState(true)
  const [loading, setLoading] = useState(false)
  const [extractUrls, setExtractUrls] = useState("")
  const [crawl, setCrawl] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [candidates, setCandidates] = useState<ExtractCandidate[]>([])
  const [pickerOpen, setPickerOpen] = useState(false)

  // Load persisted config on mount
  useEffect(() => {
    const config = loadConfig()
    if (config) {
      setUrl(config.projectUrl)
      setKey(config.apiKey)
    }
  }, [])

  // Auto-collapse when connected, expand when disconnected
  useEffect(() => {
    setIsOpen(!initialized)
  }, [initialized])

  const canSubmit = url.trim().length > 0 && key.trim().length > 0

  async function handleInitialize() {
    if (!canSubmit || loading) return

    setLoading(true)
    try {
      await initialize(url.trim(), key.trim())
      saveConfig(url.trim(), key.trim())
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to initialize connection",
      )
    } finally {
      setLoading(false)
    }
  }

  async function connectWithCandidate(c: ExtractCandidate) {
    if (!c.apiKey) {
      toast.warning("Selected target has no usable key — fill it in manually")
      setUrl(c.projectUrl)
      return
    }
    setUrl(c.projectUrl)
    setKey(c.apiKey)
    try {
      await initialize(c.projectUrl, c.apiKey)
      saveConfig(c.projectUrl, c.apiKey)
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to initialize connection",
      )
    }
  }

  async function handleExtract() {
    const targets = extractUrls
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter(Boolean)

    if (targets.length === 0 || extracting) return

    setExtracting(true)
    setCandidates([])
    try {
      const res = await fetch("/api/extract-config", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls: targets, crawl }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data?.error ?? `Extraction failed (${res.status})`)
        return
      }

      // Merge any JS-discovered identifiers into hints regardless of outcome
      const discoveredTables: string[] = data.discoveredTables ?? []
      const discoveredFunctions: string[] = data.discoveredFunctions ?? []
      if (discoveredTables.length > 0 || discoveredFunctions.length > 0) {
        mergeHints({ tables: discoveredTables, functions: discoveredFunctions })
        toast.info(
          `Discovered ${discoveredTables.length} table(s) and ${discoveredFunctions.length} function(s) in JS bundles`,
        )
      }

      const list: ExtractCandidate[] = data.candidates ?? []

      if (list.length === 0) {
        toast.error("No Supabase config found in scanned scripts")
        return
      }

      if (list.length > 1) {
        setCandidates(list)
        setPickerOpen(true)
        return
      }

      const only = list[0]
      const kindLabel = only.keyKind ? ` (${only.keyKind})` : ""
      if (only.apiKey) {
        toast.success(`Found Supabase config${kindLabel} — connecting…`)
        await connectWithCandidate(only)
      } else {
        toast.warning("Found Supabase URL but no usable key")
        setUrl(only.projectUrl)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Extraction failed")
    } finally {
      setExtracting(false)
    }
  }

  function handleDisconnect() {
    disconnect()
    clearConfig()
    setUrl("")
    setKey("")
  }

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="icon-xs">
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4" />
                  ) : (
                    <ChevronRight className="h-4 w-4" />
                  )}
                </Button>
              </CollapsibleTrigger>
              <CardTitle className="text-sm">Supabase Connection</CardTitle>
              {initialized && (
                <>
                  <Badge className="bg-primary text-primary-foreground hover:bg-primary">
                    Connected
                  </Badge>
                  <Badge className={`${KEY_TYPE_LABELS[keyType].color} text-white hover:${KEY_TYPE_LABELS[keyType].color}`}>
                    {KEY_TYPE_LABELS[keyType].label}
                  </Badge>
                </>
              )}
            </div>
            {initialized && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
              >
                Disconnect
              </Button>
            )}
          </div>
          {initialized && !isOpen && (
            <p className="text-xs text-muted-foreground truncate pl-8">
              {connectedUrl}
            </p>
          )}
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-4">
            {!initialized && (
              <div className="space-y-2 rounded-md border border-dashed p-3">
                <Label htmlFor="extract-urls" className="flex items-center gap-2">
                  <Globe className="h-3.5 w-3.5" />
                  Extract from website URL(s)
                </Label>
                <Textarea
                  id="extract-urls"
                  placeholder={"https://example.com\nhttps://app.example.com"}
                  value={extractUrls}
                  onChange={(e) => setExtractUrls(e.target.value)}
                  disabled={extracting}
                  className="min-h-16 text-sm font-mono"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      handleExtract()
                    }
                  }}
                />
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="flex items-center gap-2">
                    <Switch
                      id="crawl-toggle"
                      checked={crawl}
                      onCheckedChange={setCrawl}
                      disabled={extracting}
                    />
                    <Label htmlFor="crawl-toggle" className="text-xs cursor-pointer">
                      Crawl 1 level (same-origin links)
                    </Label>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleExtract}
                    disabled={!extractUrls.trim() || extracting}
                  >
                    {extracting ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Scanning…
                      </>
                    ) : (
                      "Extract"
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Comma- or newline-separated URLs. Scans entry pages + their JS bundles for Supabase URLs, anon/publishable keys, and table/function names.
                </p>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="project-url">Project URL</Label>
              <Input
                id="project-url"
                type="url"
                placeholder="https://your-project.supabase.co"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={loading || initialized}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <Label htmlFor="api-key">API Key</Label>
                {key.trim().length > 5 && (() => {
                  const kt = detectKeyType(key.trim())
                  const info = KEY_TYPE_LABELS[kt]
                  return (
                    <Badge className={`${info.color} text-white text-[10px] px-1.5 py-0`}>
                      {info.label}
                    </Badge>
                  )
                })()}
              </div>
              <Input
                id="api-key"
                type="password"
                placeholder="eyJhbGciOi... / sb_publishable_... / sb_secret_..."
                value={key}
                onChange={(e) => setKey(e.target.value)}
                disabled={loading || initialized}
                autoComplete="new-password"
                autoCorrect="off"
                spellCheck={false}
                data-1p-ignore
                data-lpignore="true"
                data-form-type="other"
              />
            </div>

            {!initialized && (
              <Button
                className="w-full"
                onClick={handleInitialize}
                disabled={!canSubmit || loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  "Initialize"
                )}
              </Button>
            )}
          </CardContent>
        </CollapsibleContent>
      </Card>

      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Multiple Supabase projects found</DialogTitle>
            <DialogDescription>
              Pick one to connect. Keys with role <code>anon</code> or
              <code> publishable</code> are usually what you want.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-72 space-y-2 overflow-auto pr-1">
            {candidates.map((c) => {
              const kindInfo = c.keyKind ? KEY_TYPE_LABELS[c.keyKind] : null
              return (
                <button
                  key={c.ref}
                  type="button"
                  onClick={async () => {
                    setPickerOpen(false)
                    await connectWithCandidate(c)
                  }}
                  className="flex w-full items-start gap-3 rounded-md border p-3 text-left hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="font-mono text-xs truncate">{c.projectUrl}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      ref: <code>{c.ref}</code>
                      {c.source ? ` · from ${c.source}` : ""}
                    </div>
                  </div>
                  {kindInfo ? (
                    <Badge className={`${kindInfo.color} text-white text-[10px]`}>
                      {kindInfo.label}
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-[10px]">
                      no key
                    </Badge>
                  )}
                </button>
              )
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPickerOpen(false)}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Collapsible>
  )
}
