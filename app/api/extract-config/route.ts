import { NextResponse } from "next/server"

export const runtime = "nodejs"
export const dynamic = "force-dynamic"

const MAX_SCRIPTS = 50
const MAX_BYTES_PER_FILE = 5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 15_000
const CONCURRENCY = 8

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"

const SUPABASE_URL_RE = /https?:\/\/([a-z0-9]+)\.supabase\.(?:co|in)/gi
const JWT_RE = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g
const PUBLISHABLE_RE = /sb_publishable_[A-Za-z0-9_-]{16,}/g
const SECRET_RE = /sb_secret_[A-Za-z0-9_-]{16,}/g

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

async function runConcurrent<T>(
  items: T[],
  worker: (item: T) => Promise<void>,
  concurrency: number,
): Promise<void> {
  let idx = 0
  const runners = new Array(Math.min(concurrency, items.length))
    .fill(0)
    .map(async () => {
      while (idx < items.length) {
        const i = idx++
        await worker(items[i])
      }
    })
  await Promise.all(runners)
}

function pickBestResult(hits: ExtractHit[]): {
  projectUrl: string | null
  apiKey: string | null
  keyKind: KeyKind | null
  source: string | null
  allHits: ExtractHit[]
} {
  // Pair URL refs with keys whose JWT ref matches; prefer anon > publishable > unknown.
  const allUrls = new Map<string, string>()
  for (const h of hits) {
    if (h.projectUrl && h.ref) allUrls.set(h.ref, h.projectUrl)
  }

  const rankKind = (k: KeyKind): number =>
    k === "anon" ? 4 : k === "publishable" ? 3 : k === "service_role" ? 2 : k === "unknown_jwt" ? 1 : 0

  let best: { url: string; key: FoundKey; source: string } | null = null
  for (const h of hits) {
    for (const k of h.keys) {
      if (k.kind === "secret") continue
      const url = (k.ref && allUrls.get(k.ref)) ?? h.projectUrl ?? [...allUrls.values()][0]
      if (!url) continue
      if (!best || rankKind(k.kind) > rankKind(best.key.kind)) {
        best = { url, key: k, source: h.source }
      }
    }
  }

  if (best) {
    return {
      projectUrl: best.url,
      apiKey: best.key.key,
      keyKind: best.key.kind,
      source: best.source,
      allHits: hits,
    }
  }

  // No usable key — fall back to URL only
  const firstUrl = [...allUrls.values()][0] ?? null
  return {
    projectUrl: firstUrl,
    apiKey: null,
    keyKind: null,
    source: firstUrl ? hits.find((h) => h.projectUrl === firstUrl)?.source ?? null : null,
    allHits: hits,
  }
}

export async function POST(req: Request) {
  let body: { url?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const targetRaw = body.url?.trim()
  if (!targetRaw) {
    return NextResponse.json({ error: "Missing 'url' in request body" }, { status: 400 })
  }

  let target: URL
  try {
    target = new URL(targetRaw)
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 })
  }
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return NextResponse.json({ error: "Only http(s) URLs are supported" }, { status: 400 })
  }

  // 1. Fetch entry page
  const entry = await fetchWithLimit(target.toString())
  if (!entry) {
    return NextResponse.json(
      { error: `Failed to fetch ${target.toString()}` },
      { status: 502 },
    )
  }

  const hits: ExtractHit[] = []
  const scanned: string[] = [target.toString()]

  // Scan entry HTML body itself (often inlines config)
  const entryHit = scanForSupabase(entry.body, target.toString())
  if (entryHit) hits.push(entryHit)

  // 2. Extract scripts referenced from the page
  const { external, inline } = extractScriptUrls(entry.body, target.toString())

  for (let i = 0; i < inline.length; i++) {
    const h = scanForSupabase(inline[i], `${target.toString()}#inline-${i}`)
    if (h) hits.push(h)
  }

  // 3. Fetch external scripts in parallel (capped)
  const scriptUrls = [...new Set(external)].slice(0, MAX_SCRIPTS)
  await runConcurrent(
    scriptUrls,
    async (u) => {
      scanned.push(u)
      const r = await fetchWithLimit(u)
      if (!r) return
      const h = scanForSupabase(r.body, u)
      if (h) hits.push(h)
    },
    CONCURRENCY,
  )

  const result = pickBestResult(hits)

  return NextResponse.json({
    ...result,
    scannedCount: scanned.length,
    scriptsFound: external.length,
  })
}
