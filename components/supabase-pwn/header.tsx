import { Shield } from "lucide-react"

export function Header() {
  return (
    <header className="flex items-center justify-between border-b border-border px-4 py-3">
      <div className="flex items-center gap-2">
        <Shield className="h-6 w-6 text-emerald-500" />
        <h1 className="text-lg font-bold tracking-tight">supabase-pwn</h1>
      </div>
      <a
        href="https://github.com/user/supabase-pwn"
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        GitHub
      </a>
    </header>
  )
}
