"use client"

import { useCallback, useState } from "react"
import { Plus, X, Play, Zap } from "lucide-react"
import { Highlight, themes } from "prism-react-renderer"

import { useSupabase } from "@/lib/supabase-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent } from "@/components/ui/card"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type HeaderRow = {
  id: string
  key: string
  value: string
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createHeaderRow(): HeaderRow {
  return {
    id: crypto.randomUUID(),
    key: "",
    value: "",
  }
}

function JsonResult({ json }: { json: string }) {
  return (
    <Highlight theme={themes.vsDark} code={json} language="json">
      {({ style, tokens, getLineProps, getTokenProps }) => (
        <pre
          style={style}
          className="text-xs p-3 rounded overflow-x-auto max-h-96"
        >
          {tokens.map((line, i) => (
            <div key={i} {...getLineProps({ line })}>
              {line.map((token, key) => (
                <span key={key} {...getTokenProps({ token })} />
              ))}
            </div>
          ))}
        </pre>
      )}
    </Highlight>
  )
}

// ---------------------------------------------------------------------------
// EdgeFunctions Component
// ---------------------------------------------------------------------------

export function EdgeFunctions() {
  const { client, addLog } = useSupabase()

  // -- State ----------------------------------------------------------------
  const [functionName, setFunctionName] = useState("")
  const [bodyJson, setBodyJson] = useState("")
  const [headerRows, setHeaderRows] = useState<HeaderRow[]>([])
  const [result, setResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // -- Header row management ------------------------------------------------

  const addHeaderRow = useCallback(() => {
    setHeaderRows((prev) => [...prev, createHeaderRow()])
  }, [])

  const removeHeaderRow = useCallback((id: string) => {
    setHeaderRows((prev) => prev.filter((r) => r.id !== id))
  }, [])

  const updateHeaderRow = useCallback(
    (id: string, field: "key" | "value", value: string) => {
      setHeaderRows((prev) =>
        prev.map((r) => (r.id === id ? { ...r, [field]: value } : r)),
      )
    },
    [],
  )

  // -- Invoke ---------------------------------------------------------------

  const handleInvoke = useCallback(async () => {
    if (!client) return

    const name = functionName.trim()
    if (!name) {
      addLog("warning", "Function name is required")
      return
    }

    // Parse body
    let body: unknown = undefined
    if (bodyJson.trim()) {
      try {
        body = JSON.parse(bodyJson)
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Invalid JSON in request body"
        addLog("error", `Invalid JSON body: ${msg}`)
        return
      }
    }

    // Build headers object from key/value rows
    const headers = Object.fromEntries(
      headerRows.filter((r) => r.key).map((r) => [r.key, r.value]),
    )

    setLoading(true)
    setResult(null)

    try {
      addLog("info", `Invoking edge function: ${name}`, {
        body,
        headers,
      })

      const { data, error } = await client.functions.invoke(name, {
        body: body !== undefined ? JSON.parse(JSON.stringify(body)) : undefined,
        headers: Object.keys(headers).length > 0 ? headers : undefined,
      })

      if (error) {
        addLog("error", `Edge function error: ${error.message}`, error)
        setResult(JSON.stringify({ error: error.message }, null, 2))
      } else {
        addLog("success", `Edge function "${name}" responded`, data)
        // Handle different response types
        let displayData: unknown
        if (data instanceof Blob) {
          const text = await data.text()
          try {
            displayData = JSON.parse(text)
          } catch {
            displayData = text
          }
        } else {
          displayData = data
        }
        setResult(JSON.stringify(displayData, null, 2))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      addLog("error", `Edge function exception: ${msg}`, err)
      setResult(JSON.stringify({ error: msg }, null, 2))
    } finally {
      setLoading(false)
    }
  }, [client, functionName, bodyJson, headerRows, addLog])

  // =========================================================================
  // Render
  // =========================================================================

  if (!client) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Connect to a Supabase project first.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Zap className="size-4" />
        <span>Invoke Supabase Edge Functions</span>
      </div>

      {/* Function Name */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="fn-name">Function Name</Label>
            <Input
              id="fn-name"
              placeholder="e.g. hello-world"
              value={functionName}
              onChange={(e) => setFunctionName(e.target.value)}
            />
          </div>

          {/* Request Body */}
          <div className="space-y-1.5">
            <Label htmlFor="fn-body">Request Body (JSON)</Label>
            <Textarea
              id="fn-body"
              className="font-mono text-sm min-h-24"
              placeholder={'{"key": "value"}'}
              value={bodyJson}
              onChange={(e) => setBodyJson(e.target.value)}
            />
          </div>

          {/* Custom Headers */}
          <div className="space-y-2">
            <Label>Custom Headers</Label>
            {headerRows.map((row) => (
              <div key={row.id} className="flex items-center gap-2">
                <Input
                  className="flex-1"
                  placeholder="Header name"
                  value={row.key}
                  onChange={(e) =>
                    updateHeaderRow(row.id, "key", e.target.value)
                  }
                />
                <Input
                  className="flex-1"
                  placeholder="Header value"
                  value={row.value}
                  onChange={(e) =>
                    updateHeaderRow(row.id, "value", e.target.value)
                  }
                />
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => removeHeaderRow(row.id)}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={addHeaderRow}>
              <Plus className="h-4 w-4 mr-1" />
              Add Header
            </Button>
          </div>

          {/* Invoke Button */}
          <Button
            onClick={handleInvoke}
            disabled={loading || !functionName.trim()}
          >
            {loading ? (
              <Play className="h-4 w-4 mr-1 animate-spin" />
            ) : (
              <Play className="h-4 w-4 mr-1" />
            )}
            {loading ? "Invoking..." : "Invoke"}
          </Button>
        </CardContent>
      </Card>

      {/* Response Display */}
      {result !== null && (
        <Card>
          <CardContent className="p-3">
            <Label className="text-xs text-muted-foreground mb-2 block">
              Response
            </Label>
            <JsonResult json={result} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
