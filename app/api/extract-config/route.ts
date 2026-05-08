import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_SCRIPTS = 60
const MAX_CRAWL_LINKS = 20
const MAX_BYTES_PER_FILE = 5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000
const CONCURRENCY = 8
const MAX_DISCOVERED_IDENTIFIERS = 200

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

const SUPABASE_URL_RE = /https?:\/\/([a-z0-9]+)\.supabase\.(?:co|in)/gi
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
const PUBLISHABLE_RE = /sb_publishable_[A-Za-z0-9_-]{16,}/g
const SECRET_RE = /sb_secret_[A-Za-z0-9_-]{16,}/g

// Identifier discovery from JS bundles ----------------------------------------
//   .from('table')   .from("table")
//   .rpc('fn')       .rpc("fn")
//   .functions.invoke('fn')
//   .schema('xxx')   (rare, but worth grabbing)
const FROM_RE = /\.from\s*\(\s*["'`]([A-Za-z_][A-Za-z0-9_]{0,63})["'`]\s*\)/g
const RPC_RE = /\.rpc\s*\(\s*["'`]([A-Za-z_][A-Za-z0-9_]{0,63})["'`]/g
const INVOKE_RE = /\.functions\s*\.\s*invoke\s*\(\s*["'`]([A-Za-z0-9_-]{1,80})["'`]/g

// Common postgres / supabase builtins we never want to surface as "discovered"
const IDENT_BLOCKLIST = new Set([
  "auth", "users", "json", "jsonb", "text", "boolean", "integer",
])

type KeyKind = "anon" | "service_role" | "publishable" | "secret" | "unknown_jwt"

type FoundKey = {
  key: string
  kind: KeyKind
  ref?: string
}

type ExtractHit = {
  source: string
  projectUrl?: string
  ref?: string
  keys: FoundKey[]
}

type Candidate = {
  projectUrl: string
  ref: string
  apiKey: string | null
  keyKind: KeyKind | null
  source: string | null
}

function decodeJwt(token: string): { role?: string; ref?: string } | null {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null
    const payloadB64 = parts[1].replace(/-/g, "+").replace(/_/g, "/")
    const padded = payloadB64 + "=".repeat((4 - (payloadB64.length % 4)) % 4)
    const json = Buffer.from(padded, "base64").toString("utf8")
    const obj = JSON.parse(json)
    return { role: obj.role, ref: obj.ref }
  } catch {
    return null
  }
}

function classifyJwt(token: string): { kind: KeyKind; ref?: string } {
  const decoded = decodeJwt(token)
  if (!decoded) return { kind: "unknown_jwt" }
  if (decoded.role === "anon") return { kind: "anon", ref: decoded.ref }
  if (decoded.role === "service_role") return { kind: "service_role", ref: decoded.ref }
  return { kind: "unknown_jwt", ref: decoded.ref }
}

async function fetchWithLimit(
  url: string,
  init?: RequestInit,
): Promise<{ body: string; contentType: string } | null> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      ...init,
      signal: ctrl.signal,
      headers: {
        "user-agent": UA,
        accept: "*/*",
        ...(init?.headers ?? {}),
      },
      redirect: "follow",
    })
    if (!res.ok || !res.body) return null

    const contentType = res.headers.get("content-type") ?? ""
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let total = 0
    let body = ""
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_BYTES_PER_FILE) {
        try { await reader.cancel() } catch { /* ignore */ }
        break
      }
      body += decoder.decode(value, { stream: true })
    }
    body += decoder.decode()
    return { body, contentType }
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

function extractScriptUrls(html: string, baseUrl: string): {
  external: string[]
  inline: string[]
} {
  const external: string[] = []
  const inline: string[] = []
  const tagRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi
  let m: RegExpExecArray | null
  while ((m = tagRe.exec(html)) !== null) {
    const attrs = m[1]
    const inner = m[2]
    const srcMatch = /\bsrc\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))/i.exec(attrs)
    if (srcMatch) {
      const raw = srcMatch[1] ?? srcMatch[2] ?? srcMatch[3]
      if (!raw) continue
      try {
        external.push(new URL(raw, baseUrl).toString())
      } catch { /* ignore bad URL */ }
    } else if (inner && inner.trim().length > 0) {
      inline.push(inner)
    }
  }
  return { external, inline }
}

