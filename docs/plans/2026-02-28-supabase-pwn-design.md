# supabase-pwn Design Document

## Overview

supabase-pwn is a Supabase security testing tool for pentesters, inspired by [firepwn-tool](https://github.com/0xbigshaq/firepwn-tool). It uses the official Supabase JavaScript client SDK (`@supabase/supabase-js`) to mimic real client behavior and test Supabase projects for misconfigurations — RLS bypasses, exposed data, auth weaknesses, storage leaks, and more.

## Tech Stack

- **Framework:** Next.js 16 + React 19 + TypeScript
- **UI:** shadcn/ui (Radix primitives) + Tailwind CSS v4
- **Supabase SDK:** `@supabase/supabase-js` (latest)
- **Layout:** `react-resizable-panels` for split-pane
- **Syntax highlighting:** `prism-react-renderer`
- **Toasts:** `sonner`
- **Theming:** `next-themes` (dark mode default)
- **Fonts:** Inter (sans) + JetBrains Mono (mono)

## Architecture

### State Management

Single React Context (`SupabaseProvider` / `useSupabase()`) managing:
- Supabase client instance
- Connection/init status
- Current auth user + session
- Discovered schema (tables, views, functions from OpenAPI spec)
- Shared output log entries

### Layout

```
+-------------------------------------------------------+
|  [Shield icon] supabase-pwn                [GitHub]    |
+-------------------------------------------------------+
|  INIT FORM (collapsible after connection)              |
|  Project URL + Anon Key                                |
+------------------------------------------+-------------+
|  MAIN TABS (70% width)                   | AUTH (30%)  |
|  [Database | Storage | Edge Funcs |      |             |
|   Realtime | Autopwn]                    | Sign Up     |
|                                          | Sign In     |
|  (active tab content)                    | Anonymous   |
|                                          | OAuth       |
|                                          | User info   |
+------------------------------------------+-------------+
|  OUTPUT LOG (resizable bottom panel)                   |
|  Timestamped, color-coded, JSON-highlighted entries    |
+-------------------------------------------------------+
```

## Modules

### 1. Init Form (`init-form.tsx`)

- **Inputs:** Project URL (`https://xxx.supabase.co`), Anon Key
- Auto-extracts project ref from URL
- Persists config to localStorage
- On init: creates Supabase client + fetches OpenAPI spec from `/rest/v1/` for schema discovery
- Collapses after successful connection, shows "Connected" badge

### 2. Auth Panel (`auth-panel.tsx`)

Side panel, always visible when initialized. Sub-tabs:
- **Sign Up** — email/password registration via `supabase.auth.signUp()`
- **Sign In** — email/password login via `supabase.auth.signInWithPassword()`
- **Anonymous** — `supabase.auth.signInAnonymously()`
- **OAuth** — provider dropdown (Google, GitHub, Discord, etc.) via `supabase.auth.signInWithOAuth()`
- **MFA** — enroll/challenge/verify flows

Displays when authenticated:
- Email, UID, role
- JWT claims (app_metadata, user_metadata)
- Copy-to-clipboard buttons
- Sign out button

### 3. Database Explorer (`database-explorer.tsx`)

- **Table selector** — dropdown populated from OpenAPI spec (tables + views)
- **Operations:** Select, Insert, Update, Upsert, Delete
- **Query builder** for Select:
  - Column selection
  - Filters: eq, neq, gt, gte, lt, lte, like, ilike, in, contains, is
  - Order by (field + direction)
  - Limit and range
- **RPC caller** — function name + JSON args editor
- **Results** — syntax-highlighted JSON with row count

### 4. Storage Explorer (`storage-explorer.tsx`)

- **Bucket listing** via `supabase.storage.listBuckets()`
- **Operations per bucket:**
  - List files (with folder path + limit)
  - Upload file (file picker + path)
  - Download file
  - Delete file(s)
  - Get metadata
- **URL generators:**
  - Public URL (for public buckets)
  - Signed URL (with configurable expiry)

### 5. Edge Functions (`edge-functions.tsx`)

- **Function name** input
- **Request body** — JSON editor
- **Custom headers** — key/value pairs
- **Invoke** via `supabase.functions.invoke()`
- **Response display** — status code, headers, body with syntax highlighting

### 6. Realtime (`realtime.tsx`)

- **Channel subscription manager**
- **Postgres Changes** listener:
  - Schema selector
  - Table selector
  - Event type (INSERT, UPDATE, DELETE, *)
- **Broadcast** — send/receive custom events
- **Presence** — track/untrack + sync display
- **Live event stream** with timestamps

### 7. Autopwn (`autopwn.tsx`)

Automated scanner with phases:

1. **Reconnaissance** — Fetch OpenAPI spec, enumerate all tables/views/RPC functions
2. **Database RLS Testing** — For each discovered table:
   - Test SELECT as anon (no auth)
   - Test SELECT as authenticated (if logged in)
   - Test INSERT (write probe document)
   - Test UPDATE
   - Test DELETE (clean up probe)
3. **Storage Scanning** — Enumerate buckets, test public access, list files, test upload/delete
4. **Auth Probing** — Test signup availability, anonymous auth, user enumeration patterns
5. **Edge Function Discovery** — Test common function name patterns

**Configuration:**
- Concurrency (5-50 concurrent requests)
- Scan scope (all phases or specific phases)
- Custom table names to test (in addition to discovered ones)
- Write testing toggle (opt-in, since it modifies data)

**Results:**
- Permission matrix with color-coded badges: Allowed (green), Denied (red), Error (yellow)
- Collapsible detail per table/bucket/function
- Abort capability

### 8. Output Log (`output-log.tsx`)

- **Log types:** info, error, success, warning (color-coded)
- **Features:** timestamps, JSON syntax highlighting, URL linkification
- **Controls:** sort toggle (newest/oldest), auto-scroll, clear, entry count
- Resizable bottom panel with direction toggle

## File Structure

```
app/
  layout.tsx              — Root layout, fonts, theme
  page.tsx                — Main page with resizable panels
  globals.css             — Global styles + CSS variables
components/
  supabase-pwn/
    header.tsx            — App header + branding
    init-form.tsx         — Connection configuration
    auth-panel.tsx        — Authentication module
    database-explorer.tsx — Database CRUD + queries
    storage-explorer.tsx  — Storage operations
    edge-functions.tsx    — Edge function invocation
    realtime.tsx          — Realtime subscriptions
    autopwn.tsx           — Automated scanner
    output-log.tsx        — Log viewer
  ui/                     — shadcn/ui components
  theme-provider.tsx      — next-themes provider
lib/
  supabase-context.tsx    — Supabase state + context provider
  utils.ts                — Utility functions (cn, etc.)
```

## Key Dependencies

```
@supabase/supabase-js    — Supabase client SDK
react-resizable-panels   — Split pane layout
prism-react-renderer     — Syntax highlighting
sonner                   — Toast notifications
next-themes              — Dark/light theme
react-hook-form          — Form handling
zod                      — Schema validation
```
