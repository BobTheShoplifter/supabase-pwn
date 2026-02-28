"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Plus, X, Play, Trash2, Wand2, Pencil, Search, Loader2 } from "lucide-react"
import { Highlight, themes } from "prism-react-renderer"

import { useSupabase } from "@/lib/supabase-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { ScrollArea } from "@/components/ui/scroll-area"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type FilterRow = {
  id: string
  column: string
  operator: string
  value: string
}

const FILTER_OPERATORS = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "like",
  "ilike",
  "is",
  "in",
  "contains",
] as const

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createFilterRow(): FilterRow {
  return {
    id: crypto.randomUUID(),
    column: "",
    operator: "eq",
    value: "",
  }
}

// Column names to skip in auto-fill (typically auto-generated)
const AUTO_SKIP_COLUMNS = new Set(["id", "created_at", "updated_at", "deleted_at"])

function generateFakeValue(type: string, columnName: string): unknown {
  const t = (type ?? "").toLowerCase()
  const n = (columnName ?? "").toLowerCase()

  // Column-name-based hints
  if (n.includes("email")) return `pwn-${crypto.randomUUID().slice(0, 8)}@j5.no`
  if (n.includes("phone")) return "+15550" + String(Math.floor(Math.random() * 100000)).padStart(5, "0")
  if (n.includes("url") || n.includes("website") || n.includes("link")) return "https://example.com"
  if (n.includes("first") && n.includes("name")) return "Jane"
  if (n.includes("last") && n.includes("name")) return "Doe"
  if (n.includes("name") && !n.includes("file")) return "Test User"
  if (n.includes("address") || n.includes("street")) return "123 Test Street"
  if (n.includes("city")) return "Testville"
  if (n.includes("country")) return "US"
  if (n.includes("zip") || n.includes("postal")) return "12345"
  if (n.includes("description") || n.includes("bio") || n.includes("summary")) return "Auto-generated test description"
  if (n.includes("title") || n.includes("subject")) return "Test Title"
  if (n.includes("status")) return "active"
  if (n.includes("role")) return "user"
  if (n.includes("password") || n.includes("secret")) return "TestPassword123!"
  if (n.includes("amount") || n.includes("price") || n.includes("cost") || n.includes("total")) return 99.99
  if (n.includes("quantity") || n.includes("count")) return 1
  if (n.includes("color") || n.includes("colour")) return "#ff6600"
  if (n.includes("image") || n.includes("avatar") || n.includes("photo") || n.includes("logo")) return "https://example.com/image.jpg"
  if (n.includes("lat")) return 37.7749
  if (n.includes("lng") || n.includes("lon")) return -122.4194
  if (n.includes("age")) return 25
  if (n.includes("rating") || n.includes("score")) return 4.5

  // Type-based generation
  if (t === "uuid") return crypto.randomUUID()
  if (t === "integer" || t === "int4" || t === "int8" || t === "bigint") return Math.floor(Math.random() * 1000)
  if (t === "smallint" || t === "int2") return Math.floor(Math.random() * 100)
  if (t === "boolean" || t === "bool") return true
  if (t === "text" || t === "character varying" || t === "varchar" || t === "string") return "test_" + crypto.randomUUID().slice(0, 8)
  if (t.includes("timestamp") || t === "timestamptz") return new Date().toISOString()
  if (t === "date") return new Date().toISOString().split("T")[0]
  if (t === "time" || t.includes("time without") || t === "timetz") return "12:00:00"
  if (t === "double precision" || t === "float8" || t === "real" || t === "float4" || t === "numeric" || t === "decimal" || t === "number") return Math.round(Math.random() * 10000) / 100
  if (t === "json" || t === "jsonb") return {}
  if (t.startsWith("_") || t === "array") return []
  if (t === "inet" || t === "cidr") return "192.168.1.1"
  if (t === "macaddr") return "00:11:22:33:44:55"

  return "test_value"
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
// Filter Builder (shared between Select, Update, Delete)
// ---------------------------------------------------------------------------

function FilterBuilder({
  filters,
  columns,
  onAdd,
  onRemove,
  onChange,
}: {
  filters: FilterRow[]
  columns: { name: string; type: string; required: boolean }[]
  onAdd: () => void
  onRemove: (id: string) => void
  onChange: (id: string, field: keyof FilterRow, value: string) => void
}) {
  return (
    <div className="space-y-2">
      <Label>Filters</Label>
      {filters.map((filter) => (
        <div key={filter.id} className="flex items-center gap-2">
          <Select
            value={filter.column}
            onValueChange={(v) => onChange(filter.id, "column", v)}
          >
            <SelectTrigger className="w-[160px]">
              <SelectValue placeholder="Column" />
            </SelectTrigger>
            <SelectContent>
              {columns.map((col) => (
                <SelectItem key={col.name} value={col.name}>
                  {col.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Select
            value={filter.operator}
            onValueChange={(v) => onChange(filter.id, "operator", v)}
          >
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Operator" />
            </SelectTrigger>
            <SelectContent>
              {FILTER_OPERATORS.map((op) => (
                <SelectItem key={op} value={op}>
                  {op}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          <Input
            className="flex-1"
            placeholder="Value"
            value={filter.value}
            onChange={(e) => onChange(filter.id, "value", e.target.value)}
          />

          <Button
            variant="ghost"
            size="icon"
            onClick={() => onRemove(filter.id)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      ))}

      <Button variant="outline" size="sm" onClick={onAdd}>
        <Plus className="h-4 w-4 mr-1" />
        Add Filter
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// useFilterState hook
// ---------------------------------------------------------------------------

function useFilterState() {
  const [filters, setFilters] = useState<FilterRow[]>([])

  const addFilter = useCallback(() => {
    setFilters((prev) => [...prev, createFilterRow()])
  }, [])

  const removeFilter = useCallback((id: string) => {
    setFilters((prev) => prev.filter((f) => f.id !== id))
  }, [])

  const changeFilter = useCallback(
    (id: string, field: keyof FilterRow, value: string) => {
      setFilters((prev) =>
        prev.map((f) => (f.id === id ? { ...f, [field]: value } : f))
      )
    },
    []
  )

  const resetFilters = useCallback(() => {
    setFilters([])
  }, [])

  return { filters, setFilters, addFilter, removeFilter, changeFilter, resetFilters }
}

// ---------------------------------------------------------------------------
// Select Tab
// ---------------------------------------------------------------------------

function SelectTab({
  table,
  columns,
  onSendToUpdate,
}: {
  table: string
  columns: { name: string; type: string; required: boolean }[]
  onSendToUpdate?: (row: Record<string, unknown>) => void
}) {
  const { client, addLog } = useSupabase()
  const { filters, addFilter, removeFilter, changeFilter } = useFilterState()

  const [selectColumns, setSelectColumns] = useState("*")
  const [orderByColumn, setOrderByColumn] = useState("")
  const [ascending, setAscending] = useState(true)
  const [limit, setLimit] = useState(10)
  const [result, setResult] = useState<string | null>(null)
  const [rowCount, setRowCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  const handleExecute = useCallback(async () => {
    if (!client) return
    setLoading(true)
    setResult(null)
    setRowCount(null)

    try {
      addLog("info", `SELECT from "${table}" — columns: ${selectColumns}`)

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query: any = client.from(table).select(selectColumns)

      for (const filter of filters) {
        if (!filter.column || !filter.operator) continue
        query = query[filter.operator](filter.column, filter.value)
      }

      if (orderByColumn) {
        query = query.order(orderByColumn, { ascending })
      }

      query = query.limit(Math.min(Math.max(1, limit), 10000))

      const { data, error } = await query

      if (error) {
        addLog("error", `SELECT error: ${error.message}`, error)
        setResult(JSON.stringify(error, null, 2))
        setRowCount(null)
      } else {
        const rows = Array.isArray(data) ? data.length : 0
        addLog("success", `SELECT returned ${rows} row(s)`, data)
        setResult(JSON.stringify(data, null, 2))
        setRowCount(rows)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      addLog("error", `SELECT exception: ${msg}`, err)
      setResult(JSON.stringify({ error: msg }, null, 2))
    } finally {
      setLoading(false)
    }
  }, [client, table, selectColumns, filters, orderByColumn, ascending, limit, addLog])

  return (
    <div className="space-y-4">
      {/* Column selector */}
      <div className="space-y-2">
        <Label htmlFor="select-columns">Columns</Label>
        <Input
          id="select-columns"
          placeholder="* or col1, col2, col3"
          value={selectColumns}
          onChange={(e) => setSelectColumns(e.target.value)}
        />
      </div>

      {/* Filters */}
      <FilterBuilder
        filters={filters}
        columns={columns}
        onAdd={addFilter}
        onRemove={removeFilter}
        onChange={changeFilter}
      />

      {/* Order by */}
      <div className="flex items-end gap-2">
        <div className="space-y-2 flex-1">
          <Label>Order By</Label>
          <Select value={orderByColumn} onValueChange={setOrderByColumn}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="None" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">None</SelectItem>
              {columns.map((col) => (
                <SelectItem key={col.name} value={col.name}>
                  {col.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Direction</Label>
          <Select
            value={ascending ? "asc" : "desc"}
            onValueChange={(v) => setAscending(v === "asc")}
          >
            <SelectTrigger className="w-[100px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="asc">ASC</SelectItem>
              <SelectItem value="desc">DESC</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Limit */}
      <div className="space-y-2">
        <Label htmlFor="select-limit">Limit</Label>
        <Input
          id="select-limit"
          type="number"
          min={1}
          max={10000}
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value) || 10)}
          className="w-[120px]"
        />
      </div>

      {/* Execute */}
      <Button onClick={handleExecute} disabled={loading}>
        <Play className="h-4 w-4 mr-1" />
        {loading ? "Executing..." : "Execute"}
      </Button>

      {/* Results */}
      {result !== null && (
        <Card>
          <CardContent className="p-3">
            {rowCount !== null && (
              <div className="mb-2">
                <Badge variant="secondary" className="text-xs">
                  {rowCount} row{rowCount !== 1 ? "s" : ""}
                </Badge>
              </div>
            )}
            <ScrollArea className="max-h-96">
              {onSendToUpdate && rowCount && rowCount > 0 ? (
                <div className="space-y-2">
                  {(() => {
                    try {
                      const rows = JSON.parse(result)
                      if (!Array.isArray(rows)) return <JsonResult json={result} />
                      return rows.map((row: Record<string, unknown>, i: number) => (
                        <div key={i} className="group relative">
                          <JsonResult json={JSON.stringify(row, null, 2)} />
                          <Button
                            variant="secondary"
                            size="sm"
                            className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={() => onSendToUpdate(row)}
                          >
                            <Pencil className="h-3 w-3 mr-1" />
                            Edit
                          </Button>
                        </div>
                      ))
                    } catch {
                      return <JsonResult json={result} />
                    }
                  })()}
                </div>
              ) : (
                <JsonResult json={result} />
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Insert Tab
// ---------------------------------------------------------------------------

function InsertTab({
  table,
  columns,
}: {
  table: string
  columns: { name: string; type: string; required: boolean }[]
}) {
  const { client, addLog } = useSupabase()
  const [jsonData, setJsonData] = useState("")
  const [result, setResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const placeholder = useMemo(() => {
    if (columns.length === 0) return '{\n  "column": "value"\n}'
    const example: Record<string, string> = {}
    for (const col of columns) {
      example[col.name] = col.type === "integer" || col.type === "bigint"
        ? "0"
        : col.type === "boolean"
          ? "true"
          : `"example_${col.type}"`
    }
    return JSON.stringify(example, null, 2)
  }, [columns])

  const handleInsert = useCallback(async () => {
    if (!client || !jsonData.trim()) return
    setLoading(true)
    setResult(null)

    try {
      const parsed = JSON.parse(jsonData)
      addLog("info", `INSERT into "${table}"`, parsed)

      const { data, error } = await client.from(table).insert(parsed).select()

      if (error) {
        addLog("error", `INSERT error: ${error.message}`, error)
        setResult(JSON.stringify(error, null, 2))
      } else {
        addLog("success", `INSERT succeeded`, data)
        setResult(JSON.stringify(data, null, 2))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      addLog("error", `INSERT exception: ${msg}`, err)
      setResult(JSON.stringify({ error: msg }, null, 2))
    } finally {
      setLoading(false)
    }
  }, [client, table, jsonData, addLog])

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="insert-json">Row Data (JSON)</Label>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              const data: Record<string, unknown> = {}
              for (const col of columns) {
                if (AUTO_SKIP_COLUMNS.has(col.name.toLowerCase())) continue
                data[col.name] = generateFakeValue(col.type, col.name)
              }
              setJsonData(JSON.stringify(data, null, 2))
            }}
            disabled={columns.length === 0}
          >
            <Wand2 className="h-3.5 w-3.5 mr-1" />
            Auto-fill
          </Button>
        </div>
        <Textarea
          id="insert-json"
          className="font-mono text-sm min-h-32"
          placeholder={placeholder}
          value={jsonData}
          onChange={(e) => setJsonData(e.target.value)}
        />
      </div>

      <Button onClick={handleInsert} disabled={loading || !jsonData.trim()}>
        <Play className="h-4 w-4 mr-1" />
        {loading ? "Inserting..." : "Insert"}
      </Button>

      {result !== null && (
        <Card>
          <CardContent className="p-3">
            <ScrollArea className="max-h-96">
              <JsonResult json={result} />
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Update Tab
// ---------------------------------------------------------------------------

function UpdateTab({
  table,
  columns,
  prefill,
}: {
  table: string
  columns: { name: string; type: string; required: boolean }[]
  prefill?: { data: Record<string, unknown>; idColumn: string; idValue: unknown } | null
}) {
  const { client, projectUrl, apiKey, session, addLog } = useSupabase()
  const { filters, setFilters, addFilter, removeFilter, changeFilter } = useFilterState()
  const [method, setMethod] = useState<"PATCH" | "PUT">("PATCH")
  const [jsonData, setJsonData] = useState("")
  const [result, setResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // Apply prefill when data is sent from Select tab
  useEffect(() => {
    if (!prefill) return
    const updateData = { ...prefill.data }
    for (const key of AUTO_SKIP_COLUMNS) {
      delete updateData[key]
    }
    setJsonData(JSON.stringify(updateData, null, 2))
    if (prefill.idColumn && prefill.idValue !== undefined) {
      setFilters([{
        id: crypto.randomUUID(),
        column: prefill.idColumn,
        operator: "eq",
        value: String(prefill.idValue),
      }])
    }
  }, [prefill, setFilters])

  const handleUpdate = useCallback(async () => {
    if (!client || !jsonData.trim()) return
    setLoading(true)
    setResult(null)

    try {
      const parsed = JSON.parse(jsonData)
      addLog("info", `${method} "${table}" with ${filters.length} filter(s)`, {
        method,
        data: parsed,
        filters,
      })

      if (method === "PUT") {
        // Raw PUT request to PostgREST
        let url = `${projectUrl}/rest/v1/${table}`
        const params = new URLSearchParams()
        for (const filter of filters) {
          if (!filter.column || !filter.operator) continue
          params.append(filter.column, `${filter.operator}.${filter.value}`)
        }
        if (params.toString()) url += `?${params.toString()}`

        const headers: Record<string, string> = {
          "apikey": apiKey,
          "Content-Type": "application/json",
          "Prefer": "return=representation",
          "Authorization": `Bearer ${session?.access_token ?? apiKey}`,
        }

        const res = await fetch(url, {
          method: "PUT",
          headers,
          body: JSON.stringify(parsed),
        })

        const data = await res.json()
        if (!res.ok) {
          addLog("error", `PUT error: ${data.message ?? res.statusText}`, data)
          setResult(JSON.stringify(data, null, 2))
        } else {
          const rows = Array.isArray(data) ? data.length : 1
          addLog("success", `PUT affected ${rows} row(s)`, data)
          setResult(JSON.stringify(data, null, 2))
        }
      } else {
        // PATCH via Supabase client (.update)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let query: any = client.from(table).update(parsed)

        for (const filter of filters) {
          if (!filter.column || !filter.operator) continue
          query = query[filter.operator](filter.column, filter.value)
        }

        const { data, error } = await query.select()

        if (error) {
          addLog("error", `PATCH error: ${error.message}`, error)
          setResult(JSON.stringify(error, null, 2))
        } else {
          const rows = Array.isArray(data) ? data.length : 0
          addLog("success", `PATCH affected ${rows} row(s)`, data)
          setResult(JSON.stringify(data, null, 2))
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      addLog("error", `${method} exception: ${msg}`, err)
      setResult(JSON.stringify({ error: msg }, null, 2))
    } finally {
      setLoading(false)
    }
  }, [client, table, jsonData, filters, method, projectUrl, apiKey, session, addLog])

  return (
    <div className="space-y-4">
      {/* Method selector */}
      <div className="space-y-2">
        <Label>HTTP Method</Label>
        <Select value={method} onValueChange={(v) => setMethod(v as "PATCH" | "PUT")}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="PATCH">PATCH (partial)</SelectItem>
            <SelectItem value="PUT">PUT (full replace)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Filters to target rows */}
      <FilterBuilder
        filters={filters}
        columns={columns}
        onAdd={addFilter}
        onRemove={removeFilter}
        onChange={changeFilter}
      />

      {/* Update data */}
      <div className="space-y-2">
        <Label htmlFor="update-json">Update Data (JSON)</Label>
        <Textarea
          id="update-json"
          className="font-mono text-sm min-h-32"
          placeholder={'{\n  "column": "new_value"\n}'}
          value={jsonData}
          onChange={(e) => setJsonData(e.target.value)}
        />
      </div>

      <Button onClick={handleUpdate} disabled={loading || !jsonData.trim()}>
        <Play className="h-4 w-4 mr-1" />
        {loading ? "Sending..." : method}
      </Button>

      {result !== null && (
        <Card>
          <CardContent className="p-3">
            <ScrollArea className="max-h-96">
              <JsonResult json={result} />
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Delete Tab
// ---------------------------------------------------------------------------

function DeleteTab({
  table,
  columns,
}: {
  table: string
  columns: { name: string; type: string; required: boolean }[]
}) {
  const { client, addLog } = useSupabase()
  const { filters, addFilter, removeFilter, changeFilter } = useFilterState()
  const [result, setResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const handleDelete = useCallback(async () => {
    if (!client) return
    setLoading(true)
    setResult(null)

    try {
      addLog("warning", `DELETE from "${table}" with ${filters.length} filter(s)`, {
        filters,
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let query: any = client.from(table).delete()

      for (const filter of filters) {
        if (!filter.column || !filter.operator) continue
        query = query[filter.operator](filter.column, filter.value)
      }

      const { data, error } = await query

      if (error) {
        addLog("error", `DELETE error: ${error.message}`, error)
        setResult(JSON.stringify(error, null, 2))
      } else {
        addLog("success", `DELETE completed`, data)
        setResult(JSON.stringify(data ?? { status: "ok" }, null, 2))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      addLog("error", `DELETE exception: ${msg}`, err)
      setResult(JSON.stringify({ error: msg }, null, 2))
    } finally {
      setLoading(false)
    }
  }, [client, table, filters, addLog])

  return (
    <div className="space-y-4">
      {/* Warning */}
      <div className="rounded-md border border-yellow-500/50 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-400">
        This will delete matching rows. Use filters to target specific rows.
      </div>

      {/* Filters */}
      <FilterBuilder
        filters={filters}
        columns={columns}
        onAdd={addFilter}
        onRemove={removeFilter}
        onChange={changeFilter}
      />

      <Button
        variant="destructive"
        onClick={handleDelete}
        disabled={loading}
      >
        <Trash2 className="h-4 w-4 mr-1" />
        {loading ? "Deleting..." : "Delete"}
      </Button>

      {result !== null && (
        <Card>
          <CardContent className="p-3">
            <ScrollArea className="max-h-96">
              <JsonResult json={result} />
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// RPC Tab
// ---------------------------------------------------------------------------

function RpcTab() {
  const { client, schema, addLog } = useSupabase()
  const functions = schema?.functions ?? []

  const [fnName, setFnName] = useState("")
  const [args, setArgs] = useState("")
  const [result, setResult] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const selectedFn = useMemo(
    () => functions.find((f) => f.name === fnName),
    [functions, fnName],
  )

  // Auto-populate args template when function changes
  useEffect(() => {
    if (!selectedFn) return
    if (selectedFn.params.length === 0) {
      setArgs("{}")
      return
    }
    const template: Record<string, unknown> = {}
    for (const p of selectedFn.params) {
      template[p.name] = generateFakeValue(p.format ?? p.type, p.name)
    }
    setArgs(JSON.stringify(template, null, 2))
  }, [selectedFn])

  const handleCall = useCallback(async () => {
    if (!client || !fnName) return
    setLoading(true)
    setResult(null)

    try {
      const parsedArgs = args.trim() ? JSON.parse(args) : {}
      addLog("info", `RPC call: ${fnName}`, parsedArgs)

      const { data, error } = await client.rpc(fnName, parsedArgs)

      if (error) {
        addLog("error", `RPC error: ${error.message}`, error)
        setResult(JSON.stringify(error, null, 2))
      } else {
        addLog("success", `RPC "${fnName}" succeeded`, data)
        setResult(JSON.stringify(data, null, 2))
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error"
      addLog("error", `RPC exception: ${msg}`, err)
      setResult(JSON.stringify({ error: msg }, null, 2))
    } finally {
      setLoading(false)
    }
  }, [client, fnName, args, addLog])

  return (
    <div className="space-y-4">
      {/* Function name */}
      <div className="space-y-2">
        <Label>Function</Label>
        {functions.length > 0 ? (
          <Select value={fnName} onValueChange={setFnName}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a function" />
            </SelectTrigger>
            <SelectContent>
              {[...functions].sort((a, b) => a.name.localeCompare(b.name)).map((fn) => (
                <SelectItem key={fn.name} value={fn.name}>
                  {fn.name}
                  {fn.params.length > 0 && (
                    <span className="ml-2 text-muted-foreground">
                      ({fn.params.length} param{fn.params.length !== 1 ? "s" : ""})
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <p className="text-sm text-muted-foreground">
            No RPC functions discovered in the schema.
          </p>
        )}
      </div>

      {/* Parameter info */}
      {selectedFn && selectedFn.params.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Expected Parameters</Label>
          <div className="flex flex-wrap gap-1">
            {selectedFn.params.map((p) => (
              <Badge key={p.name} variant="secondary" className="text-xs font-mono">
                {p.name}
                <span className="ml-1 text-muted-foreground">{p.format ?? p.type}</span>
                {p.required && <span className="ml-1 text-red-400">*</span>}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Arguments */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label htmlFor="rpc-args">Arguments (JSON)</Label>
          {selectedFn && selectedFn.params.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                const template: Record<string, unknown> = {}
                for (const p of selectedFn.params) {
                  template[p.name] = generateFakeValue(p.format ?? p.type, p.name)
                }
                setArgs(JSON.stringify(template, null, 2))
              }}
            >
              <Wand2 className="h-3.5 w-3.5 mr-1" />
              Re-fill
            </Button>
          )}
        </div>
        <Textarea
          id="rpc-args"
          className="font-mono text-sm min-h-24"
          placeholder={
            selectedFn && selectedFn.params.length > 0
              ? "Auto-populated from schema. Edit values as needed."
              : '{\n  "param": "value"\n}'
          }
          value={args}
          onChange={(e) => setArgs(e.target.value)}
        />
      </div>

      <Button onClick={handleCall} disabled={loading || !fnName}>
        <Play className="h-4 w-4 mr-1" />
        {loading ? "Calling..." : "Call"}
      </Button>

      {result !== null && (
        <Card>
          <CardContent className="p-3">
            <ScrollArea className="max-h-96">
              <JsonResult json={result} />
            </ScrollArea>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main DatabaseExplorer Component
// ---------------------------------------------------------------------------

export function DatabaseExplorer() {
  const { client, schema, discoverTables } = useSupabase()

  const [selectedTable, setSelectedTable] = useState("")
  const [discovering, setDiscovering] = useState(false)
  const [customWordlist, setCustomWordlist] = useState("")
  const [activeOpTab, setActiveOpTab] = useState("select")
  const [updatePrefill, setUpdatePrefill] = useState<{
    data: Record<string, unknown>
    idColumn: string
    idValue: unknown
  } | null>(null)

  const tables = schema?.tables ?? []

  const selectedColumns = useMemo(() => {
    if (!schema || !selectedTable) return []
    return schema.columns[selectedTable] ?? []
  }, [schema, selectedTable])

  const handleSendToUpdate = useCallback((row: Record<string, unknown>) => {
    const idCol = "id" in row ? "id" : Object.keys(row)[0]
    setUpdatePrefill({
      data: row,
      idColumn: idCol,
      idValue: row[idCol],
    })
    setActiveOpTab("update")
  }, [])

  if (!client || !schema) {
    return (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        Connect to a Supabase project to explore the database.
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      {/* Table / View selector */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Table / View</Label>
          <Button
            variant="outline"
            size="sm"
            disabled={discovering}
            onClick={async () => {
              setDiscovering(true)
              try {
                const extra = customWordlist
                  .split(/[\n,]+/)
                  .map((s) => s.trim())
                  .filter(Boolean)
                await discoverTables(extra.length > 0 ? extra : undefined)
              } finally {
                setDiscovering(false)
              }
            }}
          >
            {discovering ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Search className="h-3.5 w-3.5 mr-1" />
            )}
            {discovering ? "Bruteforcing..." : "Bruteforce Tables"}
          </Button>
        </div>
        <Select value={selectedTable} onValueChange={setSelectedTable}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder={tables.length === 0 ? "No tables — bruteforce to discover" : "Select a table or view"} />
          </SelectTrigger>
          <SelectContent>
            {[...tables].sort((a, b) => a.localeCompare(b)).map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="Custom table names (comma or newline separated)"
          value={customWordlist}
          onChange={(e) => setCustomWordlist(e.target.value)}
          className="text-xs"
        />
        {tables.length > 0 && (
          <p className="text-xs text-muted-foreground">{tables.length} table(s) discovered</p>
        )}
      </div>

      {/* Column list for selected table */}
      {selectedTable && selectedColumns.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {selectedColumns.map((col) => (
            <Badge key={col.name} variant="secondary" className="text-xs">
              {col.name}
              <span className="ml-1 text-muted-foreground">{col.type}</span>
              {col.required && (
                <span className="ml-1 text-red-400">*</span>
              )}
            </Badge>
          ))}
        </div>
      )}

      {/* Operation tabs */}
      <Tabs value={activeOpTab} onValueChange={setActiveOpTab} className="flex-1">
        <TabsList>
          <TabsTrigger value="select" disabled={!selectedTable}>Select</TabsTrigger>
          <TabsTrigger value="insert" disabled={!selectedTable}>Insert</TabsTrigger>
          <TabsTrigger value="update" disabled={!selectedTable}>Update</TabsTrigger>
          <TabsTrigger value="delete" disabled={!selectedTable}>Delete</TabsTrigger>
          <TabsTrigger value="rpc">RPC</TabsTrigger>
        </TabsList>

        {selectedTable ? (
          <>
            <TabsContent value="select">
              <Card>
                <CardContent className="p-4">
                  <SelectTab table={selectedTable} columns={selectedColumns} onSendToUpdate={handleSendToUpdate} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="insert">
              <Card>
                <CardContent className="p-4">
                  <InsertTab table={selectedTable} columns={selectedColumns} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="update">
              <Card>
                <CardContent className="p-4">
                  <UpdateTab table={selectedTable} columns={selectedColumns} prefill={updatePrefill} />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="delete">
              <Card>
                <CardContent className="p-4">
                  <DeleteTab table={selectedTable} columns={selectedColumns} />
                </CardContent>
              </Card>
            </TabsContent>
          </>
        ) : (
          <TabsContent value="select">
            <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
              Select a table above to query data.
            </div>
          </TabsContent>
        )}

        <TabsContent value="rpc">
          <Card>
            <CardContent className="p-4">
              <RpcTab />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}
