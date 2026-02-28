# supabase-pwn Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a Supabase security testing web tool that lets pentesters probe Supabase projects for RLS misconfigurations, auth weaknesses, storage leaks, and more — using the real Supabase JS SDK.

**Architecture:** Next.js 16 app with a single `SupabaseProvider` context managing the client instance, auth state, schema discovery, and output log. UI uses shadcn/ui components in a resizable split-pane layout (main tabs left, auth panel right, output log bottom). All Supabase operations go through `@supabase/supabase-js`.

**Tech Stack:** Next.js 16, React 19, TypeScript 5, Tailwind CSS v4, shadcn/ui (new-york style), @supabase/supabase-js, react-resizable-panels, prism-react-renderer, sonner, next-themes

---

### Task 1: Install Dependencies

**Files:**

- Modify: `package.json`

**Step 1: Install runtime dependencies**

Run:

```bash
npm install @supabase/supabase-js react-resizable-panels prism-react-renderer sonner next-themes
```

**Step 2: Install shadcn/ui components**

Run each command (shadcn will create files in `components/ui/`):

```bash
npx shadcn@latest add button card input label tabs select badge scroll-area separator dialog toast progress collapsible textarea switch tooltip dropdown-menu
```

**Step 3: Verify build compiles**

Run: `npm run build`
Expected: Build succeeds (may have warnings from unused default page, that's fine)

**Step 4: Commit**

```bash
git add -A
git commit -m "chore: install dependencies and shadcn components"
```

---

### Task 2: Theme, Fonts, and Global Styles

**Files:**

- Modify: `app/globals.css`
- Modify: `app/layout.tsx`
- Create: `components/theme-provider.tsx`

**Step 1: Create theme provider**

Create `components/theme-provider.tsx`:

```tsx
"use client"

import * as React from "react"
import { ThemeProvider as NextThemesProvider } from "next-themes"

export function ThemeProvider({ children, ...props }: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
```

**Step 2: Update globals.css**

Replace `app/globals.css` with dark-first theme using shadcn CSS variables. Use HSL-based color scheme with dark background (`#0a0a0a`). Include variables for: `--background`, `--foreground`, `--card`, `--popover`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`, `--chart-*`, and their dark mode counterparts. Set dark as default. Add `@layer base` with border-color and body styles.

**Step 3: Update layout.tsx**

Replace `app/layout.tsx`:

- Change fonts to Inter (sans) + JetBrains Mono (mono) via `next/font/google`
- Update metadata: title "supabase-pwn", description "Supabase security testing tool"
- Wrap body content in `<ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>`
- Add `suppressHydrationWarning` to `<html>`

**Step 4: Verify dev server renders**

Run: `npm run dev`
Expected: Page loads with dark theme at http://localhost:3000

**Step 5: Commit**

```bash
git add app/globals.css app/layout.tsx components/theme-provider.tsx
git commit -m "feat: add dark theme, fonts, and shadcn theme variables"
```

---

### Task 3: Supabase Context Provider

**Files:**

- Create: `lib/supabase-context.tsx`
- Create: `lib/utils.ts` (if not already created by shadcn)

**Step 1: Create lib/supabase-context.tsx**

This is the core state management. Create a React context with:

**Types:**

```tsx
type LogEntry = {
  id: string
  timestamp: Date
  type: "info" | "error" | "success" | "warning"
  message: string
  data?: unknown
}

type SchemaInfo = {
  tables: string[]
  views: string[]
  functions: string[]
  columns: Record<string, { name: string; type: string; required: boolean }[]>
}

type SupabaseState = {
  client: SupabaseClient | null
  initialized: boolean
  projectUrl: string
  anonKey: string
  user: User | null
  session: Session | null
  schema: SchemaInfo | null
  logs: LogEntry[]
}
```

**Context actions:**

- `initialize(projectUrl: string, anonKey: string)` — Creates `createClient(url, key)`, fetches OpenAPI spec from `${url}/rest/v1/` with `apikey` header, parses tables/views/functions/columns into `SchemaInfo`, logs success
- `addLog(type, message, data?)` — Appends a log entry with auto-generated ID and timestamp
- `clearLogs()` — Clears all log entries
- `signOut()` — Calls `client.auth.signOut()`, clears user/session
- `disconnect()` — Resets state to initial (null client, clear schema, etc.)

**Auth listener:** On initialize, set up `client.auth.onAuthStateChange()` to update user/session in state and log auth events.

**OpenAPI parsing:** The `/rest/v1/` endpoint returns an OpenAPI spec JSON. Parse `paths` keys to extract table names (keys like `/{table_name}`), and `definitions` to extract column info. Functions appear as paths under `/rpc/{function_name}`.

**Step 2: Verify TypeScript compiles**

Run: `npx tsc --noEmit`
Expected: No type errors in supabase-context.tsx

**Step 3: Commit**

```bash
git add lib/supabase-context.tsx
git commit -m "feat: add Supabase context provider with schema discovery"
```

---

### Task 4: Header Component

**Files:**

- Create: `components/supabase-pwn/header.tsx`

**Step 1: Create header.tsx**

```tsx
import { Shield } from "lucide-react"

export function Header() {
  return (
    <header className="flex items-center justify-between border-b border-border px-4 py-3">
      <div className="flex items-center gap-2">
        <Shield className="h-6 w-6 text-emerald-500" />
        <h1 className="text-lg font-bold tracking-tight">supabase-pwn</h1>
      </div>
      <a
        href="https://github.com/BobTheShoplifter/supabase-pwn"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        GitHub
      </a>
    </header>
  )
}
```

**Step 2: Commit**

```bash
git add components/supabase-pwn/header.tsx
git commit -m "feat: add header component"
```

---

### Task 5: Init Form Component

**Files:**

- Create: `components/supabase-pwn/init-form.tsx`

**Step 1: Create init-form.tsx**

A client component (`"use client"`) with:

- Collapsible card (uses shadcn `Collapsible`)
- Two inputs: Project URL and Anon Key
- "Initialize" button that calls `initialize()` from context
- On success: auto-collapse, show green "Connected" badge in header
- Persist URL and key to `localStorage` under `supabase-pwn-config`
- On mount: load from localStorage, auto-populate fields
- "Disconnect" button when connected (resets state, expands form)
- Input validation: URL must match `https://*.supabase.co` or any URL, key must be non-empty

**Step 2: Commit**

```bash
git add components/supabase-pwn/init-form.tsx
git commit -m "feat: add init form with localStorage persistence"
```

---

### Task 6: Output Log Component

**Files:**

- Create: `components/supabase-pwn/output-log.tsx`

**Step 1: Create output-log.tsx**

A client component with:

- Reads `logs` from `useSupabase()` context
- Each log entry: timestamp (HH:MM:SS.ms), color-coded icon/badge by type, message text
- Colors: info=blue, success=green, error=red, warning=yellow
- If `data` is present, render as syntax-highlighted JSON using `prism-react-renderer` with VS Dark theme
- Auto-scroll to bottom on new entries (with a ref to scroll container)
- Controls bar: sort toggle (newest/oldest), clear button, entry count badge
- URLs in messages auto-linked

**Step 2: Commit**

```bash
git add components/supabase-pwn/output-log.tsx
git commit -m "feat: add output log with JSON syntax highlighting"
```

---

### Task 7: Auth Panel Component

**Files:**

- Create: `components/supabase-pwn/auth-panel.tsx`

**Step 1: Create auth-panel.tsx**

A client component with sub-tabs (using shadcn `Tabs`):

**Sign Up tab:**

- Email + password inputs
- "Sign Up" button → `client.auth.signUp({ email, password })`
- Log result (success with user ID, or error)

**Sign In tab:**

- Email + password inputs
- "Sign In" button → `client.auth.signInWithPassword({ email, password })`
- Log result

**Anonymous tab:**

- Single "Sign In Anonymously" button → `client.auth.signInAnonymously()`
- Log result

**OAuth tab:**

- Provider dropdown (Google, GitHub, Discord, Apple, Twitter, Facebook, etc.)
- "Sign In with {provider}" button → `client.auth.signInWithOAuth({ provider })`
- Note: this opens a popup/redirect, may not work in all contexts

**When authenticated, show below tabs:**

- User email (or "Anonymous")
- User UID with copy button
- Role from JWT
- Expandable JWT claims section (app_metadata, user_metadata as JSON)
- "Sign Out" button

**Step 2: Commit**

```bash
git add components/supabase-pwn/auth-panel.tsx
git commit -m "feat: add auth panel with sign up, sign in, anon, and OAuth"
```

---

### Task 8: Database Explorer Component

**Files:**

- Create: `components/supabase-pwn/database-explorer.tsx`

**Step 1: Create database-explorer.tsx**

A client component with:

**Table/View selector:**

- Dropdown populated from `schema.tables` and `schema.views` (from context)
- Label which are tables vs views

**Operation tabs:** Select | Insert | Update | Delete | RPC

**Select operation:**

- Column selector (multi-select from schema columns, default `*`)
- Filter builder (add/remove filter rows):
  - Column dropdown + operator dropdown (eq, neq, gt, gte, lt, lte, like, ilike, is, in, contains) + value input
- Order by: column dropdown + asc/desc toggle
- Limit: number input (default 10, max 10000)
- "Execute" button → builds `supabase.from(table).select(columns).filter(...).order(...).limit(...)` and executes
- Results: row count + JSON syntax-highlighted output

**Insert operation:**

- JSON textarea for the row data
- "Insert" button → `supabase.from(table).insert(data).select()`
- Log result

**Update operation:**

- Filter section (same as Select) to target rows
- JSON textarea for update data
- "Update" button → `supabase.from(table).update(data).filter(...).select()`
- Log result

**Delete operation:**

- Filter section to target rows
- "Delete" button with confirmation
- → `supabase.from(table).delete().filter(...)`
- Log result

**RPC operation:**

- Function name dropdown (from `schema.functions`)
- JSON textarea for arguments
- "Call" button → `supabase.rpc(name, args)`
- Log result

**Step 2: Commit**

```bash
git add components/supabase-pwn/database-explorer.tsx
git commit -m "feat: add database explorer with CRUD and RPC"
```

---

### Task 9: Storage Explorer Component

**Files:**

- Create: `components/supabase-pwn/storage-explorer.tsx`

**Step 1: Create storage-explorer.tsx**

A client component with:

**Bucket section:**

- "List Buckets" button → `supabase.storage.listBuckets()`
- Bucket dropdown (populated after listing)
- Shows public/private badge per bucket

**Operations (after selecting a bucket):**

**List Files:**

- Folder path input (default empty = root)
- Limit input (default 100)
- "List" button → `supabase.storage.from(bucket).list(folder, { limit })`
- Results as a file list with name, size, timestamps

**Upload:**

- File picker input + destination path input
- "Upload" button → `supabase.storage.from(bucket).upload(path, file)`
- Log result

**Download:**

- File path input
- "Download" button → `supabase.storage.from(bucket).download(path)`
- Log result (blob URL)

**Delete:**

- File path(s) input (comma-separated)
- "Delete" button → `supabase.storage.from(bucket).remove([paths])`
- Log result

**Get Metadata:**

- File path input
- "Get Info" button (not a direct SDK method — use list with search, or attempt download headers)
- Log result

**URL Generators:**

- "Get Public URL" → `supabase.storage.from(bucket).getPublicUrl(path)` — display URL
- "Create Signed URL" → expiry input (seconds) + `supabase.storage.from(bucket).createSignedUrl(path, expiry)` — display URL

**Step 2: Commit**

```bash
git add components/supabase-pwn/storage-explorer.tsx
git commit -m "feat: add storage explorer with bucket and file operations"
```

---

### Task 10: Edge Functions Component

**Files:**

- Create: `components/supabase-pwn/edge-functions.tsx`

**Step 1: Create edge-functions.tsx**

A client component with:

- Function name input (text)
- Request body JSON textarea
- Optional custom headers: dynamic key/value pair rows (add/remove)
- "Invoke" button → `supabase.functions.invoke(name, { body, headers })`
- Response display: status, headers, body (JSON syntax-highlighted)
- Log all results

**Step 2: Commit**

```bash
git add components/supabase-pwn/edge-functions.tsx
git commit -m "feat: add edge functions invocation panel"
```

---

### Task 11: Realtime Component

**Files:**

- Create: `components/supabase-pwn/realtime.tsx`

**Step 1: Create realtime.tsx**

A client component with:

**Channel Manager:**

- Channel name input + "Subscribe" button
- Active channels list with "Unsubscribe" button each
- On unmount or disconnect: unsubscribe all

**Postgres Changes:**

- Schema input (default "public")
- Table dropdown (from schema)
- Event type dropdown: INSERT, UPDATE, DELETE, \* (all)
- "Listen" button → subscribes to `postgres_changes` on selected channel
- Incoming changes displayed in a live stream (timestamp + event type + payload)

**Broadcast:**

- Event name input + JSON payload textarea
- "Send" button → `channel.send({ type: 'broadcast', event, payload })`
- Incoming broadcasts displayed in stream

**Presence:**

- JSON state textarea (what to track)
- "Track" button → `channel.track(state)`
- "Untrack" button → `channel.untrack()`
- Current presence state display (synced from `presence.sync` events)

**Live Event Stream:**

- Scrolling list of all received events (changes, broadcasts, presence)
- Timestamp + event type badge + payload

**Step 2: Commit**

```bash
git add components/supabase-pwn/realtime.tsx
git commit -m "feat: add realtime subscriptions panel"
```

---

### Task 12: Autopwn Scanner Component

**Files:**

- Create: `components/supabase-pwn/autopwn.tsx`

**Step 1: Create autopwn.tsx**

A client component with the automated security scanner. This is the most complex component.

**Configuration section:**

- Phase toggles (checkboxes):
  - Database RLS Testing (default on)
  - Storage Scanning (default on)
  - Auth Probing (default on)
  - Edge Function Discovery (default off)
- Concurrency slider (5-50, default 10)
- Write testing toggle (default off, with warning that it modifies data)
- Custom table names textarea (comma/newline separated, added to discovered tables)
- "Start Scan" / "Abort" button

**Scanning logic:**

Phase 1 — Reconnaissance:

- Already done at init (OpenAPI spec parsed into schema)
- Display discovered tables, views, and functions count

Phase 2 — Database RLS Testing:

- For each table in `schema.tables`:
  - Test SELECT: `supabase.from(table).select('*').limit(1)` — record success (data returned) or error (RLS denied)
  - If write testing enabled:
    - Test INSERT: `supabase.from(table).insert({ __supabase_pwn_probe: true, _timestamp: Date.now() }).select()` — record success or error
    - Test UPDATE: `supabase.from(table).update({ __supabase_pwn_probe: true }).eq('__supabase_pwn_probe', true).select()` — record success or error (may fail if probe row doesn't exist)
    - Test DELETE: `supabase.from(table).delete().eq('__supabase_pwn_probe', true)` — clean up probe
- Use `Promise.allSettled` with concurrency limiting (simple semaphore pattern)
- Track progress: current/total tables

Phase 3 — Storage Scanning:

- `supabase.storage.listBuckets()` — record each bucket name + public/private
- For each bucket:
  - `supabase.storage.from(bucket).list('', { limit: 5 })` — record if file listing succeeds
  - If public: try accessing a file via public URL

Phase 4 — Auth Probing:

- Test if signup is open: `supabase.auth.signUp({ email: 'probe-<random>@test.invalid', password: 'ProbeTest123!' })` — record if account creation succeeds or is disabled
- Test anonymous auth: `supabase.auth.signInAnonymously()` — record if enabled
- Clean up: sign out after probing

Phase 5 — Edge Function Discovery:

- Try common function names: `hello`, `test`, `api`, `webhook`, `stripe-webhook`, `send-email`, `notify`, `process`, `auth`, `admin`
- For each: `supabase.functions.invoke(name)` — record status code (200 = exists, 404 = not found, 401 = exists but unauthorized)

**Results display:**

- Collapsible sections per phase
- Permission matrix table per phase:
  - Database: Table name | SELECT | INSERT | UPDATE | DELETE — each cell is a badge: Allowed (green), Denied (red), Error (yellow), Skipped (gray)
  - Storage: Bucket name | Public | List | Upload | Delete — same badges
  - Auth: Feature | Status — badge
  - Functions: Name | Status code | Response — badge
- Overall summary: X tables accessible, Y buckets exposed, Z auth issues

**Progress:**

- Progress bar with phase label
- Current item being tested
- Abort ref to cancel in-flight operations

**Step 2: Commit**

```bash
git add components/supabase-pwn/autopwn.tsx
git commit -m "feat: add autopwn automated security scanner"
```

---

### Task 13: Main Page Assembly

**Files:**

- Modify: `app/page.tsx`
- Modify: `app/layout.tsx`

**Step 1: Update layout.tsx to include SupabaseProvider**

Wrap the `ThemeProvider` children with `<SupabaseProvider>` from `lib/supabase-context.tsx`.

**Step 2: Replace page.tsx with the main layout**

Replace the default Next.js page with the supabase-pwn layout:

```tsx
"use client"

import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "react-resizable-panels"
import { Header } from "@/components/supabase-pwn/header"
import { InitForm } from "@/components/supabase-pwn/init-form"
import { AuthPanel } from "@/components/supabase-pwn/auth-panel"
import { DatabaseExplorer } from "@/components/supabase-pwn/database-explorer"
import { StorageExplorer } from "@/components/supabase-pwn/storage-explorer"
import { EdgeFunctions } from "@/components/supabase-pwn/edge-functions"
import { Realtime } from "@/components/supabase-pwn/realtime"
import { Autopwn } from "@/components/supabase-pwn/autopwn"
import { OutputLog } from "@/components/supabase-pwn/output-log"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useSupabase } from "@/lib/supabase-context"

export default function Home() {
  const { state } = useSupabase()

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Header />
      <InitForm />
      <ResizablePanelGroup direction="vertical" className="flex-1">
        <ResizablePanel defaultSize={75} minSize={30}>
          <ResizablePanelGroup direction="horizontal">
            <ResizablePanel defaultSize={70} minSize={40}>
              {state.initialized ? (
                <Tabs defaultValue="database" className="h-full flex flex-col">
                  <TabsList className="mx-4 mt-2">
                    <TabsTrigger value="database">Database</TabsTrigger>
                    <TabsTrigger value="storage">Storage</TabsTrigger>
                    <TabsTrigger value="functions">Edge Functions</TabsTrigger>
                    <TabsTrigger value="realtime">Realtime</TabsTrigger>
                    <TabsTrigger value="autopwn">Autopwn</TabsTrigger>
                  </TabsList>
                  <TabsContent value="database" className="flex-1 overflow-auto">
                    <DatabaseExplorer />
                  </TabsContent>
                  <TabsContent value="storage" className="flex-1 overflow-auto">
                    <StorageExplorer />
                  </TabsContent>
                  <TabsContent value="functions" className="flex-1 overflow-auto">
                    <EdgeFunctions />
                  </TabsContent>
                  <TabsContent value="realtime" className="flex-1 overflow-auto">
                    <Realtime />
                  </TabsContent>
                  <TabsContent value="autopwn" className="flex-1 overflow-auto">
                    <Autopwn />
                  </TabsContent>
                </Tabs>
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">Initialize a Supabase project to get started</div>
              )}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel defaultSize={30} minSize={20} maxSize={40}>
              {state.initialized ? <AuthPanel /> : null}
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel defaultSize={25} minSize={10}>
          <OutputLog />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
```

**Step 3: Verify the app compiles and renders**

Run: `npm run dev`
Expected: App loads with dark theme, header, init form, and empty panels. No React errors in console.

**Step 4: Commit**

```bash
git add app/page.tsx app/layout.tsx
git commit -m "feat: assemble main page with resizable panel layout"
```

---

### Task 14: Polish and Integration Testing

**Step 1: Test init flow**

- Enter a Supabase project URL and anon key
- Verify: form collapses, "Connected" badge shows, tabs appear, schema is loaded in log

**Step 2: Test auth flow**

- Try sign up, sign in, anonymous auth
- Verify: user info displays in auth panel, JWT claims visible, sign out works

**Step 3: Test database explorer**

- Select a table, run a SELECT query
- Verify: results display as JSON, filters work, RPC calls work

**Step 4: Test storage explorer**

- List buckets, list files, test public URL generation
- Verify: results logged

**Step 5: Test autopwn**

- Run autopwn with database + storage + auth phases
- Verify: progress bar advances, results show permission matrix with badges

**Step 6: Test edge functions and realtime**

- Invoke a function, subscribe to changes
- Verify: responses logged, events stream in realtime panel

**Step 7: Fix any issues found during testing**

**Step 8: Final commit**

```bash
git add -A
git commit -m "feat: supabase-pwn v0.1.0 - complete security testing tool"
```
