import type { ScanRecord } from "./scan-history"

function escapeMd(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ")
}

export function formatMarkdownReport(record: ScanRecord): string {
  const lines: string[] = []
  lines.push(`# Supabase AutoPwn Report`)
  lines.push("")
  lines.push(`- **Project:** \`${record.projectUrl}\``)
  lines.push(`- **Key type:** ${record.keyType}`)
  lines.push(`- **Generated:** ${record.timestamp}`)
  lines.push("")

  // Summary --------------------------------------------------------------
  const exposed = record.db.filter((r) => r.select === "allowed").length
  const empty = record.db.filter((r) => r.select === "empty").length
  const writable = record.db.filter((r) => r.insert === "allowed").length
  const publicBuckets = record.storage.filter((r) => r.public).length
  const listableBuckets = record.storage.filter((r) => r.listable === "allowed").length
  const authOpen = record.auth.filter((r) => r.status === "enabled").length
  const fnsFound = record.functions.filter((r) => r.status === "found").length

  lines.push(`## Summary`)
  lines.push("")
  lines.push(`- ${exposed}/${record.db.length} tables expose data`)
  if (empty > 0) lines.push(`- ${empty} tables return 200 OK with 0 rows`)
  if (writable > 0) lines.push(`- ${writable} tables accept INSERT`)
  if (record.storage.length > 0) {
    lines.push(`- ${record.storage.length} bucket(s) found, ${publicBuckets} public, ${listableBuckets} listable`)
  }
  if (record.auth.length > 0) lines.push(`- ${authOpen}/${record.auth.length} auth features open`)
  if (record.functions.length > 0) lines.push(`- ${fnsFound}/${record.functions.length} edge functions discovered`)
  lines.push("")

  // Database -------------------------------------------------------------
  if (record.db.length > 0) {
    lines.push(`## Database (RLS)`)
    lines.push("")
    lines.push(`| Table | SELECT | INSERT | UPDATE | DELETE | Details |`)
    lines.push(`| --- | --- | --- | --- | --- | --- |`)
    for (const r of record.db) {
      lines.push(
        `| \`${escapeMd(r.name)}\` | ${r.select ?? "-"} | ${r.insert ?? "-"} | ${r.update ?? "-"} | ${r.delete ?? "-"} | ${escapeMd(r.details ?? "")} |`,
      )
    }
    lines.push("")
  }

  // Storage --------------------------------------------------------------
  if (record.storage.length > 0) {
    lines.push(`## Storage`)
    lines.push("")
    lines.push(`| Bucket | Public | Listable | Files |`)
    lines.push(`| --- | --- | --- | --- |`)
    for (const r of record.storage) {
      lines.push(
        `| \`${escapeMd(r.name)}\` | ${r.public ? "yes" : "no"} | ${r.listable} | ${r.fileCount ?? "-"} |`,
      )
    }
    lines.push("")
  }

  // Auth -----------------------------------------------------------------
  if (record.auth.length > 0) {
    lines.push(`## Auth`)
    lines.push("")
    lines.push(`| Feature | Status | Details |`)
    lines.push(`| --- | --- | --- |`)
    for (const r of record.auth) {
      lines.push(`| ${escapeMd(r.feature)} | ${r.status} | ${escapeMd(r.details ?? "")} |`)
    }
    lines.push("")
  }

  // Functions ------------------------------------------------------------
  if (record.functions.length > 0) {
    lines.push(`## Edge Functions`)
    lines.push("")
    lines.push(`| Name | Status |`)
    lines.push(`| --- | --- |`)
    for (const r of record.functions) {
      lines.push(`| \`${escapeMd(r.name)}\` | ${r.status} |`)
    }
    lines.push("")
  }

  return lines.join("\n")
}

export function downloadFile(filename: string, content: string, mime: string): void {
  if (typeof window === "undefined") return
  const blob = new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function reportFilenameBase(record: ScanRecord): string {
  let host = "supabase"
  try {
    host = new URL(record.projectUrl).hostname.split(".")[0] || "supabase"
  } catch { /* keep default */ }
  const ts = record.timestamp.replace(/[:.]/g, "-")
  return `autopwn-${host}-${ts}`
}
