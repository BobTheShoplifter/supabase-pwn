import { Shield, Github } from "lucide-react"

export function Header() {
  return (
    <header className="relative">
      {/* Accent gradient line */}
      <div className="h-[2px] bg-gradient-to-r from-transparent via-primary to-transparent" />

      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <div className="flex items-center gap-2.5">
          <div className="relative">
            <Shield className="h-5 w-5 text-primary" />
            <div className="absolute inset-0 blur-md bg-primary/30 -z-10" />
          </div>
          <h1 className="text-sm font-semibold tracking-widest uppercase text-foreground">
            supabase-pwn
          </h1>
          <span className="text-[10px] font-mono text-muted-foreground border border-border rounded px-1.5 py-0.5 leading-none">
            v1.0
          </span>
        </div>
        <a
          href="https://github.com/BobTheShoplifter/supabase-pwn"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors"
        >
          <Github className="h-3.5 w-3.5" />
          GitHub
        </a>
      </div>
    </header>
  )
}
