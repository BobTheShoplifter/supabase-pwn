"use client"

import { useEffect, useState } from "react"
import { ChevronDown, ChevronRight, Loader2 } from "lucide-react"
import { toast } from "sonner"

import { useSupabase, detectKeyType } from "@/lib/supabase-context"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"

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
  const { initialized, projectUrl: connectedUrl, keyType, initialize, disconnect } =
    useSupabase()

  const [url, setUrl] = useState("")
  const [key, setKey] = useState("")
  const [isOpen, setIsOpen] = useState(true)
  const [loading, setLoading] = useState(false)

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
            <div className="space-y-2">
              <Label htmlFor="project-url">Project URL</Label>
              <Input
                id="project-url"
                type="url"
                placeholder="https://your-project.supabase.co"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                disabled={loading || initialized}
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
    </Collapsible>
  )
}
