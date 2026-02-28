"use client"

import { useCallback, useRef, useState } from "react"
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
} from "lucide-react"

import { useSupabase } from "@/lib/supabase-context"
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

type AccessStatus = "allowed" | "denied" | "error"
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
          {status.toUpperCase()}
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
        <Badge className="bg-yellow-600/20 text-yellow-400 border-yellow-600/30 hover:bg-yellow-600/20">
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
  const { client, schema, addLog } = useSupabase()

  // -- Config state ---------------------------------------------------------
  const [config, setConfig] = useState<ScanConfig>({
    databaseRls: true,
    storageScan: true,
    authProbing: true,
    edgeFunctions: false,
    concurrency: 10,
    writeTesting: false,
    customTables: "",
  })

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

    const allTables = [...new Set([...schema.tables, ...customTableNames])]
    const totalTables = allTables.length

    if (totalTables === 0) {
      addLog("warning", "No tables to test for RLS")
      setProgress(calculateProgress("database", 100))
      return
    }

    const results: ScanResult[] = []

    // Build tasks for SELECT testing
    const selectTasks = allTables.map((table, idx) => {
      return async (): Promise<ScanResult> => {
        if (abortRef.current.aborted) {
          return { name: table, select: "error", details: "Aborted" }
        }

        setCurrentItem(`SELECT on ${table} (${idx + 1}/${totalTables})`)

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
            result.select = "allowed"
            const rowCount = Array.isArray(data) ? data.length : 0
            result.details = `SELECT returned ${rowCount} row(s)`
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
            setCurrentItem(`INSERT on ${table} (${idx + 1}/${totalTables})`)
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
            setCurrentItem(`DELETE on ${table} (${idx + 1}/${totalTables})`)
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
    })

    // Run SELECT tasks in batches
    const batchResults = await runInBatches(
      selectTasks,
      config.concurrency,
      abortRef.current,
    )

    for (const r of batchResults) {
      if (r && typeof r === "object" && "name" in r) {
        results.push(r as ScanResult)
      }
    }

    setDbResults(results)

    const allowedCount = results.filter((r) => r.select === "allowed").length
    addLog(
      allowedCount > 0 ? "warning" : "success",
      `Database RLS: ${allowedCount}/${results.length} tables allow SELECT without RLS`,
    )

    setProgress(calculateProgress("database", 100))
  }, [client, schema, config, addLog, calculateProgress])

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
      const probeEmail = `supabase-pwn-${crypto.randomUUID().slice(0, 8)}@j5.no`
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
    if (!client) return

    setPhase("functions")
    setProgressLabel("Edge Function Discovery")

    const commonNames = [
      "hello",
      "test",
      "api",
      "webhook",
      "stripe-webhook",
      "send-email",
      "notify",
      "process",
      "auth",
      "admin",
    ]

    const results: FunctionResult[] = []
    const totalFunctions = commonNames.length

    const tasks = commonNames.map((name, idx) => {
      return async (): Promise<FunctionResult> => {
        if (abortRef.current.aborted) {
          return { name, status: "error" }
        }

        setCurrentItem(
          `Probing function: ${name} (${idx + 1}/${totalFunctions})`,
        )

        try {
          const { error } = await client.functions.invoke(name)

          if (error) {
            const msg = (error.message ?? "").toLowerCase()
            // FunctionsHttpError with 404-like messages or FunctionsRelayError
            if (
              msg.includes("404") ||
              msg.includes("not found") ||
              msg.includes("relay")
            ) {
              return { name, status: "not_found" }
            }
            // Other errors mean the function exists but errored
            return { name, status: "found" }
          }

          return { name, status: "found" }
        } catch {
          return { name, status: "error" }
        }
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
  }, [client, config.concurrency, addLog, calculateProgress])

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
    addLog,
    runRecon,
    runDatabaseRls,
    runStorageScan,
    runAuthProbing,
    runEdgeFunctionDiscovery,
  ])

  const handleAbort = useCallback(() => {
    abortRef.current.aborted = true
    addLog("warning", "Aborting scan...")
  }, [addLog])

  // =========================================================================
  // Summary computation
  // =========================================================================

  const summary = {
    tablesReadable: dbResults.filter((r) => r.select === "allowed").length,
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

  return (
    <div className="space-y-4">
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
            <CardTitle className="flex items-center gap-2 text-base">
              <ShieldCheck className="size-4" />
              Scan Summary
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
                    {summary.tablesReadable}/{summary.totalTables} tables readable
                  </Badge>
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
