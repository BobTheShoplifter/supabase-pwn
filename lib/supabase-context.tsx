"use client"

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react"
import {
  createClient,
  type SupabaseClient,
  type User,
  type Session,
} from "@supabase/supabase-js"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LogEntry = {
  id: string
  timestamp: Date
  type: "info" | "error" | "success" | "warning"
  message: string
  data?: unknown
}

export type RpcParam = {
  name: string
  type: string
  format?: string
  required: boolean
}

export type RpcFunction = {
  name: string
  params: RpcParam[]
}

export type SchemaInfo = {
  tables: string[]
  views: string[]
  functions: RpcFunction[]
  columns: Record<string, { name: string; type: string; required: boolean }[]>
}

export type ApiKeyType = "publishable" | "secret" | "anon" | "service_role" | "unknown"

export function detectKeyType(key: string): ApiKeyType {
  if (key.startsWith("sb_publishable_")) return "publishable"
  if (key.startsWith("sb_secret_")) return "secret"
  // JWT-based legacy keys — decode payload to check role
  if (key.startsWith("eyJ")) {
    try {
      const payload = JSON.parse(atob(key.split(".")[1]))
      if (payload.role === "service_role") return "service_role"
      if (payload.role === "anon") return "anon"
    } catch { /* not a valid JWT */ }
  }
  return "unknown"
}

