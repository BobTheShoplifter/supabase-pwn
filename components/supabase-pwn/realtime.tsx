"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Radio,
  Send,
  Users,
  Trash2,
  Plus,
  X,
  Wifi,
  WifiOff,
} from "lucide-react"
import { Highlight, themes } from "prism-react-renderer"
import type { RealtimeChannel } from "@supabase/supabase-js"

import { useSupabase } from "@/lib/supabase-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ChannelEntry = {
  name: string
  channel: RealtimeChannel
}

type RealtimeEvent = {
  id: string
  timestamp: Date
  type: "postgres_changes" | "broadcast" | "presence_sync" | "presence_join" | "presence_leave" | "system"
  payload: unknown
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function eventBadgeColor(type: RealtimeEvent["type"]): string {
  switch (type) {
    case "postgres_changes":
      return "bg-blue-600 text-white"
    case "broadcast":
      return "bg-purple-600 text-white"
    case "presence_sync":
      return "bg-green-600 text-white"
    case "presence_join":
      return "bg-emerald-600 text-white"
    case "presence_leave":
      return "bg-orange-600 text-white"
    case "system":
      return "bg-gray-600 text-white"
    default:
      return "bg-gray-600 text-white"
  }
}

function formatTimestamp(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  })
}

function JsonBlock({ json }: { json: string }) {
  return (
    <Highlight theme={themes.vsDark} code={json} language="json">
      {({ style, tokens, getLineProps, getTokenProps }) => (
        <pre
          style={style}
          className="text-xs p-2 rounded overflow-x-auto max-h-48"
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
  )
}

// ---------------------------------------------------------------------------
// Channel Manager
// ---------------------------------------------------------------------------

function ChannelManager({
  channels,
  activeChannelName,
  onSubscribe,
  onUnsubscribe,
  onSelect,
}: {
  channels: ChannelEntry[]
  activeChannelName: string
  onSubscribe: (name: string) => void
  onUnsubscribe: (name: string) => void
  onSelect: (name: string) => void
}) {
  const [channelName, setChannelName] = useState("")

  const handleSubscribe = () => {
    const name = channelName.trim()
    if (!name) return
    onSubscribe(name)
    setChannelName("")
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Wifi className="size-4" />
          Channel Manager
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end gap-2">
          <div className="space-y-1.5 flex-1">
            <Label htmlFor="channel-name">Channel Name</Label>
            <Input
              id="channel-name"
              placeholder="e.g. my-channel"
              value={channelName}
              onChange={(e) => setChannelName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSubscribe()
              }}
            />
          </div>
          <Button size="sm" onClick={handleSubscribe} disabled={!channelName.trim()}>
            <Plus className="size-3.5" />
            Subscribe
          </Button>
        </div>

        {channels.length > 0 && (
          <>
            <Separator />
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Active Channels ({channels.length})
              </Label>
              <div className="space-y-1">
                {channels.map((ch) => (
                  <div
                    key={ch.name}
                    className={`flex items-center justify-between rounded px-2 py-1.5 text-sm cursor-pointer transition-colors ${
                      ch.name === activeChannelName
                        ? "bg-primary/10 border border-primary/30"
                        : "hover:bg-muted/40"
                    }`}
                    onClick={() => onSelect(ch.name)}
                  >
                    <span className="flex items-center gap-2">
                      <Wifi className="size-3 text-green-500" />
                      <span className="font-mono text-xs">{ch.name}</span>
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      onClick={(e) => {
                        e.stopPropagation()
                        onUnsubscribe(ch.name)
                      }}
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {channels.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No active channels. Create one above to get started.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Postgres Changes Section
// ---------------------------------------------------------------------------

function PostgresChangesSection({
  channel,
  channelName,
  tables,
  onEvent,
}: {
  channel: RealtimeChannel | null
  channelName: string
  tables: string[]
  onEvent: (event: RealtimeEvent) => void
}) {
  const { addLog } = useSupabase()

  const [schemaName, setSchemaName] = useState("public")
  const [table, setTable] = useState("")
  const [eventType, setEventType] = useState<string>("*")
  const [listening, setListening] = useState(false)

  const handleListen = useCallback(() => {
    if (!channel) {
      addLog("warning", "No active channel. Create a channel first via the Channel Manager.")
      return
    }

    const tableVal = table || undefined

    addLog(
      "info",
      `Subscribing to postgres_changes on channel "${channelName}" — event: ${eventType}, schema: ${schemaName}${tableVal ? `, table: ${tableVal}` : ""}`,
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const filter: any = {
      event: eventType,
      schema: schemaName,
    }
    if (tableVal) {
      filter.table = tableVal
    }

    channel
      .on("postgres_changes", filter, (payload) => {
        onEvent({
          id: crypto.randomUUID(),
          timestamp: new Date(),
          type: "postgres_changes",
          payload,
        })
        addLog("info", `Postgres change received on "${channelName}"`, payload)
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          setListening(true)
          addLog("success", `Subscribed to postgres_changes on "${channelName}"`)
        } else {
          addLog("info", `Channel "${channelName}" status: ${status}`)
        }
      })
  }, [channel, channelName, eventType, schemaName, table, addLog, onEvent])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Radio className="size-4" />
          Postgres Changes
          {listening && (
            <Badge className="bg-green-600 text-white text-[10px]">
              Listening
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="pg-schema">Schema</Label>
            <Input
              id="pg-schema"
              placeholder="public"
              value={schemaName}
              onChange={(e) => setSchemaName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Table</Label>
            <Select value={table} onValueChange={setTable}>
              <SelectTrigger>
                <SelectValue placeholder="All tables" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All tables</SelectItem>
                {tables.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label>Event Type</Label>
          <Select value={eventType} onValueChange={setEventType}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="*">* (all)</SelectItem>
              <SelectItem value="INSERT">INSERT</SelectItem>
              <SelectItem value="UPDATE">UPDATE</SelectItem>
              <SelectItem value="DELETE">DELETE</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <Button
          size="sm"
          onClick={handleListen}
          disabled={!channel}
        >
          <Radio className="size-3.5" />
          Listen
        </Button>

        {!channel && (
          <p className="text-xs text-muted-foreground">
            Create and select a channel first.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Broadcast Section
// ---------------------------------------------------------------------------

function BroadcastSection({
  channel,
  channelName,
}: {
  channel: RealtimeChannel | null
  channelName: string
}) {
  const { addLog } = useSupabase()

  const [eventName, setEventName] = useState("")
  const [payloadJson, setPayloadJson] = useState('{\n  "message": "hello"\n}')
  const [sending, setSending] = useState(false)

  const handleSend = useCallback(async () => {
    if (!channel || !eventName.trim()) return
    setSending(true)

    try {
      const parsed = JSON.parse(payloadJson)
      addLog("info", `Broadcasting "${eventName}" on "${channelName}"`, parsed)

      const result = await channel.send({
        type: "broadcast",
        event: eventName.trim(),
        payload: parsed,
      })

      if (result === "ok") {
        addLog("success", `Broadcast "${eventName}" sent on "${channelName}"`)
      } else {
        addLog("warning", `Broadcast result: ${result}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid JSON or send error"
      addLog("error", `Broadcast failed: ${msg}`, err)
    } finally {
      setSending(false)
    }
  }, [channel, channelName, eventName, payloadJson, addLog])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Send className="size-4" />
          Broadcast
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="broadcast-event">Event Name</Label>
          <Input
            id="broadcast-event"
            placeholder="e.g. cursor-move"
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="broadcast-payload">Payload (JSON)</Label>
          <Textarea
            id="broadcast-payload"
            className="font-mono text-sm min-h-24"
            value={payloadJson}
            onChange={(e) => setPayloadJson(e.target.value)}
          />
        </div>

        <Button
          size="sm"
          onClick={handleSend}
          disabled={!channel || !eventName.trim() || sending}
        >
          <Send className="size-3.5" />
          {sending ? "Sending..." : "Send"}
        </Button>

        {!channel && (
          <p className="text-xs text-muted-foreground">
            Create and select a channel first.
          </p>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Presence Section
// ---------------------------------------------------------------------------

function PresenceSection({
  channel,
  channelName,
  onEvent,
}: {
  channel: RealtimeChannel | null
  channelName: string
  onEvent: (event: RealtimeEvent) => void
}) {
  const { addLog } = useSupabase()

  const [stateJson, setStateJson] = useState(
    '{\n  "user": "tester",\n  "online_at": "' + new Date().toISOString() + '"\n}',
  )
  const [presenceState, setPresenceState] = useState<Record<string, unknown[]>>({})
  const [tracking, setTracking] = useState(false)
  const [synced, setSynced] = useState(false)

  // Set up presence listeners when channel changes
  useEffect(() => {
    if (!channel) {
      setPresenceState({})
      setSynced(false)
      return
    }

    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState()
        setPresenceState(state as Record<string, unknown[]>)
        setSynced(true)
        onEvent({
          id: crypto.randomUUID(),
          timestamp: new Date(),
          type: "presence_sync",
          payload: state,
        })
      })
      .on("presence", { event: "join" }, ({ key, newPresences }) => {
        onEvent({
          id: crypto.randomUUID(),
          timestamp: new Date(),
          type: "presence_join",
          payload: { key, newPresences },
        })
        addLog("info", `Presence join on "${channelName}"`, { key, newPresences })
      })
      .on("presence", { event: "leave" }, ({ key, leftPresences }) => {
        onEvent({
          id: crypto.randomUUID(),
          timestamp: new Date(),
          type: "presence_leave",
          payload: { key, leftPresences },
        })
        addLog("info", `Presence leave on "${channelName}"`, { key, leftPresences })
      })
  }, [channel, channelName, addLog, onEvent])

  const handleTrack = useCallback(async () => {
    if (!channel) return

    try {
      const parsed = JSON.parse(stateJson)
      addLog("info", `Tracking presence on "${channelName}"`, parsed)

      const status = await channel.track(parsed)
      if (status === "ok") {
        setTracking(true)
        addLog("success", `Presence tracked on "${channelName}"`)
      } else {
        addLog("warning", `Presence track result: ${status}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Invalid JSON or track error"
      addLog("error", `Presence track failed: ${msg}`, err)
    }
  }, [channel, channelName, stateJson, addLog])

  const handleUntrack = useCallback(async () => {
    if (!channel) return

    try {
      addLog("info", `Untracking presence on "${channelName}"`)
      const status = await channel.untrack()
      if (status === "ok") {
        setTracking(false)
        addLog("success", `Presence untracked on "${channelName}"`)
      } else {
        addLog("warning", `Presence untrack result: ${status}`)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Untrack error"
      addLog("error", `Presence untrack failed: ${msg}`, err)
    }
  }, [channel, channelName, addLog])

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Users className="size-4" />
          Presence
          {tracking && (
            <Badge className="bg-green-600 text-white text-[10px]">
              Tracking
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor="presence-state">State (JSON)</Label>
          <Textarea
            id="presence-state"
            className="font-mono text-sm min-h-24"
            value={stateJson}
            onChange={(e) => setStateJson(e.target.value)}
          />
        </div>

        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={handleTrack}
            disabled={!channel}
          >
            <Users className="size-3.5" />
            Track
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleUntrack}
            disabled={!channel || !tracking}
          >
            <WifiOff className="size-3.5" />
            Untrack
          </Button>
        </div>

        {!channel && (
          <p className="text-xs text-muted-foreground">
            Create and select a channel first.
          </p>
        )}

        {synced && Object.keys(presenceState).length > 0 && (
          <>
            <Separator />
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">
                Current Presence State
              </Label>
              <JsonBlock json={JSON.stringify(presenceState, null, 2)} />
            </div>
          </>
        )}

        {synced && Object.keys(presenceState).length === 0 && (
          <>
            <Separator />
            <p className="text-xs text-muted-foreground">
              No presence data synced yet.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Live Event Stream
// ---------------------------------------------------------------------------

function LiveEventStream({
  events,
  onClear,
}: {
  events: RealtimeEvent[]
  onClear: () => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [events.length])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-sm">
            <Radio className="size-4" />
            Live Event Stream
            <Badge variant="secondary" className="text-[10px]">
              {events.length}
            </Badge>
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={onClear}
            disabled={events.length === 0}
          >
            <Trash2 className="size-3.5" />
            Clear
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">
            No events yet. Subscribe to a channel and listen for changes, broadcasts, or presence updates.
          </p>
        ) : (
          <ScrollArea className="h-[400px]" ref={scrollRef}>
            <div className="space-y-2 pr-3">
              {events.map((evt) => (
                <div
                  key={evt.id}
                  className="rounded border border-border/50 p-2 space-y-1"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {formatTimestamp(evt.timestamp)}
                    </span>
                    <Badge
                      className={`text-[10px] px-1.5 py-0 ${eventBadgeColor(evt.type)}`}
                    >
                      {evt.type}
                    </Badge>
                  </div>
                  <JsonBlock json={JSON.stringify(evt.payload, null, 2)} />
                </div>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Main Realtime Component
// ---------------------------------------------------------------------------

export function Realtime() {
  const { client, schema, addLog } = useSupabase()

  // Channel state
  const [channels, setChannels] = useState<ChannelEntry[]>([])
  const [activeChannelName, setActiveChannelName] = useState("")

  // Event stream
  const [events, setEvents] = useState<RealtimeEvent[]>([])

  const tables = schema?.tables ?? []

  // Get the active channel object
  const activeChannel =
    channels.find((ch) => ch.name === activeChannelName)?.channel ?? null

  // -- Channel operations ---------------------------------------------------

  const handleSubscribeChannel = useCallback(
    (name: string) => {
      if (!client) {
        addLog("warning", "Connect to a Supabase project first.")
        return
      }

      // Check if channel already exists
      if (channels.some((ch) => ch.name === name)) {
        addLog("warning", `Channel "${name}" already exists. Select it from the list.`)
        setActiveChannelName(name)
        return
      }

      const channel = client.channel(name)
      const entry: ChannelEntry = { name, channel }

      setChannels((prev) => [...prev, entry])
      setActiveChannelName(name)

      addLog("success", `Created channel "${name}". Configure listeners below, then they will subscribe.`)
    },
    [client, channels, addLog],
  )

  const handleUnsubscribeChannel = useCallback(
    (name: string) => {
      if (!client) return

      const entry = channels.find((ch) => ch.name === name)
      if (!entry) return

      client.removeChannel(entry.channel)
      setChannels((prev) => prev.filter((ch) => ch.name !== name))

      if (activeChannelName === name) {
        setActiveChannelName((prev) => {
          const remaining = channels.filter((ch) => ch.name !== name)
          return remaining.length > 0 ? remaining[0].name : ""
        })
      }

      addLog("info", `Unsubscribed and removed channel "${name}"`)
    },
    [client, channels, activeChannelName, addLog],
  )

  const handleSelectChannel = useCallback((name: string) => {
    setActiveChannelName(name)
  }, [])

  // -- Event stream ---------------------------------------------------------

  const handleNewEvent = useCallback((event: RealtimeEvent) => {
    setEvents((prev) => [...prev, event])
  }, [])

  const handleClearEvents = useCallback(() => {
    setEvents([])
  }, [])

  // -- Setup broadcast listener on active channel ---------------------------

  useEffect(() => {
    if (!activeChannel) return

    // Listen for incoming broadcasts on the active channel
    activeChannel.on("broadcast", { event: "*" }, (payload) => {
      setEvents((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          type: "broadcast",
          payload,
        },
      ])
    })
  }, [activeChannel])

  // =========================================================================
  // Render
  // =========================================================================

  if (!client) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Connect to a Supabase project first.
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="flex h-full flex-col gap-4 p-4">
      {/* Header info */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Radio className="size-4" />
        <span>
          Test realtime subscriptions to detect data leaks via Postgres changes,
          broadcast, and presence channels.
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Left column: Channel Manager + Postgres Changes */}
        <div className="space-y-4">
          <ChannelManager
            channels={channels}
            activeChannelName={activeChannelName}
            onSubscribe={handleSubscribeChannel}
            onUnsubscribe={handleUnsubscribeChannel}
            onSelect={handleSelectChannel}
          />

          <PostgresChangesSection
            channel={activeChannel}
            channelName={activeChannelName}
            tables={tables}
            onEvent={handleNewEvent}
          />
        </div>

        {/* Right column: Broadcast + Presence */}
        <div className="space-y-4">
          <BroadcastSection
            channel={activeChannel}
            channelName={activeChannelName}
          />

          <PresenceSection
            channel={activeChannel}
            channelName={activeChannelName}
            onEvent={handleNewEvent}
          />
        </div>
      </div>

      {/* Full-width: Live Event Stream */}
      <LiveEventStream events={events} onClear={handleClearEvents} />
    </div>
  )
}
