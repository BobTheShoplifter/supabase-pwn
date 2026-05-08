"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Play,
  Square,
  Shield,
  ShieldAlert,
  ShieldCheck,
  ChevronDown,
  ChevronRight,
  Database,
  HardDrive,
  Key,
  Zap,
  Download,
  History,
  Sparkles,
} from "lucide-react"

import {
  useSupabase,
  TABLE_WORDLIST,
  FUNCTION_WORDLIST,
} from "@/lib/supabase-context"
import {
  diffHasChanges,
  diffScans,
  loadLastScan,
  saveScan,
  type ScanDiff,
  type ScanRecord,
} from "@/lib/scan-history"
import {
  downloadFile,
  formatMarkdownReport,
  reportFilenameBase,
} from "@/lib/scan-report"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { Separator } from "@/components/ui/separator"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type AccessStatus = "allowed" | "denied" | "error" | "empty"
type WriteStatus = AccessStatus | "skipped"

type ScanResult = {
  name: string
  select?: AccessStatus
  insert?: WriteStatus
  update?: WriteStatus
  delete?: WriteStatus
  details?: string
}

type StorageResult = {
  name: string
  public: boolean
  listable: AccessStatus
  fileCount?: number
}

type AuthResult = {
  feature: string
  status: "enabled" | "disabled" | "error"
  details?: string
}

type FunctionResult = {
  name: string
  status: "found" | "not_found" | "error"
  statusCode?: number
}

type ScanPhase =
  | "idle"
  | "recon"
  | "database"
  | "storage"
  | "auth"
  | "functions"
  | "complete"

type ScanConfig = {
  databaseRls: boolean
  storageScan: boolean
  authProbing: boolean
  edgeFunctions: boolean
  concurrency: number
  writeTesting: boolean
  customTables: string
  /** Augment table list with the curated wordlist. */
  useBuiltinTableWordlist: boolean
  /** Augment table+function lists with identifiers harvested from JS bundles. */
  useJsHints: boolean
}

type AbortSignal = { aborted: boolean }

// ---------------------------------------------------------------------------
// Concurrency helper
// ---------------------------------------------------------------------------

async function runInBatches<T>(
  tasks: (() => Promise<T>)[],
  batchSize: number,
  signal: AbortSignal,
): Promise<T[]> {
  const results: T[] = []
  for (let i = 0; i < tasks.length; i += batchSize) {
    if (signal.aborted) break
    const batch = tasks.slice(i, i + batchSize)
    const batchResults = await Promise.allSettled(batch.map((t) => t()))
    for (const r of batchResults) {
      results.push(r.status === "fulfilled" ? r.value : r.reason)
    }
  }
  return results
}

// ---------------------------------------------------------------------------
// Status badge helper
// ---------------------------------------------------------------------------

function StatusBadge({
  status,
}: {
  status: AccessStatus | WriteStatus | "enabled" | "disabled" | "found" | "not_found" | undefined
}) {
  if (!status) return <span className="text-xs text-muted-foreground">-</span>

  switch (status) {
    case "allowed":
    case "enabled":
    case "found":
      return (
        <Badge className="bg-green-600/20 text-green-400 border-green-600/30 hover:bg-green-600/20">
          {status === "allowed" ? "DATA EXPOSED" : status.toUpperCase()}
        </Badge>
      )
    case "empty":
      return (
        <Badge className="bg-yellow-600/20 text-yellow-400 border-yellow-600/30 hover:bg-yellow-600/20">
          200 OK (EMPTY)
        </Badge>
      )
    case "denied":
    case "disabled":
    case "not_found":
      return (
        <Badge className="bg-red-600/20 text-red-400 border-red-600/30 hover:bg-red-600/20">
          {status === "not_found" ? "NOT FOUND" : status.toUpperCase()}
        </Badge>
      )
    case "error":
      return (
        <Badge className="bg-orange-600/20 text-orange-400 border-orange-600/30 hover:bg-orange-600/20">
          ERROR
        </Badge>
      )
    case "skipped":
      return (
        <Badge variant="secondary" className="opacity-60">
          SKIPPED
        </Badge>
      )
    default:
      return <span className="text-xs text-muted-foreground">-</span>
  }
}

// ---------------------------------------------------------------------------
// Collapsible section wrapper
// ---------------------------------------------------------------------------

