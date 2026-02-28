# supabase-pwn

A web-based Supabase security testing toolkit for penetration testers. Point it at any Supabase project URL with an API key and start probing for misconfigurations — exposed tables, broken RLS policies, open signups, leaky storage buckets, and more.

Inspired by [firepwn-tool](https://github.com/0xbigshaq/firepwn-tool) (Firebase security testing), built for the Supabase ecosystem.

> **For authorized security testing only.** Always get explicit permission before testing projects you don't own.

---

## Features

- **Database Explorer** — SELECT / INSERT / UPDATE / DELETE against any discovered table with a filter builder, fake data auto-fill, and PATCH/PUT method toggle
- **Table Bruteforcer** — When the OpenAPI schema is blocked (publishable keys), bruteforce ~130 common table names with custom wordlist support
- **RPC Invoker** — Discover functions from the OpenAPI spec, see expected parameters, auto-populate args
- **Storage Explorer** — List buckets, browse files, upload/download/delete, generate public & signed URLs
- **Auth Probing** — Test sign-up, sign-in, anonymous auth, OAuth redirects, and inject bearer tokens
- **Edge Functions** — Invoke edge functions with custom bodies and headers
- **Realtime** — Subscribe to postgres changes, broadcast events, track presence
- **Autopwn Scanner** — Automated multi-phase scan covering database RLS, storage, auth, and edge functions with configurable concurrency
- **Output Log** — Color-coded activity log with JSON syntax highlighting, timestamps, and expandable payloads

## Supported API Keys

| Key Type | Prefix | Access Level |
|----------|--------|--------------|
| Publishable | `sb_publishable_` | Low privilege, schema blocked — use bruteforce |
| Secret | `sb_secret_` | Elevated, bypasses RLS |
| Anon (legacy JWT) | `eyJ...` with `role: anon` | Low privilege, schema accessible |
| Service Role (legacy JWT) | `eyJ...` with `role: service_role` | Elevated, bypasses RLS |

Key type is auto-detected from the prefix/JWT payload and displayed in the connection header.

## Getting Started

```bash
git clone https://github.com/user/supabase-pwn.git
cd supabase-pwn
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), enter a Supabase project URL and API key, and hit **Initialize**.

## Usage

### Manual Testing

1. **Connect** — Enter project URL + API key. The app fetches the OpenAPI spec to discover tables, columns, and RPC functions. If the spec is blocked, use the Bruteforce button.
2. **Database** — Select a table, build queries with filters, auto-fill insert data, send SELECT results to the Update tab with one click.
3. **Storage** — List buckets, browse file trees, test upload/download permissions.
4. **Auth** — Try signing up, signing in, creating anonymous sessions, or pasting intercepted JWTs into the Bearer Token tab.
5. **Edge Functions** — Invoke by name with custom request bodies and headers.
6. **Realtime** — Subscribe to channels and watch for postgres changes, broadcasts, or presence events.

### Automated Scanning

Switch to the **Autopwn** tab, configure which phases to run (Database RLS, Storage, Auth, Edge Functions), set concurrency, optionally add custom table names, and hit **Start Scan**. Results appear as a color-coded permission matrix showing what's accessible.

## Tech Stack

| | |
|---|---|
| Framework | Next.js 16, React 19 |
| Language | TypeScript 5 |
| Styling | Tailwind CSS v4 |
| Components | shadcn/ui (Radix primitives) |
| Supabase | @supabase/supabase-js v2 |
| Layout | react-resizable-panels |
| Syntax Highlighting | prism-react-renderer |

## Project Structure

```
app/
  layout.tsx              Root layout (providers, fonts, theme)
  page.tsx                Main split-pane UI with tab navigation
  globals.css             Tailwind v4 theme variables

components/supabase-pwn/
  init-form.tsx           Connection form with key type detection
  auth-panel.tsx          Auth testing (sign-in/up, anon, OAuth, bearer)
  database-explorer.tsx   CRUD operations, filter builder, bruteforce
  storage-explorer.tsx    Bucket & file operations
  edge-functions.tsx      Edge function invocation
  realtime.tsx            Channel subscriptions & event stream
  autopwn.tsx             Automated multi-phase scanner
  output-log.tsx          Activity log viewer
  header.tsx              App header

lib/
  supabase-context.tsx    State management, schema parsing, table bruteforce
  utils.ts                Tailwind class merge utility
```

## License

MIT
