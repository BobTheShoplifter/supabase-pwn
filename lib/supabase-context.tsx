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

export type SchemaInfo = {
  tables: string[]
  views: string[]
  functions: string[]
  columns: Record<string, { name: string; type: string; required: boolean }[]>
}

export type SupabaseState = {
  client: SupabaseClient | null
  initialized: boolean
  projectUrl: string
  anonKey: string
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
        anonKey: string
        schema: SchemaInfo
      }
    }
  | { type: "SET_AUTH"; payload: { user: User | null; session: Session | null } }
  | { type: "ADD_LOG"; payload: LogEntry }
  | { type: "CLEAR_LOGS" }
  | { type: "DISCONNECT" }

// ---------------------------------------------------------------------------
// Context value shape
// ---------------------------------------------------------------------------

type SupabaseContextValue = SupabaseState & {
  initialize: (projectUrl: string, anonKey: string) => Promise<void>
  addLog: (
    type: LogEntry["type"],
    message: string,
    data?: unknown,
  ) => void
  clearLogs: () => void
  signOut: () => Promise<void>
  disconnect: () => void
}

// ---------------------------------------------------------------------------
// Initial state & reducer
// ---------------------------------------------------------------------------

const MAX_LOG_ENTRIES = 2000

const initialState: SupabaseState = {
  client: null,
  initialized: false,
  projectUrl: "",
  anonKey: "",
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
        anonKey: action.payload.anonKey,
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

interface OpenAPISpec {
  paths?: Record<string, unknown>
  definitions?: Record<string, OpenAPIDefinition>
}

function parseOpenAPISpec(spec: OpenAPISpec): SchemaInfo {
  const tables: string[] = []
  const functions: string[] = []
  const columns: SchemaInfo["columns"] = {}

  // Parse paths ----------------------------------------------------------
  if (spec.paths) {
    for (const path of Object.keys(spec.paths)) {
      if (path.startsWith("/rpc/")) {
        const fnName = path.replace("/rpc/", "")
        if (fnName) functions.push(fnName)
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
    async (projectUrl: string, anonKey: string) => {
      try {
        // Clean up any previous auth listener
        if (authUnsubscribeRef.current) {
          authUnsubscribeRef.current()
          authUnsubscribeRef.current = null
        }

        const client = createClient(projectUrl, anonKey)

        // Fetch OpenAPI spec for schema discovery
        const res = await fetch(`${projectUrl}/rest/v1/`, {
          headers: {
            apikey: anonKey,
          },
        })

        if (!res.ok) {
          throw new Error(
            `Failed to fetch OpenAPI spec: ${res.status} ${res.statusText}`,
          )
        }

        const spec: OpenAPISpec = await res.json()
        const schema = parseOpenAPISpec(spec)

        dispatch({
          type: "INITIALIZE",
          payload: { client, projectUrl, anonKey, schema },
        })

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
          message: `Connected to ${projectUrl}. Discovered ${schema.tables.length} tables, ${schema.functions.length} functions.`,
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

  // -- memoised context value --------------------------------------------
  const value = useMemo<SupabaseContextValue>(
    () => ({
      ...state,
      initialize,
      addLog,
      clearLogs,
      signOut,
      disconnect,
    }),
    [state, initialize, addLog, clearLogs, signOut, disconnect],
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