function extractSameOriginLinks(html: string, baseUrl: string): string[] {
  const out: string[] = []
  const base = new URL(baseUrl)
  const aRe = /<a\b[^>]*\bhref\s*=\s*(?:"([^"#?]+)"|'([^'#?]+)')/gi
  let m: RegExpExecArray | null
  while ((m = aRe.exec(html)) !== null) {
    const raw = m[1] ?? m[2]
    if (!raw) continue
    try {
      const u = new URL(raw, baseUrl)
      if (u.origin !== base.origin) continue
      if (u.pathname === base.pathname) continue
      // Strip fragment / query for dedup
      u.hash = ""
      out.push(u.toString())
    } catch { /* ignore */ }
  }
  return out
}

function scanForSupabase(text: string, source: string): ExtractHit | null {
  const urlMatches = new Set<string>()
  const refs = new Set<string>()
  let urlMatch: RegExpExecArray | null
  SUPABASE_URL_RE.lastIndex = 0
  while ((urlMatch = SUPABASE_URL_RE.exec(text)) !== null) {
    urlMatches.add(urlMatch[0])
    refs.add(urlMatch[1].toLowerCase())
  }

  const keys: FoundKey[] = []
  const seenKeys = new Set<string>()

  let jwtMatch: RegExpExecArray | null
  JWT_RE.lastIndex = 0
  while ((jwtMatch = JWT_RE.exec(text)) !== null) {
    const tok = jwtMatch[0]
    if (seenKeys.has(tok)) continue
    seenKeys.add(tok)
    const { kind, ref } = classifyJwt(tok)
    if (kind === "unknown_jwt") continue
    keys.push({ key: tok, kind, ref })
  }

  let pubMatch: RegExpExecArray | null
  PUBLISHABLE_RE.lastIndex = 0
  while ((pubMatch = PUBLISHABLE_RE.exec(text)) !== null) {
    if (seenKeys.has(pubMatch[0])) continue
    seenKeys.add(pubMatch[0])
    keys.push({ key: pubMatch[0], kind: "publishable" })
  }

  let secMatch: RegExpExecArray | null
  SECRET_RE.lastIndex = 0
  while ((secMatch = SECRET_RE.exec(text)) !== null) {
    if (seenKeys.has(secMatch[0])) continue
    seenKeys.add(secMatch[0])
    keys.push({ key: secMatch[0], kind: "secret" })
  }

  if (urlMatches.size === 0 && keys.length === 0) return null

  const projectUrl = [...urlMatches][0]
  const ref = projectUrl
    ? new URL(projectUrl).hostname.split(".")[0].toLowerCase()
    : [...refs][0]

  return { source, projectUrl, ref, keys }
}

function scanForIdentifiers(text: string): {
  tables: Set<string>
  functions: Set<string>
} {
  const tables = new Set<string>()
  const functions = new Set<string>()

  const collect = (re: RegExp, into: Set<string>) => {
    re.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = re.exec(text)) !== null) {
      const ident = m[1]
      if (!ident) continue
      if (IDENT_BLOCKLIST.has(ident)) continue
      into.add(ident)
      if (into.size >= MAX_DISCOVERED_IDENTIFIERS) break
    }
  }

  collect(FROM_RE, tables)
  collect(RPC_RE, functions)
  collect(INVOKE_RE, functions)

  return { tables, functions }
}

async function runConcurrent<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  concurrency: number,
): Promise<void> {
  let idx = 0
  const runners = new Array(Math.min(concurrency, items.length || 1))
    .fill(0)
    .map(async () => {
      while (idx < items.length) {
        const i = idx++
        await worker(items[i])
      }
    })
  await Promise.all(runners)
}

const rankKind = (k: KeyKind): number =>
  k === "anon" ? 4 : k === "publishable" ? 3 : k === "service_role" ? 2 : k === "unknown_jwt" ? 1 : 0

function buildCandidates(hits: ExtractHit[]): Candidate[] {
  // Group by project ref
  const refToUrl = new Map<string, string>()
  const refToKeys = new Map<string, FoundKey[]>()
  const refToSource = new Map<string, string>()

  for (const h of hits) {
    if (h.projectUrl && h.ref) {
      if (!refToUrl.has(h.ref)) refToUrl.set(h.ref, h.projectUrl)
      if (!refToSource.has(h.ref)) refToSource.set(h.ref, h.source)
    }
    for (const k of h.keys) {
      const ref = k.ref ?? h.ref
      if (!ref) continue
      if (!refToKeys.has(ref)) refToKeys.set(ref, [])
      refToKeys.get(ref)!.push(k)
    }
  }

  const candidates: Candidate[] = []
  for (const [ref, url] of refToUrl) {
    const keys = (refToKeys.get(ref) ?? []).filter((k) => k.kind !== "secret")
    keys.sort((a, b) => rankKind(b.kind) - rankKind(a.kind))
    const best = keys[0]
    candidates.push({
      projectUrl: url,
      ref,
      apiKey: best?.key ?? null,
      keyKind: best?.kind ?? null,
      source: refToSource.get(ref) ?? null,
    })
  }

  // Also surface keys whose ref didn't appear as a URL (rare — JWT but URL hidden behind a build-time const)
  for (const [ref, keys] of refToKeys) {
    if (refToUrl.has(ref)) continue
    const usable = keys.filter((k) => k.kind !== "secret")
    if (usable.length === 0) continue
    usable.sort((a, b) => rankKind(b.kind) - rankKind(a.kind))
    candidates.push({
      projectUrl: `https://${ref}.supabase.co`,
      ref,
      apiKey: usable[0].key,
      keyKind: usable[0].kind,
      source: null,
    })
  }

  // Sort: candidates with anon key first, then by ref
  candidates.sort((a, b) => {
    const ra = a.keyKind ? rankKind(a.keyKind) : -1
    const rb = b.keyKind ? rankKind(b.keyKind) : -1
    if (rb !== ra) return rb - ra
    return a.ref.localeCompare(b.ref)
  })

  return candidates
}

