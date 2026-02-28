"use client"

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { ArrowUpDown, Trash2 } from "lucide-react"
import { Highlight, themes } from "prism-react-renderer"

import { useSupabase } from "@/lib/supabase-context"
import type { LogEntry } from "@/lib/supabase-context"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { ScrollArea } from "@/components/ui/scroll-area"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(date: Date): string {
  const h = String(date.getHours()).padStart(2, "0")
  const m = String(date.getMinutes()).padStart(2, "0")
  const s = String(date.getSeconds()).padStart(2, "0")
  const ms = String(date.getMilliseconds()).padStart(3, "0")
  return `${h}:${m}:${s}.${ms}`
}

const TYPE_STYLES: Record<
  LogEntry["type"],
  { bg: string; text: string; label: string }
> = {
  info: {
    bg: "bg-blue-500/20",
    text: "text-blue-400",
    label: "INFO",
  },
  success: {
    bg: "bg-green-500/20",
    text: "text-green-400",
    label: "OK",
  },
  error: {
    bg: "bg-red-500/20",
    text: "text-red-400",
    label: "ERR",
  },
  warning: {
    bg: "bg-yellow-500/20",
    text: "text-yellow-400",
    label: "WARN",
  },
}

// ---------------------------------------------------------------------------
// Individual log row -- extracted so React.memo can skip re-renders
// ---------------------------------------------------------------------------

const LogRow = React.memo(function LogRow({ entry }: { entry: LogEntry }) {
  const style = TYPE_STYLES[entry.type]
  const [expanded, setExpanded] = useState(false)

  const jsonString = useMemo(() => {
    if (entry.data === undefined) return null
    try {
      return JSON.stringify(entry.data, null, 2)
    } catch {
      return String(entry.data)
    }
  }, [entry.data])

  return (
    <div className="group flex flex-col border-b border-border/40 px-3 py-1.5 hover:bg-muted/30 text-sm font-mono">
      <div className="flex items-start gap-2">
        {/* Timestamp */}
        <span className="shrink-0 text-xs text-muted-foreground">
          {formatTimestamp(entry.timestamp)}
        </span>

        {/* Type badge */}
        <Badge
          variant="outline"
          className={`shrink-0 rounded px-1.5 py-0 text-[10px] font-bold leading-5 border-0 ${style.bg} ${style.text}`}
        >
          {style.label}
        </Badge>

        {/* Message */}
        <span className="min-w-0 break-words text-foreground">
          {entry.message}
        </span>

        {/* Data toggle */}
        {jsonString !== null && (
          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="ml-auto shrink-0 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? "hide" : "data"}
          </button>
        )}
      </div>

      {/* Collapsible JSON block */}
      {expanded && jsonString !== null && (
        <div className="mt-1 ml-[7.5rem]">
          <Highlight theme={themes.vsDark} code={jsonString} language="json">
            {({ style: preStyle, tokens, getLineProps, getTokenProps }) => (
              <pre
                style={preStyle}
                className="text-xs p-2 rounded overflow-x-auto"
              >
                {tokens.map((line, i) => (
                  <div key={i} {...getLineProps({ line })}>
                    {line.map((token, key) => (
                      <span key={key} {...getTokenProps({ token })} />
                    ))}
                  </div>
                ))}
              </pre>
            )}
          </Highlight>
        </div>
      )}
    </div>
  )
})

// ---------------------------------------------------------------------------
// OutputLog component
// ---------------------------------------------------------------------------

export function OutputLog() {
  const { logs, clearLogs } = useSupabase()
  const [newestFirst, setNewestFirst] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // Track whether the user has scrolled up (to pause auto-scroll)
  const [autoScroll, setAutoScroll] = useState(true)

  const sortedLogs = useMemo(() => {
    if (!newestFirst) return logs
    return [...logs].reverse()
  }, [logs, newestFirst])

  // Auto-scroll to bottom on new entries (only when sorting oldest-first)
  useEffect(() => {
    if (!newestFirst && autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [logs.length, newestFirst, autoScroll])

  // Detect if user scrolls away from the bottom
  const handleScroll = useCallback(() => {
    const el = scrollContainerRef.current
    if (!el) return
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight
    setAutoScroll(distanceFromBottom < 40)
  }, [])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Controls bar */}
      <div className="flex items-center gap-2 border-b border-border px-3 py-1.5 shrink-0">
        <span className="text-xs font-medium text-muted-foreground mr-auto">
          Output Log
        </span>

        <Badge variant="secondary" className="text-[10px] tabular-nums">
          {logs.length} {logs.length === 1 ? "entry" : "entries"}
        </Badge>

        <Button
          variant="ghost"
          size="icon-xs"
          onClick={() => setNewestFirst((prev) => !prev)}
          title={newestFirst ? "Showing newest first" : "Showing oldest first"}
        >
          <ArrowUpDown className="size-3.5" />
        </Button>

        <Button
          variant="ghost"
          size="icon-xs"
          onClick={clearLogs}
          title="Clear logs"
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>

      {/* Log entries */}
      {logs.length === 0 ? (
        <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
          No log entries yet.
        </div>
      ) : (
        <ScrollArea className="flex-1">
          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            className="h-full overflow-y-auto"
          >
            {sortedLogs.map((entry) => (
              <LogRow key={entry.id} entry={entry} />
            ))}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      )}
    </div>
  )
}