export type SupabaseState = {
  client: SupabaseClient | null
  initialized: boolean
  projectUrl: string
  apiKey: string
  keyType: ApiKeyType
  user: User | null
  session: Session | null
  schema: SchemaInfo | null
  logs: LogEntry[]
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type Action =
  | {
      type: "INITIALIZE"
      payload: {
        client: SupabaseClient
        projectUrl: string
        apiKey: string
        keyType: ApiKeyType
        schema: SchemaInfo
      }
    }
  | { type: "SET_AUTH"; payload: { user: User | null; session: Session | null } }
  | { type: "ADD_LOG"; payload: LogEntry }
  | { type: "CLEAR_LOGS" }
  | { type: "DISCONNECT" }
  | { type: "MERGE_SCHEMA"; payload: { tables: string[]; columns: SchemaInfo["columns"] } }

// ---------------------------------------------------------------------------
// Context value shape
// ---------------------------------------------------------------------------

type SupabaseContextValue = SupabaseState & {
  initialize: (projectUrl: string, apiKey: string) => Promise<void>
  addLog: (
    type: LogEntry["type"],
    message: string,
    data?: unknown,
  ) => void
  clearLogs: () => void
  signOut: () => Promise<void>
  disconnect: () => void
  discoverTables: (customNames?: string[]) => Promise<void>
}

// ---------------------------------------------------------------------------
// Initial state & reducer
// ---------------------------------------------------------------------------

const MAX_LOG_ENTRIES = 2000

const initialState: SupabaseState = {
  client: null,
  initialized: false,
  projectUrl: "",
  apiKey: "",
  keyType: "unknown",
  user: null,
  session: null,
  schema: null,
  logs: [],
}

function reducer(state: SupabaseState, action: Action): SupabaseState {
  switch (action.type) {
    case "INITIALIZE":
      return {
        ...state,
        client: action.payload.client,
        initialized: true,
        projectUrl: action.payload.projectUrl,
        apiKey: action.payload.apiKey,
        keyType: action.payload.keyType,
        schema: action.payload.schema,
      }
    case "SET_AUTH":
      return {
        ...state,
        user: action.payload.user,
        session: action.payload.session,
      }
    case "ADD_LOG": {
      const newLogs = [...state.logs, action.payload]
      return {
        ...state,
        logs: newLogs.length > MAX_LOG_ENTRIES
          ? newLogs.slice(newLogs.length - MAX_LOG_ENTRIES)
          : newLogs,
      }
    }
    case "CLEAR_LOGS":
      return { ...state, logs: [] }
    case "DISCONNECT":
      return { ...initialState }
    case "MERGE_SCHEMA": {
      const existing = new Set(state.schema?.tables ?? [])
      const newTables = action.payload.tables.filter((t) => !existing.has(t))
      return {
        ...state,
        schema: {
          tables: [...(state.schema?.tables ?? []), ...newTables],
          views: state.schema?.views ?? [],
          functions: state.schema?.functions ?? [],
          columns: { ...(state.schema?.columns ?? {}), ...action.payload.columns },
        },
      }
    }
    default:
      return state
  }
}

// ---------------------------------------------------------------------------
// OpenAPI spec parsing
// ---------------------------------------------------------------------------

interface OpenAPIProperty {
  type?: string
  format?: string
  description?: string
}

interface OpenAPIDefinition {
  properties?: Record<string, OpenAPIProperty>
  required?: string[]
}

interface OpenAPIPathParam {
  name: string
  type?: string
  format?: string
  required?: boolean
  in?: string
}

interface OpenAPISpec {
  paths?: Record<string, unknown>
  definitions?: Record<string, OpenAPIDefinition>
}

function parseOpenAPISpec(spec: OpenAPISpec): SchemaInfo {
  const tables: string[] = []
  const functions: RpcFunction[] = []
  const columns: SchemaInfo["columns"] = {}

  // Parse paths ----------------------------------------------------------
  if (spec.paths) {
    for (const [path, rawPathDef] of Object.entries(spec.paths)) {
      if (path.startsWith("/rpc/")) {
        const fnName = path.replace("/rpc/", "")
        if (fnName) {
          const pathDef = rawPathDef as {
            get?: { parameters?: OpenAPIPathParam[] }
          } | undefined
          const getParams = pathDef?.get?.parameters ?? []
          const params: RpcParam[] = getParams
            .filter((p) => p.in === "query" && p.name)
            .map((p) => ({
              name: p.name,
              type: p.type ?? "string",
              format: p.format,
              required: p.required ?? false,
            }))
          functions.push({ name: fnName, params })
        }
      } else {
        // Strip leading "/" to get the table/view name
        const name = path.replace(/^\//, "")
        if (name) tables.push(name)
      }
    }
  }

  // Parse definitions (columns) -----------------------------------------
  if (spec.definitions) {
    for (const [tableName, def] of Object.entries(spec.definitions)) {
      if (!def.properties) continue

      const requiredSet = new Set<string>(def.required ?? [])

      columns[tableName] = Object.entries(def.properties).map(
        ([colName, colDef]) => ({
          name: colName,
          type: colDef.format ?? colDef.type ?? "unknown",
          required: requiredSet.has(colName),
        }),
      )
    }
  }

  // Views: The OpenAPI spec doesn't distinguish tables from views directly.
  // Treat all non-rpc paths as "tables" for now; views is left empty.
  const views: string[] = []

  return { tables, views, functions, columns }
}

// ---------------------------------------------------------------------------
// Table bruteforce wordlist
// ---------------------------------------------------------------------------

function inferColumnType(value: unknown): string {
  if (value === null || value === undefined) return "text"
  if (typeof value === "number")
    return Number.isInteger(value) ? "integer" : "double precision"
  if (typeof value === "boolean") return "boolean"
  if (typeof value === "string") {
    if (/^\d{4}-\d{2}-\d{2}T/.test(value)) return "timestamptz"
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return "date"
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(value)) return "uuid"
    return "text"
  }
  if (Array.isArray(value)) return "jsonb"
  if (typeof value === "object") return "jsonb"
  return "text"
}

const TABLE_WORDLIST = [
  // Auth & users
  "users", "profiles", "accounts", "user_profiles", "user_roles",
  "roles", "permissions", "role_permissions", "user_permissions",
  "sessions", "tokens", "refresh_tokens", "api_keys", "credentials",
  "password_resets", "email_verifications", "invitations", "invites",
  // Content
  "posts", "articles", "blogs", "pages", "content", "entries",
  "comments", "replies", "threads", "discussions",
  "categories", "tags", "labels",
  "media", "images", "files", "uploads", "documents", "attachments",
  // Social
  "messages", "conversations", "chats", "chat_messages",
  "notifications", "alerts",
  "likes", "favorites", "bookmarks", "follows", "followers", "following",
  "friends", "connections", "blocks",
  "reviews", "ratings", "feedback",
  "votes", "polls", "surveys", "responses",
  // E-commerce
  "products", "items", "inventory", "variants", "skus",
  "orders", "order_items", "order_lines",
  "cart", "cart_items", "shopping_cart",
  "payments", "transactions", "invoices", "receipts",
  "subscriptions", "plans", "pricing",
  "coupons", "discounts", "promotions",
  "shipping", "addresses", "shipping_addresses",
  // CRM & contacts
  "contacts", "leads", "customers", "clients", "vendors", "suppliers",
  "companies", "organizations", "orgs",
  // Project management
  "projects", "tasks", "todos", "issues", "tickets", "sprints",
  "boards", "columns", "cards",
  "milestones", "deadlines",
  "teams", "team_members", "members", "memberships",
  "departments", "groups",
  // Config & system
  "settings", "preferences", "configs", "configuration", "options",
  "features", "feature_flags", "flags", "experiments",
  "migrations", "schema_migrations",
  "logs", "audit_log", "audit_logs", "activity", "activity_log",
  "events", "event_log", "webhooks", "hooks",
  "jobs", "queue", "job_queue", "scheduled_tasks",
  // Communication
  "emails", "email_templates", "newsletters", "sms",
  "channels", "channel_members",
  // Geo
  "countries", "cities", "states", "regions", "locations", "places",
  // Education
  "courses", "lessons", "modules", "enrollments", "students", "teachers",
  "assignments", "grades", "quizzes",
  // Misc
  "notes", "memos", "bookings", "reservations", "appointments",
  "reports", "analytics", "metrics", "stats", "statistics",
  "albums", "photos", "videos", "playlists", "songs", "tracks",
  "properties", "listings", "vehicles", "drivers", "rides", "trips",
  "recipes", "ingredients", "news", "announcements",
  "links", "urls", "redirects",
  "data", "records", "public", "private", "internal",
  "test", "tests", "test_data", "debug", "admin",
  "secrets", "private_data", "wallets", "balances",
]

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const SupabaseContext = createContext<SupabaseContextValue | null>(null)

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function SupabaseProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState)
  const authUnsubscribeRef = useRef<(() => void) | null>(null)

  // -- addLog -------------------------------------------------------------
  const addLog = useCallback(
    (type: LogEntry["type"], message: string, data?: unknown) => {
      const entry: LogEntry = {
        id: crypto.randomUUID(),
        timestamp: new Date(),
        type,
        message,
        data,
      }
      dispatch({ type: "ADD_LOG", payload: entry })
    },
    [],
  )

  // -- clearLogs ----------------------------------------------------------
  const clearLogs = useCallback(() => {
    dispatch({ type: "CLEAR_LOGS" })
  }, [])

  // -- initialize ---------------------------------------------------------
  const initialize = useCallback(
    async (projectUrl: string, apiKey: string) => {
      try {
        // Clean up any previous auth listener
        if (authUnsubscribeRef.current) {
          authUnsubscribeRef.current()
          authUnsubscribeRef.current = null
        }

        const keyType = detectKeyType(apiKey)
        const client = createClient(projectUrl, apiKey)

        // Fetch OpenAPI spec for schema discovery (may fail with publishable keys)
        let schema: SchemaInfo = { tables: [], views: [], functions: [], columns: {} }
        let schemaBlocked = false

        try {
          const res = await fetch(`${projectUrl}/rest/v1/`, {
            headers: { apikey: apiKey },
          })

          if (res.ok) {
            const spec: OpenAPISpec = await res.json()
            schema = parseOpenAPISpec(spec)
          } else {
            schemaBlocked = true
            const body = await res.json().catch(() => null)
            const hint = body?.hint || body?.message || res.statusText
            dispatch({
              type: "ADD_LOG",
              payload: {
                id: crypto.randomUUID(),
                timestamp: new Date(),
                type: "warning",
                message: `Schema discovery blocked: ${hint}. Use Bruteforce to discover tables.`,
                data: body,
              },
            })
          }
        } catch {
          schemaBlocked = true
          dispatch({
            type: "ADD_LOG",
            payload: {
              id: crypto.randomUUID(),
              timestamp: new Date(),
              type: "warning",
              message: "Schema discovery request failed. Use Bruteforce to discover tables.",
            },
          })
        }

        dispatch({
          type: "INITIALIZE",
          payload: { client, projectUrl, apiKey, keyType, schema },
        })

        if (schemaBlocked) {
          // Still connected — just missing schema
        }

        // Set up auth state listener
        const {
          data: { subscription },
        } = client.auth.onAuthStateChange((event, session) => {
          dispatch({
            type: "SET_AUTH",
            payload: { user: session?.user ?? null, session },
          })

          const logEntry: LogEntry = {
            id: crypto.randomUUID(),
            timestamp: new Date(),
            type: "info",
            message: `Auth event: ${event}`,
            data: { event, userId: session?.user?.id },
          }
          dispatch({ type: "ADD_LOG", payload: logEntry })
        })

        authUnsubscribeRef.current = () => subscription.unsubscribe()

        // Log success
        const successLog: LogEntry = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          type: "success",
          message: schemaBlocked
            ? `Connected to ${projectUrl} (key: ${keyType}). Schema blocked — bruteforce tables to explore.`
            : `Connected to ${projectUrl} (key: ${keyType}). Discovered ${schema.tables.length} tables, ${schema.functions.length} functions.`,
          data: schema,
        }
        dispatch({ type: "ADD_LOG", payload: successLog })
      } catch (err) {
        const errorLog: LogEntry = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          type: "error",
          message:
            err instanceof Error
              ? err.message
              : "Unknown error during initialization",
          data: err,
        }
        dispatch({ type: "ADD_LOG", payload: errorLog })
        throw err
      }
    },
    [],
  )

  // -- signOut ------------------------------------------------------------
  const signOut = useCallback(async () => {
    if (!state.client) return
    const { error } = await state.client.auth.signOut()
    if (error) {
      addLog("error", `Sign-out failed: ${error.message}`, error)
    } else {
      dispatch({ type: "SET_AUTH", payload: { user: null, session: null } })
      addLog("info", "Signed out")
    }
  }, [state.client, addLog])

  // -- disconnect ---------------------------------------------------------
  const disconnect = useCallback(() => {
    if (authUnsubscribeRef.current) {
      authUnsubscribeRef.current()
      authUnsubscribeRef.current = null
    }
    dispatch({ type: "DISCONNECT" })
  }, [])

  // -- discoverTables (bruteforce) ----------------------------------------
  const discoverTables = useCallback(
    async (customNames?: string[]) => {
      if (!state.projectUrl || !state.apiKey) return

      const wordlist = customNames && customNames.length > 0
        ? [...new Set([...customNames, ...TABLE_WORDLIST])]
        : TABLE_WORDLIST

      addLog("info", `Bruteforcing ${wordlist.length} table names...`)

      const discovered: string[] = []
      const columns: SchemaInfo["columns"] = {}
      const existing = new Set(state.schema?.tables ?? [])
      const batchSize = 10

      for (let i = 0; i < wordlist.length; i += batchSize) {
        const batch = wordlist.slice(i, i + batchSize)
        const results = await Promise.allSettled(
          batch.map(async (table) => {
            if (existing.has(table)) return null
            const res = await fetch(
              `${state.projectUrl}/rest/v1/${table}?select=*&limit=1`,
              {
                headers: {
                  apikey: state.apiKey,
                  Authorization: `Bearer ${state.session?.access_token ?? state.apiKey}`,
                },
              },
            )
            if (!res.ok) return null
            const data = await res.json()
            return { table, data }
          }),
        )

        for (const r of results) {
          if (r.status === "fulfilled" && r.value) {
            const { table, data } = r.value
            discovered.push(table)
            if (Array.isArray(data) && data.length > 0) {
              columns[table] = Object.keys(data[0]).map((name) => ({
                name,
                type: inferColumnType(data[0][name]),
                required: false,
              }))
              addLog(
                "success",
                `Found: ${table} (${data.length} row visible, ${Object.keys(data[0]).length} cols)`,
              )
            } else {
              addLog("success", `Found: ${table} (empty or RLS blocked)`)
            }
          }
        }
      }

      if (discovered.length > 0) {
        dispatch({ type: "MERGE_SCHEMA", payload: { tables: discovered, columns } })
      }

      addLog(
        "info",
        `Bruteforce complete. Found ${discovered.length} new table(s) out of ${wordlist.length} tried.`,
      )
    },
    [state.projectUrl, state.apiKey, state.session, state.schema?.tables, addLog],
  )

  // -- memoised context value --------------------------------------------
  const value = useMemo<SupabaseContextValue>(
    () => ({
      ...state,
      initialize,
      addLog,
      clearLogs,
      signOut,
      disconnect,
      discoverTables,
    }),
    [state, initialize, addLog, clearLogs, signOut, disconnect, discoverTables],
  )

  return (
    <SupabaseContext.Provider value={value}>
      {children}
    </SupabaseContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useSupabase(): SupabaseContextValue {
  const ctx = useContext(SupabaseContext)
  if (!ctx) {
    throw new Error("useSupabase must be used within a <SupabaseProvider>")
  }
  return ctx
}