function ResultSection({
  title,
  icon: Icon,
  count,
  defaultOpen = true,
  children,
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  count?: number
  defaultOpen?: boolean
  children: React.ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm font-medium hover:bg-muted/50 transition-colors">
        {open ? (
          <ChevronDown className="size-4 shrink-0" />
        ) : (
          <ChevronRight className="size-4 shrink-0" />
        )}
        <Icon className="size-4 shrink-0" />
        <span>{title}</span>
        {count !== undefined && (
          <Badge variant="secondary" className="ml-auto text-xs">
            {count}
          </Badge>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">
        {children}
      </CollapsibleContent>
    </Collapsible>
  )
}

// ---------------------------------------------------------------------------
// AutoPwn Component
// ---------------------------------------------------------------------------

export function AutoPwn() {
  const { client, schema, addLog, projectUrl, apiKey, keyType, hints, mergeHints } = useSupabase()

  // -- Config state ---------------------------------------------------------
  const [config, setConfig] = useState<ScanConfig>({
    databaseRls: true,
    storageScan: true,
    authProbing: true,
    edgeFunctions: false,
    concurrency: 10,
    writeTesting: false,
    customTables: "",
    useBuiltinTableWordlist: true,
    useJsHints: true,
  })

  // -- Scan history (persisted) --------------------------------------------
  const [previousScan, setPreviousScan] = useState<ScanRecord | null>(null)
  const [latestScan, setLatestScan] = useState<ScanRecord | null>(null)
  const [diff, setDiff] = useState<ScanDiff | null>(null)

  // Load the most recent persisted scan when the connected project changes
  useEffect(() => {
    if (!projectUrl) {
      setPreviousScan(null)
      setLatestScan(null)
      setDiff(null)
      return
    }
    setPreviousScan(loadLastScan(projectUrl))
    setLatestScan(null)
    setDiff(null)
  }, [projectUrl])

  // -- Scan state -----------------------------------------------------------
  const [phase, setPhase] = useState<ScanPhase>("idle")
  const [scanning, setScanning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressLabel, setProgressLabel] = useState("")
  const [currentItem, setCurrentItem] = useState("")

  // -- Results state --------------------------------------------------------
  const [dbResults, setDbResults] = useState<ScanResult[]>([])
  const [storageResults, setStorageResults] = useState<StorageResult[]>([])
  const [authResults, setAuthResults] = useState<AuthResult[]>([])
  const [functionResults, setFunctionResults] = useState<FunctionResult[]>([])

  // -- Abort ref ------------------------------------------------------------
  const abortRef = useRef<AbortSignal>({ aborted: false })

  // -- Config helpers -------------------------------------------------------
  const updateConfig = useCallback(
    <K extends keyof ScanConfig>(key: K, value: ScanConfig[K]) => {
      setConfig((prev) => ({ ...prev, [key]: value }))
    },
    [],
  )

  // -- Phase weight calculation for progress --------------------------------
  const getPhaseWeights = useCallback(() => {
    const weights: { phase: string; weight: number }[] = []
    weights.push({ phase: "recon", weight: 5 })
    if (config.databaseRls) weights.push({ phase: "database", weight: 50 })
    if (config.storageScan) weights.push({ phase: "storage", weight: 20 })
    if (config.authProbing) weights.push({ phase: "auth", weight: 10 })
    if (config.edgeFunctions) weights.push({ phase: "functions", weight: 15 })
    return weights
  }, [config])

  const calculateProgress = useCallback(
    (currentPhase: string, phaseProgress: number) => {
      const weights = getPhaseWeights()
      const totalWeight = weights.reduce((sum, w) => sum + w.weight, 0)
      let accumulated = 0
      for (const w of weights) {
        if (w.phase === currentPhase) {
          accumulated += (w.weight * phaseProgress) / 100
          break
        }
        accumulated += w.weight
      }
      return Math.min(Math.round((accumulated / totalWeight) * 100), 100)
    },
    [getPhaseWeights],
  )

  // =========================================================================
  // Scanning Phases
  // =========================================================================

  // -- Phase 1: Reconnaissance ----------------------------------------------
  const runRecon = useCallback(() => {
    if (!schema) return
    setPhase("recon")
    setProgressLabel("Reconnaissance")
    setCurrentItem("Analyzing discovered schema...")

    const tableCount = schema.tables.length
    const viewCount = schema.views.length
    const fnCount = schema.functions.length

    addLog(
      "info",
      `Recon: ${tableCount} tables, ${viewCount} views, ${fnCount} functions discovered`,
    )
    setProgress(calculateProgress("recon", 100))
  }, [schema, addLog, calculateProgress])

  // -- Phase 2: Database RLS Testing ----------------------------------------
  const runDatabaseRls = useCallback(async () => {
    if (!client || !schema) return

    setPhase("database")
    setProgressLabel("Database RLS Testing")

    // Collect tables to test
    const customTableNames = config.customTables
      .split(/[,\n]/)
      .map((t) => t.trim())
      .filter(Boolean)

    const sources: string[][] = [schema.tables, customTableNames]
    if (config.useJsHints && hints.tables.length > 0) sources.push(hints.tables)
    if (config.useBuiltinTableWordlist) sources.push(TABLE_WORDLIST)

    const allTables = [...new Set(sources.flat())]

    if (allTables.length === 0) {
      addLog("warning", "No tables to test for RLS")
      setProgress(calculateProgress("database", 100))
      return
    }

    const results: ScanResult[] = []
    const tested = new Set<string>()
    /** New tables surfaced by PGRST205 server hints during scanning. */
    const newHinted = new Set<string>()

    /** Match "Perhaps you meant the table 'public.xxx'" */
    const parseServerHint = (hint: string | null | undefined): string | null => {
      if (!hint) return null
      const m = hint.match(/perhaps you meant.*?'(?:public\.)?([^']+)'/i)
      return m ? m[1] : null
    }

    const probeOne = async (
      table: string,
      idx: number,
      total: number,
    ): Promise<ScanResult> => {
      if (abortRef.current.aborted) {
        return { name: table, select: "error", details: "Aborted" }
      }

      setCurrentItem(`SELECT on ${table} (${idx + 1}/${total})`)

      const result: ScanResult = { name: table }

      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (client as any)
          .from(table)
          .select("*")
          .limit(1)

        if (error) {
          const code = error.code ?? ""
          const msg = (error.message ?? "").toLowerCase()

          // Capture PGRST205 server hints — they often reveal real table names
          // even when the probed name was wrong (e.g. "users" → "profiles").
          if (code === "PGRST205") {
            const hintedFromHint = parseServerHint(error.hint)
            const hintedFromMsg = parseServerHint(error.message)
            const hinted = hintedFromHint ?? hintedFromMsg
            if (hinted && !tested.has(hinted)) newHinted.add(hinted)
          }

          if (
            code === "42501" ||
            msg.includes("denied") ||
            msg.includes("rls") ||
            msg.includes("permission") ||
            msg.includes("policy")
          ) {
            result.select = "denied"
          } else {
            result.select = "error"
          }
          result.details = `SELECT: ${error.message}`
        } else {
          const rowCount = Array.isArray(data) ? data.length : 0
          if (rowCount > 0) {
            result.select = "allowed"
            result.details = `SELECT returned ${rowCount} row(s) — DATA EXPOSED`
          } else {
            result.select = "empty"
            result.details = `SELECT returned 200 OK but 0 rows (empty table or RLS filtering)`
          }
        }
      } catch (err) {
        result.select = "error"
        result.details =
          err instanceof Error ? err.message : "Unknown SELECT error"
      }

      // Write testing (INSERT then cleanup DELETE)
      if (config.writeTesting) {
        // INSERT test
        try {
          setCurrentItem(`INSERT on ${table} (${idx + 1}/${total})`)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: insertError } = await (client as any)
            .from(table)
            .insert({
              __supabase_pwn_probe: true,
              _timestamp: Date.now(),
            })

          if (insertError) {
            const code = insertError.code ?? ""
            const msg = (insertError.message ?? "").toLowerCase()
            if (
              code === "42501" ||
              msg.includes("denied") ||
              msg.includes("rls") ||
              msg.includes("permission") ||
              msg.includes("policy")
            ) {
              result.insert = "denied"
            } else {
              result.insert = "error"
            }
          } else {
            result.insert = "allowed"
          }
        } catch {
          result.insert = "error"
        }

        // DELETE test (cleanup)
        try {
          setCurrentItem(`DELETE on ${table} (${idx + 1}/${total})`)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { error: deleteError } = await (client as any)
            .from(table)
            .delete()
            .eq("__supabase_pwn_probe", true)

          if (deleteError) {
            const code = deleteError.code ?? ""
            const msg = (deleteError.message ?? "").toLowerCase()
            if (
              code === "42501" ||
              msg.includes("denied") ||
              msg.includes("rls") ||
              msg.includes("permission") ||
              msg.includes("policy")
            ) {
              result.delete = "denied"
            } else {
              result.delete = "error"
            }
          } else {
            result.delete = "allowed"
          }
        } catch {
          result.delete = "error"
        }
      } else {
        result.insert = "skipped"
        result.update = "skipped"
        result.delete = "skipped"
      }

      return result
    }

    /** Run a wave of probes against `tables` and append to `results`. */
    const runWave = async (tables: string[]) => {
      const total = tables.length
      const tasks = tables.map((t, i) => {
        tested.add(t)
        return () => probeOne(t, i, total)
      })
      const wave = await runInBatches(tasks, config.concurrency, abortRef.current)
      for (const r of wave) {
        if (r && typeof r === "object" && "name" in r) {
          results.push(r as ScanResult)
        }
      }
    }

    // Wave 1: explicit + wordlist + JS hints
    await runWave(allTables)

    // Wave 2: PGRST205 server-suggested table names that we haven't tested yet
    if (!abortRef.current.aborted) {
      const wave2 = [...newHinted].filter((t) => !tested.has(t))
      if (wave2.length > 0) {
        addLog(
          "info",
          `Probing ${wave2.length} table(s) suggested by PGRST205 server hints…`,
        )
        await runWave(wave2)
      }
      // Persist newly-confirmed names into context hints so the DB explorer
      // and future scans pick them up.
      if (newHinted.size > 0) {
        mergeHints({ tables: [...newHinted] })
      }
    }

    setDbResults(results)

    const dataExposedCount = results.filter((r) => r.select === "allowed").length
    const emptyOkCount = results.filter((r) => r.select === "empty").length
    const hintNote = newHinted.size > 0 ? ` (+${newHinted.size} from server hints)` : ""
    addLog(
      dataExposedCount > 0 ? "warning" : "success",
      `Database RLS: ${dataExposedCount}/${results.length} tables expose data, ${emptyOkCount} return 200 OK (empty)${hintNote}`,
    )

    setProgress(calculateProgress("database", 100))
  }, [client, schema, config, hints.tables, addLog, calculateProgress, mergeHints])

  // -- Phase 3: Storage Scanning --------------------------------------------
  const runStorageScan = useCallback(async () => {
    if (!client) return

    setPhase("storage")
    setProgressLabel("Storage Scanning")
    setCurrentItem("Listing buckets...")

    const results: StorageResult[] = []

    try {
      const { data: buckets, error } = await client.storage.listBuckets()

      if (error) {
        addLog("error", `Storage scan error: ${error.message}`)
        setProgress(calculateProgress("storage", 100))
        return
      }

      if (!buckets || buckets.length === 0) {
        addLog("info", "No storage buckets found")
        setProgress(calculateProgress("storage", 100))
        return
      }

      const totalBuckets = buckets.length

      for (let i = 0; i < totalBuckets; i++) {
        if (abortRef.current.aborted) break

        const bucket = buckets[i]
        setCurrentItem(`Scanning bucket: ${bucket.name} (${i + 1}/${totalBuckets})`)

        const result: StorageResult = {
          name: bucket.name,
          public: bucket.public,
          listable: "error",
        }

        try {
          const { data: files, error: listError } = await client.storage
            .from(bucket.name)
            .list("", { limit: 5 })

          if (listError) {
            const msg = (listError.message ?? "").toLowerCase()
            if (
              msg.includes("denied") ||
              msg.includes("policy") ||
              msg.includes("permission")
            ) {
              result.listable = "denied"
            } else {
              result.listable = "error"
            }
          } else {
            result.listable = "allowed"
            result.fileCount = files?.length ?? 0
          }
        } catch {
          result.listable = "error"
        }

        results.push(result)
        setProgress(
          calculateProgress("storage", ((i + 1) / totalBuckets) * 100),
        )
      }

      setStorageResults(results)

      const publicCount = results.filter((r) => r.public).length
      const listableCount = results.filter((r) => r.listable === "allowed").length
      addLog(
        publicCount > 0 || listableCount > 0 ? "warning" : "success",
        `Storage: ${results.length} bucket(s), ${publicCount} public, ${listableCount} listable`,
      )
    } catch (err) {
      addLog(
        "error",
        err instanceof Error ? err.message : "Storage scan failed",
      )
    }

    setProgress(calculateProgress("storage", 100))
  }, [client, addLog, calculateProgress])

  // -- Phase 4: Auth Probing ------------------------------------------------
  const runAuthProbing = useCallback(async () => {
    if (!client) return

    setPhase("auth")
    setProgressLabel("Auth Probing")
    const results: AuthResult[] = []

    // Test signup
    setCurrentItem("Testing open signup...")
    try {
      const probeEmail = `supabase-pwn-${crypto.randomUUID().slice(0, 8)}@iapapi.com`
      const { data, error } = await client.auth.signUp({
        email: probeEmail,
        password: "SupabasePwnProbe123!",
      })

      if (error) {
        const msg = (error.message ?? "").toLowerCase()
        if (msg.includes("disabled") || msg.includes("not allowed") || msg.includes("signup is not available")) {
          results.push({
            feature: "Email Signup",
            status: "disabled",
            details: error.message,
          })
        } else {
          results.push({
            feature: "Email Signup",
            status: "error",
            details: error.message,
          })
        }
      } else {
        // If we got a user back, signup is open
        const hasUser = data?.user !== null && data?.user !== undefined
        results.push({
          feature: "Email Signup",
          status: hasUser ? "enabled" : "disabled",
          details: hasUser
            ? `Account created for ${probeEmail}`
            : "Signup returned no user (may require email confirmation)",
        })
      }
    } catch (err) {
      results.push({
        feature: "Email Signup",
        status: "error",
        details: err instanceof Error ? err.message : "Unknown error",
      })
    }

    setProgress(calculateProgress("auth", 50))

    // Test anonymous auth
    if (!abortRef.current.aborted) {
      setCurrentItem("Testing anonymous authentication...")
      try {
        const { data, error } = await client.auth.signInAnonymously()

        if (error) {
          const msg = (error.message ?? "").toLowerCase()
          if (msg.includes("disabled") || msg.includes("not allowed")) {
            results.push({
              feature: "Anonymous Auth",
              status: "disabled",
              details: error.message,
            })
          } else {
            results.push({
              feature: "Anonymous Auth",
              status: "error",
              details: error.message,
            })
          }
        } else {
          const hasSession = data?.session !== null && data?.session !== undefined
          results.push({
            feature: "Anonymous Auth",
            status: hasSession ? "enabled" : "disabled",
            details: hasSession
              ? "Anonymous sessions are enabled"
              : "No session returned",
          })
        }
      } catch (err) {
        results.push({
          feature: "Anonymous Auth",
          status: "error",
          details: err instanceof Error ? err.message : "Unknown error",
        })
      }
    }

    // Sign out after probing
    try {
      await client.auth.signOut()
    } catch {
      // Ignore sign-out errors during probing
    }

    setAuthResults(results)

    const enabledCount = results.filter((r) => r.status === "enabled").length
    addLog(
      enabledCount > 0 ? "warning" : "info",
      `Auth: ${enabledCount}/${results.length} features enabled`,
    )

    setProgress(calculateProgress("auth", 100))
  }, [client, addLog, calculateProgress])

  // -- Phase 5: Edge Function Discovery -------------------------------------
  const runEdgeFunctionDiscovery = useCallback(async () => {
    if (!client || !projectUrl || !apiKey) return

    setPhase("functions")
    setProgressLabel("Edge Function Discovery")

    const fnSources: string[][] = [FUNCTION_WORDLIST]
    if (config.useJsHints && hints.functions.length > 0) fnSources.push(hints.functions)
    const commonNames = [...new Set(fnSources.flat())]

    const results: FunctionResult[] = []
    const totalFunctions = commonNames.length

    // Why a raw fetch instead of client.functions.invoke():
    //   1. invoke() throws SDK-wrapped errors whose .message rarely contains "404",
    //      so the previous version classified almost everything as "found".
    //   2. We need the real HTTP status to distinguish 404 (not deployed) from
    //      anything else (deployed — even 401/4xx/5xx confirm existence).
    // The functions gateway returns CORS headers on 404 responses, so the browser
    // can read the status. If a deployed function lacks CORS, the fetch promise
    // will reject — we treat that as "found" (the gateway routed to it).
    const probeFunction = async (name: string): Promise<FunctionResult> => {
      const url = `${projectUrl.replace(/\/$/, "")}/functions/v1/${encodeURIComponent(name)}`
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: {
            apikey: apiKey,
            Authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: "{}",
        })

        if (res.status === 404) {
          return { name, status: "not_found", statusCode: 404 }
        }
        // Anything else (200, 401, 4xx, 5xx) — function is deployed.
        return { name, status: "found", statusCode: res.status }
      } catch {
        // TypeError ("Failed to fetch") usually = CORS or network. The gateway
        // sets CORS on 404s, so a network failure most likely means the
        // function exists but its handler doesn't allow our origin.
        return { name, status: "found" }
      }
    }

    const tasks = commonNames.map((name, idx) => {
      return async (): Promise<FunctionResult> => {
        if (abortRef.current.aborted) {
          return { name, status: "error" }
        }
        setCurrentItem(
          `Probing function: ${name} (${idx + 1}/${totalFunctions})`,
        )
        return probeFunction(name)
      }
    })

    const batchResults = await runInBatches(
      tasks,
      config.concurrency,
      abortRef.current,
    )

    for (const r of batchResults) {
      if (r && typeof r === "object" && "name" in r) {
        results.push(r as FunctionResult)
      }
    }

    setFunctionResults(results)

    const foundCount = results.filter((r) => r.status === "found").length
    addLog(
      foundCount > 0 ? "success" : "info",
      `Edge Functions: ${foundCount}/${results.length} functions discovered`,
    )

    setProgress(calculateProgress("functions", 100))
  }, [client, projectUrl, apiKey, config.concurrency, config.useJsHints, hints.functions, addLog, calculateProgress])

  // =========================================================================
  // Start / Abort
  // =========================================================================

  const handleStartScan = useCallback(async () => {
    if (!client || !schema) return

    // Reset state
    abortRef.current = { aborted: false }
    setScanning(true)
    setProgress(0)
    setDbResults([])
    setStorageResults([])
    setAuthResults([])
    setFunctionResults([])
    setLatestScan(null)
    setDiff(null)
    // Capture the previous scan once at the start of this run, so the diff
    // we compute when finishing reflects "current vs prior persisted run".
    const priorRecord = projectUrl ? loadLastScan(projectUrl) : null
    setPreviousScan(priorRecord)

    addLog("info", "AutoPwn scan started")

    try {
      // Phase 1: Recon
      runRecon()
      if (abortRef.current.aborted) throw new Error("Aborted")

      // Phase 2: Database RLS Testing
      if (config.databaseRls) {
        await runDatabaseRls()
        if (abortRef.current.aborted) throw new Error("Aborted")
      }

      // Phase 3: Storage Scanning
      if (config.storageScan) {
        await runStorageScan()
        if (abortRef.current.aborted) throw new Error("Aborted")
      }

      // Phase 4: Auth Probing
      if (config.authProbing) {
        await runAuthProbing()
        if (abortRef.current.aborted) throw new Error("Aborted")
      }

      // Phase 5: Edge Function Discovery
      if (config.edgeFunctions) {
        await runEdgeFunctionDiscovery()
        if (abortRef.current.aborted) throw new Error("Aborted")
      }

      setPhase("complete")
      setProgress(100)
      setProgressLabel("Scan Complete")
      setCurrentItem("")
      addLog("success", "AutoPwn scan completed")
      // Persistence + diff are computed in the useEffect below — we read the
      // committed React state there so results are not stale.
    } catch (err) {
      if (abortRef.current.aborted) {
        setPhase("idle")
        setProgressLabel("Scan Aborted")
        addLog("warning", "AutoPwn scan aborted by user")
      } else {
        const msg = err instanceof Error ? err.message : "Unknown error"
        addLog("error", `AutoPwn scan failed: ${msg}`)
        setPhase("idle")
        setProgressLabel("Scan Failed")
      }
    } finally {
      setScanning(false)
    }
  }, [
    client,
    schema,
    config,
    projectUrl,
    addLog,
    runRecon,
    runDatabaseRls,
    runStorageScan,
    runAuthProbing,
    runEdgeFunctionDiscovery,
  ])

  // After a successful scan, persist + diff against the prior run
  useEffect(() => {
    if (phase !== "complete" || scanning || !projectUrl) return
    if (latestScan) return // already persisted this completion
    const record: ScanRecord = {
      schemaVersion: 1,
      projectUrl,
      keyType,
      timestamp: new Date().toISOString(),
      db: dbResults,
      storage: storageResults,
      auth: authResults,
      functions: functionResults,
    }
    saveScan(record)
    setLatestScan(record)
    setDiff(diffScans(previousScan, record))
  }, [
    phase,
    scanning,
    projectUrl,
    keyType,
    dbResults,
    storageResults,
    authResults,
    functionResults,
    previousScan,
    latestScan,
  ])

  // Export helpers --------------------------------------------------------
  const exportableScan = useMemo<ScanRecord | null>(() => {
    if (latestScan) return latestScan
    if (phase !== "complete" || !projectUrl) return null
    return {
      schemaVersion: 1,
      projectUrl,
      keyType,
      timestamp: new Date().toISOString(),
      db: dbResults,
      storage: storageResults,
      auth: authResults,
      functions: functionResults,
    }
  }, [
    latestScan,
    phase,
    projectUrl,
    keyType,
    dbResults,
    storageResults,
    authResults,
    functionResults,
  ])

  const handleExportMarkdown = useCallback(() => {
    if (!exportableScan) return
    const md = formatMarkdownReport(exportableScan)
    downloadFile(`${reportFilenameBase(exportableScan)}.md`, md, "text/markdown")
  }, [exportableScan])

  const handleExportJson = useCallback(() => {
    if (!exportableScan) return
    const json = JSON.stringify(exportableScan, null, 2)
    downloadFile(
      `${reportFilenameBase(exportableScan)}.json`,
      json,
      "application/json",
    )
  }, [exportableScan])

  const handleAbort = useCallback(() => {
    abortRef.current.aborted = true
    addLog("warning", "Aborting scan...")
  }, [addLog])

  // =========================================================================
  // Summary computation
  // =========================================================================

  const summary = {
    tablesReadable: dbResults.filter((r) => r.select === "allowed").length,
    tablesEmpty: dbResults.filter((r) => r.select === "empty").length,
    totalTables: dbResults.length,
    tablesWritable: dbResults.filter((r) => r.insert === "allowed").length,
    bucketsFound: storageResults.length,
    bucketsPublic: storageResults.filter((r) => r.public).length,
    bucketsListable: storageResults.filter((r) => r.listable === "allowed").length,
    authEnabled: authResults.filter((r) => r.status === "enabled").length,
    authTotal: authResults.length,
    functionsFound: functionResults.filter((r) => r.status === "found").length,
    functionsTotal: functionResults.length,
  }

  // =========================================================================
  // Render
  // =========================================================================

  if (!client || !schema) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Connect to a Supabase project to run the AutoPwn scanner.
        </CardContent>
      </Card>
    )
  }

  // Key-kind warning copy ---------------------------------------------------
  const keyBanner = (() => {
    switch (keyType) {
      case "service_role":
        return {
          tone: "danger" as const,
          title: "Service Role key in use",
          body:
            "This key bypasses Row Level Security. Findings here reflect a fully-privileged admin, NOT what an unauthenticated attacker would see. Use an anon or publishable key to assess real exposure.",
        }
      case "secret":
        return {
          tone: "danger" as const,
          title: "Secret key in use",
          body:
            "Server-side `sb_secret_…` keys grant elevated privileges. Findings reflect a privileged caller, not an external attacker. Re-run with an anon/publishable key to gauge real-world risk.",
        }
      case "publishable":
        return {
          tone: "info" as const,
          title: "Publishable key",
          body:
            "Browser-safe key. Probes here approximate an unauthenticated attacker's view.",
        }
      case "anon":
        return {
          tone: "info" as const,
          title: "Anon key",
          body:
            "Probes here approximate an unauthenticated attacker's view via PostgREST + RLS.",
        }
      default:
        return null
    }
  })()

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------------------- */}
      {/* Key-kind banner                                                     */}
      {/* ------------------------------------------------------------------- */}
      {keyBanner && (
        <div
          className={
            keyBanner.tone === "danger"
              ? "rounded-md border border-red-600/30 bg-red-600/5 p-3"
              : "rounded-md border border-blue-600/30 bg-blue-600/5 p-3"
          }
        >
          <div className="flex gap-2 items-start">
            <ShieldAlert
              className={
                keyBanner.tone === "danger"
                  ? "size-4 text-red-400 mt-0.5 shrink-0"
                  : "size-4 text-blue-400 mt-0.5 shrink-0"
              }
            />
            <div className="text-xs">
              <div
                className={
                  keyBanner.tone === "danger"
                    ? "font-medium text-red-300"
                    : "font-medium text-blue-300"
                }
              >
                {keyBanner.title}
              </div>
              <p className="text-muted-foreground mt-0.5">{keyBanner.body}</p>
            </div>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Configuration                                                       */}
      {/* ------------------------------------------------------------------- */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ShieldAlert className="size-4" />
            AutoPwn Scanner Configuration
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Phase toggles */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div className="flex items-center gap-2">
                <Database className="size-4 text-muted-foreground" />
                <Label htmlFor="toggle-rls" className="cursor-pointer">
                  Database RLS Testing
                </Label>
              </div>
              <Switch
                id="toggle-rls"
                checked={config.databaseRls}
                onCheckedChange={(v) => updateConfig("databaseRls", v)}
                disabled={scanning}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div className="flex items-center gap-2">
                <HardDrive className="size-4 text-muted-foreground" />
                <Label htmlFor="toggle-storage" className="cursor-pointer">
                  Storage Scanning
                </Label>
              </div>
              <Switch
                id="toggle-storage"
                checked={config.storageScan}
                onCheckedChange={(v) => updateConfig("storageScan", v)}
                disabled={scanning}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div className="flex items-center gap-2">
                <Key className="size-4 text-muted-foreground" />
                <Label htmlFor="toggle-auth" className="cursor-pointer">
                  Auth Probing
                </Label>
              </div>
              <Switch
                id="toggle-auth"
                checked={config.authProbing}
                onCheckedChange={(v) => updateConfig("authProbing", v)}
                disabled={scanning}
              />
            </div>

            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div className="flex items-center gap-2">
                <Zap className="size-4 text-muted-foreground" />
                <Label htmlFor="toggle-functions" className="cursor-pointer">
                  Edge Function Discovery
                </Label>
              </div>
              <Switch
                id="toggle-functions"
                checked={config.edgeFunctions}
                onCheckedChange={(v) => updateConfig("edgeFunctions", v)}
                disabled={scanning}
              />
            </div>
          </div>

          <Separator />

          {/* Concurrency */}
          <div className="flex items-end gap-4">
            <div className="space-y-1.5">
              <Label htmlFor="concurrency">Concurrency</Label>
              <Input
                id="concurrency"
                type="number"
                min={5}
                max={50}
                value={config.concurrency}
                onChange={(e) => {
                  const val = Math.min(50, Math.max(5, Number(e.target.value) || 10))
                  updateConfig("concurrency", val)
                }}
                className="w-24"
                disabled={scanning}
              />
            </div>
            <p className="text-xs text-muted-foreground pb-1">
              Number of concurrent requests (5-50)
            </p>
          </div>

          <Separator />

          {/* Write testing toggle */}
          <div className="space-y-2">
            <div className="flex items-center justify-between rounded-md border border-yellow-600/30 bg-yellow-600/5 px-3 py-2">
              <div className="flex items-center gap-2">
                <ShieldAlert className="size-4 text-yellow-500" />
                <Label htmlFor="toggle-write" className="cursor-pointer">
                  Write Testing
                </Label>
              </div>
              <Switch
                id="toggle-write"
                checked={config.writeTesting}
                onCheckedChange={(v) => updateConfig("writeTesting", v)}
                disabled={scanning}
              />
            </div>
            {config.writeTesting && (
              <p className="text-xs text-yellow-400 px-1">
                Enables INSERT/UPDATE/DELETE tests. This will attempt to write
                probe data to tables.
              </p>
            )}
          </div>

          <Separator />

          {/* Custom table names */}
          <div className="space-y-1.5">
            <Label htmlFor="custom-tables">Custom Table Names</Label>
            <Textarea
              id="custom-tables"
              placeholder="Enter additional table names (comma or newline separated)"
              value={config.customTables}
              onChange={(e) => updateConfig("customTables", e.target.value)}
              className="min-h-16 text-sm font-mono"
              disabled={scanning}
            />
            <p className="text-xs text-muted-foreground">
              These will be added to the tables discovered from the schema.
            </p>
          </div>

          {/* Wordlist + JS hint sources */}
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-muted-foreground" />
                <Label htmlFor="toggle-wordlist" className="cursor-pointer text-sm">
                  Curated wordlist ({TABLE_WORDLIST.length})
                </Label>
              </div>
              <Switch
                id="toggle-wordlist"
                checked={config.useBuiltinTableWordlist}
                onCheckedChange={(v) => updateConfig("useBuiltinTableWordlist", v)}
                disabled={scanning}
              />
            </div>
            <div className="flex items-center justify-between rounded-md border px-3 py-2">
              <div className="flex items-center gap-2">
                <Sparkles className="size-4 text-muted-foreground" />
                <Label htmlFor="toggle-js-hints" className="cursor-pointer text-sm">
                  JS-discovered ({hints.tables.length}/{hints.functions.length})
                </Label>
              </div>
              <Switch
                id="toggle-js-hints"
                checked={config.useJsHints}
                onCheckedChange={(v) => updateConfig("useJsHints", v)}
                disabled={scanning || (hints.tables.length === 0 && hints.functions.length === 0)}
              />
            </div>
          </div>
          <p className="text-xs text-muted-foreground -mt-1">
            JS-discovered identifiers come from <code>from(&apos;…&apos;)</code> /{" "}
            <code>functions.invoke(&apos;…&apos;)</code> calls captured by the
            URL extractor.
          </p>

          <Separator />

          {/* Start / Abort button */}
          <div className="flex items-center gap-3">
            {!scanning ? (
              <Button onClick={handleStartScan} className="gap-2">
                <Play className="size-4" />
                Start Scan
              </Button>
            ) : (
              <Button
                variant="destructive"
                onClick={handleAbort}
                className="gap-2"
              >
                <Square className="size-4" />
                Abort
              </Button>
            )}

            {phase !== "idle" && !scanning && (
              <Badge variant="outline" className="text-xs">
                {phase === "complete" ? "Completed" : progressLabel}
              </Badge>
            )}
          </div>
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------------- */}
      {/* Progress                                                            */}
      {/* ------------------------------------------------------------------- */}
      {(scanning || phase !== "idle") && (
        <Card>
          <CardContent className="pt-6 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">{progressLabel}</span>
              <span className="text-muted-foreground">{progress}%</span>
            </div>
            <Progress value={progress} />
            {currentItem && (
              <p className="text-xs text-muted-foreground truncate">
                {currentItem}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Summary                                                             */}
      {/* ------------------------------------------------------------------- */}
      {phase === "complete" && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2">
                <ShieldCheck className="size-4" />
                Scan Summary
              </span>
              <span className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExportMarkdown}
                  disabled={!exportableScan}
                  className="gap-1.5"
                >
                  <Download className="size-3.5" />
                  Markdown
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExportJson}
                  disabled={!exportableScan}
                  className="gap-1.5"
                >
                  <Download className="size-3.5" />
                  JSON
                </Button>
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {dbResults.length > 0 && (
                <>
                  <Badge
                    className={
                      summary.tablesReadable > 0
                        ? "bg-red-600/20 text-red-400 border-red-600/30 hover:bg-red-600/20"
                        : "bg-green-600/20 text-green-400 border-green-600/30 hover:bg-green-600/20"
                    }
                  >
                    {summary.tablesReadable}/{summary.totalTables} tables expose data
                  </Badge>
                  {summary.tablesEmpty > 0 && (
                    <Badge className="bg-yellow-600/20 text-yellow-400 border-yellow-600/30 hover:bg-yellow-600/20">
                      {summary.tablesEmpty} return 200 OK (empty)
                    </Badge>
                  )}
                  {config.writeTesting && (
                    <Badge
                      className={
                        summary.tablesWritable > 0
                          ? "bg-red-600/20 text-red-400 border-red-600/30 hover:bg-red-600/20"
                          : "bg-green-600/20 text-green-400 border-green-600/30 hover:bg-green-600/20"
                      }
                    >
                      {summary.tablesWritable}/{summary.totalTables} tables writable
                    </Badge>
                  )}
                </>
              )}

              {storageResults.length > 0 && (
                <>
                  <Badge variant="secondary">
                    {summary.bucketsFound} bucket(s) found
                  </Badge>
                  {summary.bucketsPublic > 0 && (
                    <Badge className="bg-yellow-600/20 text-yellow-400 border-yellow-600/30 hover:bg-yellow-600/20">
                      {summary.bucketsPublic} public bucket(s)
                    </Badge>
                  )}
                  {summary.bucketsListable > 0 && (
                    <Badge className="bg-yellow-600/20 text-yellow-400 border-yellow-600/30 hover:bg-yellow-600/20">
                      {summary.bucketsListable} listable bucket(s)
                    </Badge>
                  )}
                </>
              )}

              {authResults.length > 0 && (
                <Badge
                  className={
                    summary.authEnabled > 0
                      ? "bg-yellow-600/20 text-yellow-400 border-yellow-600/30 hover:bg-yellow-600/20"
                      : "bg-green-600/20 text-green-400 border-green-600/30 hover:bg-green-600/20"
                  }
                >
                  {summary.authEnabled}/{summary.authTotal} auth features open
                </Badge>
              )}

              {functionResults.length > 0 && (
                <Badge variant="secondary">
                  {summary.functionsFound}/{summary.functionsTotal} functions found
                </Badge>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Diff vs previous scan                                               */}
      {/* ------------------------------------------------------------------- */}
      {phase === "complete" && diff && previousScan && diffHasChanges(diff) && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="size-4" />
              Changes since {new Date(previousScan.timestamp).toLocaleString()}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {diff.newReadable.length > 0 && (
              <div>
                <Badge className="bg-red-600/20 text-red-400 border-red-600/30 mr-2">
                  +{diff.newReadable.length} newly readable
                </Badge>
                <span className="text-xs text-muted-foreground font-mono">
                  {diff.newReadable.join(", ")}
                </span>
              </div>
            )}
            {diff.noLongerReadable.length > 0 && (
              <div>
                <Badge className="bg-green-600/20 text-green-400 border-green-600/30 mr-2">
                  -{diff.noLongerReadable.length} fixed (no longer readable)
                </Badge>
                <span className="text-xs text-muted-foreground font-mono">
                  {diff.noLongerReadable.join(", ")}
                </span>
              </div>
            )}
            {diff.newWritable.length > 0 && (
              <div>
                <Badge className="bg-red-600/20 text-red-400 border-red-600/30 mr-2">
                  +{diff.newWritable.length} newly writable
                </Badge>
                <span className="text-xs text-muted-foreground font-mono">
                  {diff.newWritable.join(", ")}
                </span>
              </div>
            )}
            {diff.noLongerWritable.length > 0 && (
              <div>
                <Badge className="bg-green-600/20 text-green-400 border-green-600/30 mr-2">
                  -{diff.noLongerWritable.length} fixed (no longer writable)
                </Badge>
                <span className="text-xs text-muted-foreground font-mono">
                  {diff.noLongerWritable.join(", ")}
                </span>
              </div>
            )}
            {diff.newPublicBuckets.length > 0 && (
              <div>
                <Badge className="bg-yellow-600/20 text-yellow-400 border-yellow-600/30 mr-2">
                  +{diff.newPublicBuckets.length} new public bucket(s)
                </Badge>
                <span className="text-xs text-muted-foreground font-mono">
                  {diff.newPublicBuckets.join(", ")}
                </span>
              </div>
            )}
            {diff.newListableBuckets.length > 0 && (
              <div>
                <Badge className="bg-yellow-600/20 text-yellow-400 border-yellow-600/30 mr-2">
                  +{diff.newListableBuckets.length} new listable bucket(s)
                </Badge>
                <span className="text-xs text-muted-foreground font-mono">
                  {diff.newListableBuckets.join(", ")}
                </span>
              </div>
            )}
            {diff.newAuthEnabled.length > 0 && (
              <div>
                <Badge className="bg-yellow-600/20 text-yellow-400 border-yellow-600/30 mr-2">
                  +{diff.newAuthEnabled.length} auth feature(s) opened
                </Badge>
                <span className="text-xs text-muted-foreground font-mono">
                  {diff.newAuthEnabled.join(", ")}
                </span>
              </div>
            )}
            {diff.newFunctions.length > 0 && (
              <div>
                <Badge variant="secondary" className="mr-2">
                  +{diff.newFunctions.length} new function(s)
                </Badge>
                <span className="text-xs text-muted-foreground font-mono">
                  {diff.newFunctions.join(", ")}
                </span>
              </div>
            )}
          </CardContent>
        </Card>
      )}
      {phase === "complete" && diff && previousScan && !diffHasChanges(diff) && (
        <Card>
          <CardContent className="py-3 text-xs text-muted-foreground flex items-center gap-2">
            <History className="size-3.5" />
            No changes since previous scan ({new Date(previousScan.timestamp).toLocaleString()}).
          </CardContent>
        </Card>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Results                                                             */}
      {/* ------------------------------------------------------------------- */}
      {(dbResults.length > 0 ||
        storageResults.length > 0 ||
        authResults.length > 0 ||
        functionResults.length > 0) && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Shield className="size-4" />
                Detailed Results
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-1">
              {/* ----------------------------------------------------------- */}
              {/* Recon Results                                                */}
              {/* ----------------------------------------------------------- */}
              <ResultSection
                title="Reconnaissance"
                icon={Database}
                count={
                  (schema?.tables.length ?? 0) +
                  (schema?.views.length ?? 0) +
                  (schema?.functions.length ?? 0)
                }
              >
                <div className="grid grid-cols-3 gap-4 pt-2 text-sm">
                  <div className="text-center">
                    <div className="text-2xl font-bold">
                      {schema?.tables.length ?? 0}
                    </div>
                    <div className="text-xs text-muted-foreground">Tables</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">
                      {schema?.views.length ?? 0}
                    </div>
                    <div className="text-xs text-muted-foreground">Views</div>
                  </div>
                  <div className="text-center">
                    <div className="text-2xl font-bold">
                      {schema?.functions.length ?? 0}
                    </div>
                    <div className="text-xs text-muted-foreground">Functions</div>
                  </div>
                </div>
              </ResultSection>

              {/* ----------------------------------------------------------- */}
              {/* Database RLS Results                                         */}
              {/* ----------------------------------------------------------- */}
              {dbResults.length > 0 && (
                <>
                  <Separator />
                  <ResultSection
                    title="Database RLS Testing"
                    icon={Database}
                    count={dbResults.length}
                  >
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm table-fixed">
                        <thead>
                          <tr className="border-b text-xs text-muted-foreground">
                            <th className="py-2 pr-2 text-left font-medium w-[36%]">
                              Table
                            </th>
                            <th className="py-2 px-1 text-center font-medium w-[16%]">
                              SELECT
                            </th>
                            <th className="py-2 px-1 text-center font-medium w-[16%]">
                              INSERT
                            </th>
                            <th className="py-2 px-1 text-center font-medium w-[16%]">
                              UPDATE
                            </th>
                            <th className="py-2 px-1 text-center font-medium w-[16%]">
                              DELETE
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {dbResults.map((r) => (
                            <tr
                              key={r.name}
                              className="border-b border-border/50"
                            >
                              <td className="py-2 pr-2 font-mono text-xs truncate" title={r.name}>
                                {r.name}
                              </td>
                              <td className="py-2 px-2 text-center">
                                <StatusBadge status={r.select} />
                              </td>
                              <td className="py-2 px-2 text-center">
                                <StatusBadge status={r.insert} />
                              </td>
                              <td className="py-2 px-2 text-center">
                                <StatusBadge status={r.update} />
                              </td>
                              <td className="py-2 px-2 text-center">
                                <StatusBadge status={r.delete} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </ResultSection>
                </>
              )}

              {/* ----------------------------------------------------------- */}
              {/* Storage Results                                              */}
              {/* ----------------------------------------------------------- */}
              {storageResults.length > 0 && (
                <>
                  <Separator />
                  <ResultSection
                    title="Storage Scanning"
                    icon={HardDrive}
                    count={storageResults.length}
                  >
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm table-fixed">
                        <thead>
                          <tr className="border-b text-xs text-muted-foreground">
                            <th className="py-2 pr-2 text-left font-medium w-[34%]">
                              Bucket
                            </th>
                            <th className="py-2 px-1 text-center font-medium w-[22%]">
                              Public
                            </th>
                            <th className="py-2 px-1 text-center font-medium w-[22%]">
                              Listable
                            </th>
                            <th className="py-2 px-1 text-center font-medium w-[22%]">
                              Files Found
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {storageResults.map((r) => (
                            <tr
                              key={r.name}
                              className="border-b border-border/50"
                            >
                              <td className="py-2 pr-2 font-mono text-xs truncate" title={r.name}>
                                {r.name}
                              </td>
                              <td className="py-2 px-2 text-center">
                                <Badge
                                  className={
                                    r.public
                                      ? "bg-yellow-600/20 text-yellow-400 border-yellow-600/30 hover:bg-yellow-600/20"
                                      : "bg-green-600/20 text-green-400 border-green-600/30 hover:bg-green-600/20"
                                  }
                                >
                                  {r.public ? "YES" : "NO"}
                                </Badge>
                              </td>
                              <td className="py-2 px-2 text-center">
                                <StatusBadge status={r.listable} />
                              </td>
                              <td className="py-2 px-2 text-center text-xs text-muted-foreground">
                                {r.fileCount !== undefined ? r.fileCount : "-"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </ResultSection>
                </>
              )}

              {/* ----------------------------------------------------------- */}
              {/* Auth Results                                                 */}
              {/* ----------------------------------------------------------- */}
              {authResults.length > 0 && (
                <>
                  <Separator />
                  <ResultSection
                    title="Auth Probing"
                    icon={Key}
                    count={authResults.length}
                  >
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm table-fixed">
                        <thead>
                          <tr className="border-b text-xs text-muted-foreground">
                            <th className="py-2 pr-2 text-left font-medium w-[25%]">
                              Feature
                            </th>
                            <th className="py-2 px-1 text-center font-medium w-[20%]">
                              Status
                            </th>
                            <th className="py-2 px-2 text-left font-medium w-[55%]">
                              Details
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {authResults.map((r) => (
                            <tr
                              key={r.feature}
                              className="border-b border-border/50"
                            >
                              <td className="py-2 pr-2 text-xs font-medium truncate">
                                {r.feature}
                              </td>
                              <td className="py-2 px-1 text-center">
                                <StatusBadge status={r.status} />
                              </td>
                              <td className="py-2 px-2 text-xs text-muted-foreground">
                                <div className="truncate" title={r.details ?? "-"}>
                                  {r.details ?? "-"}
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </ResultSection>
                </>
              )}

              {/* ----------------------------------------------------------- */}
              {/* Edge Function Results                                        */}
              {/* ----------------------------------------------------------- */}
              {functionResults.length > 0 && (
                <>
                  <Separator />
                  <ResultSection
                    title="Edge Function Discovery"
                    icon={Zap}
                    count={functionResults.filter((r) => r.status === "found").length}
                  >
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm table-fixed">
                        <thead>
                          <tr className="border-b text-xs text-muted-foreground">
                            <th className="py-2 pr-2 text-left font-medium w-[60%]">
                              Name
                            </th>
                            <th className="py-2 px-1 text-center font-medium w-[40%]">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {functionResults.map((r) => (
                            <tr
                              key={r.name}
                              className="border-b border-border/50"
                            >
                              <td className="py-2 pr-2 font-mono text-xs truncate" title={r.name}>
                                {r.name}
                              </td>
                              <td className="py-2 px-2 text-center">
                                <StatusBadge status={r.status} />
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </ResultSection>
                </>
              )}
            </CardContent>
          </Card>
        )}
    </div>
  )
}