async function processEntry(
  entryUrl: string,
  hits: ExtractHit[],
  scannedScripts: Set<string>,
  identTables: Set<string>,
  identFunctions: Set<string>,
  alsoCrawl: boolean,
  crawlBudgetRef: { remaining: number },
): Promise<string[]> {
  const entry = await fetchWithLimit(entryUrl)
  if (!entry) return []

  // Scan entry HTML body
  const entryHit = scanForSupabase(entry.body, entryUrl)
  if (entryHit) hits.push(entryHit)
  const entryIdents = scanForIdentifiers(entry.body)
  for (const t of entryIdents.tables) identTables.add(t)
  for (const f of entryIdents.functions) identFunctions.add(f)

  const { external, inline } = extractScriptUrls(entry.body, entryUrl)

  for (let i = 0; i < inline.length; i++) {
    const src = `${entryUrl}#inline-${i}`
    const h = scanForSupabase(inline[i], src)
    if (h) hits.push(h)
    const idents = scanForIdentifiers(inline[i])
    for (const t of idents.tables) identTables.add(t)
    for (const f of idents.functions) identFunctions.add(f)
  }

  const newScripts = [...new Set(external)].filter((u) => !scannedScripts.has(u))
  const cap = Math.max(0, MAX_SCRIPTS - scannedScripts.size)
  const toFetch = newScripts.slice(0, cap)

  await runConcurrent(
    toFetch,
    async (u) => {
      scannedScripts.add(u)
      const r = await fetchWithLimit(u)
      if (!r) return
      const h = scanForSupabase(r.body, u)
      if (h) hits.push(h)
      const idents = scanForIdentifiers(r.body)
      for (const t of idents.tables) identTables.add(t)
      for (const f of idents.functions) identFunctions.add(f)
    },
    CONCURRENCY,
  )

  if (alsoCrawl && crawlBudgetRef.remaining > 0) {
    const links = extractSameOriginLinks(entry.body, entryUrl)
    return links.slice(0, crawlBudgetRef.remaining)
  }
  return []
}

export async function POST(req: Request) {
  let body: { url?: string; urls?: string[]; crawl?: boolean }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  // Collect input URLs (single or list)
  const rawList: string[] = []
  if (body.url && body.url.trim()) rawList.push(body.url.trim())
  if (Array.isArray(body.urls)) {
    for (const u of body.urls) {
      if (typeof u === "string" && u.trim()) rawList.push(u.trim())
    }
  }

  if (rawList.length === 0) {
    return NextResponse.json({ error: "Provide 'url' or 'urls'" }, { status: 400 })
  }

  const targets: string[] = []
  for (const raw of rawList) {
    try {
      const u = new URL(raw)
      if (u.protocol !== "http:" && u.protocol !== "https:") continue
      targets.push(u.toString())
    } catch { /* skip bad URL */ }
  }
  if (targets.length === 0) {
    return NextResponse.json(
      { error: "No valid http(s) URLs in request" },
      { status: 400 },
    )
  }

  const hits: ExtractHit[] = []
  const scannedScripts = new Set<string>()
  const identTables = new Set<string>()
  const identFunctions = new Set<string>()
  const seenEntries = new Set<string>()
  const queue: string[] = [...new Set(targets)]
  const crawlBudgetRef = { remaining: body.crawl ? MAX_CRAWL_LINKS : 0 }

  while (queue.length > 0) {
    const next = queue.shift()!
    if (seenEntries.has(next)) continue
    seenEntries.add(next)

    const newLinks = await processEntry(
      next,
      hits,
      scannedScripts,
      identTables,
      identFunctions,
      Boolean(body.crawl),
      crawlBudgetRef,
    )

    for (const l of newLinks) {
      if (crawlBudgetRef.remaining <= 0) break
      if (seenEntries.has(l) || queue.includes(l)) continue
      queue.push(l)
      crawlBudgetRef.remaining--
    }
  }

  if (hits.length === 0) {
    return NextResponse.json({
      candidates: [],
      projectUrl: null,
      apiKey: null,
      keyKind: null,
      source: null,
      discoveredTables: [],
      discoveredFunctions: [],
      scannedEntries: seenEntries.size,
      scannedScripts: scannedScripts.size,
    })
  }

  const candidates = buildCandidates(hits)
  const best = candidates[0] ?? null

  return NextResponse.json({
    candidates,
    projectUrl: best?.projectUrl ?? null,
    apiKey: best?.apiKey ?? null,
    keyKind: best?.keyKind ?? null,
    source: best?.source ?? null,
    discoveredTables: [...identTables].sort(),
    discoveredFunctions: [...identFunctions].sort(),
    scannedEntries: seenEntries.size,
    scannedScripts: scannedScripts.size,
  })
}
