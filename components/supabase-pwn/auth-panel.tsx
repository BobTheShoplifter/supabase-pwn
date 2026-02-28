"use client"

import { useState } from "react"
import { Copy, LogOut, ChevronDown, ChevronRight, User } from "lucide-react"

import { useSupabase } from "@/lib/supabase-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { ScrollArea } from "@/components/ui/scroll-area"

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const OAUTH_PROVIDERS = [
  "google",
  "github",
  "discord",
  "apple",
  "twitter",
  "facebook",
  "linkedin",
  "gitlab",
  "bitbucket",
] as const

type OAuthProvider = (typeof OAUTH_PROVIDERS)[number]

// ---------------------------------------------------------------------------
// JWT decode helper — extracts the payload from a JWT without verification
// ---------------------------------------------------------------------------

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null
    const payload = parts[1]
    const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
    return JSON.parse(decoded) as Record<string, unknown>
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Sign Up Tab
// ---------------------------------------------------------------------------

function SignUpTab() {
  const { client, addLog } = useSupabase()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSignUp() {
    if (!client || !email || !password) return
    setLoading(true)
    try {
      const { data, error } = await client.auth.signUp({ email, password })
      if (error) {
        addLog("error", `Sign-up failed: ${error.message}`, error)
      } else {
        addLog(
          "success",
          `Sign-up successful — user ID: ${data.user?.id ?? "unknown"}`,
          data,
        )
      }
    } catch (err) {
      addLog(
        "error",
        err instanceof Error ? err.message : "Sign-up threw an exception",
        err,
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="signup-email">Email</Label>
        <Input
          id="signup-email"
          type="email"
          placeholder="user@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="signup-password">Password</Label>
        <Input
          id="signup-password"
          type="password"
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
        />
      </div>
      <Button
        className="w-full"
        onClick={handleSignUp}
        disabled={loading || !email || !password}
      >
        {loading ? "Signing Up..." : "Sign Up"}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sign In Tab
// ---------------------------------------------------------------------------

function SignInTab() {
  const { client, addLog } = useSupabase()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSignIn() {
    if (!client || !email || !password) return
    setLoading(true)
    try {
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
      })
      if (error) {
        addLog("error", `Sign-in failed: ${error.message}`, error)
      } else {
        addLog(
          "success",
          `Sign-in successful — user ID: ${data.user?.id ?? "unknown"}`,
          data,
        )
      }
    } catch (err) {
      addLog(
        "error",
        err instanceof Error ? err.message : "Sign-in threw an exception",
        err,
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label htmlFor="signin-email">Email</Label>
        <Input
          id="signin-email"
          type="email"
          placeholder="user@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={loading}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="signin-password">Password</Label>
        <Input
          id="signin-password"
          type="password"
          placeholder="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
        />
      </div>
      <Button
        className="w-full"
        onClick={handleSignIn}
        disabled={loading || !email || !password}
      >
        {loading ? "Signing In..." : "Sign In"}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Anonymous Tab
// ---------------------------------------------------------------------------

function AnonymousTab() {
  const { client, addLog } = useSupabase()
  const [loading, setLoading] = useState(false)

  async function handleAnonymousSignIn() {
    if (!client) return
    setLoading(true)
    try {
      const { data, error } = await client.auth.signInAnonymously()
      if (error) {
        addLog("error", `Anonymous sign-in failed: ${error.message}`, error)
      } else {
        addLog(
          "success",
          `Anonymous sign-in successful — user ID: ${data.user?.id ?? "unknown"}`,
          data,
        )
      }
    } catch (err) {
      addLog(
        "error",
        err instanceof Error
          ? err.message
          : "Anonymous sign-in threw an exception",
        err,
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Sign in without providing any credentials. The user will be created with
        no email or identity.
      </p>
      <Button
        className="w-full"
        onClick={handleAnonymousSignIn}
        disabled={loading}
      >
        {loading ? "Signing In..." : "Sign In Anonymously"}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// OAuth Tab
// ---------------------------------------------------------------------------

function OAuthTab() {
  const { client, addLog } = useSupabase()
  const [provider, setProvider] = useState<OAuthProvider>("google")
  const [loading, setLoading] = useState(false)

  async function handleOAuthSignIn() {
    if (!client) return
    setLoading(true)
    try {
      const { data, error } = await client.auth.signInWithOAuth({
        provider,
      })
      if (error) {
        addLog("error", `OAuth sign-in failed: ${error.message}`, error)
      } else {
        addLog(
          "success",
          `OAuth sign-in initiated with provider: ${provider}`,
          data,
        )
      }
    } catch (err) {
      addLog(
        "error",
        err instanceof Error
          ? err.message
          : "OAuth sign-in threw an exception",
        err,
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Provider</Label>
        <Select
          value={provider}
          onValueChange={(val) => setProvider(val as OAuthProvider)}
        >
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Select provider" />
          </SelectTrigger>
          <SelectContent>
            {OAUTH_PROVIDERS.map((p) => (
              <SelectItem key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button
        className="w-full"
        onClick={handleOAuthSignIn}
        disabled={loading}
      >
        {loading
          ? "Redirecting..."
          : `Sign In with ${provider.charAt(0).toUpperCase() + provider.slice(1)}`}
      </Button>
      <p className="text-xs text-muted-foreground">
        This will open a popup or redirect to the provider&apos;s login page.
      </p>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Bearer Token Tab
// ---------------------------------------------------------------------------

function BearerTokenTab() {
  const { client, addLog } = useSupabase()
  const [token, setToken] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSetToken() {
    if (!client || !token.trim()) return
    setLoading(true)
    try {
      // setSession requires both access_token and refresh_token
      // For pentesting, we use the same token as both since we just
      // want to authenticate requests with this JWT
      const { data, error } = await client.auth.setSession({
        access_token: token.trim(),
        refresh_token: token.trim(),
      })
      if (error) {
        addLog("error", `Set session failed: ${error.message}`, error)
      } else {
        const payload = decodeJwtPayload(token.trim())
        addLog(
          "success",
          `Session set with bearer token — user ID: ${data.user?.id ?? "unknown"}`,
          { user: data.user, claims: payload },
        )
      }
    } catch (err) {
      addLog(
        "error",
        err instanceof Error ? err.message : "Set session threw an exception",
        err,
      )
    } finally {
      setLoading(false)
    }
  }

  // Preview the decoded JWT payload
  const preview = token.trim() ? decodeJwtPayload(token.trim()) : null

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Paste a JWT access token to authenticate requests. Useful for testing
        with tokens obtained from intercepted traffic or other sources.
      </p>
      <div className="space-y-2">
        <Label htmlFor="bearer-token">Access Token (JWT)</Label>
        <Input
          id="bearer-token"
          type="text"
          placeholder="eyJhbGciOiJIUzI1NiIs..."
          value={token}
          onChange={(e) => setToken(e.target.value)}
          disabled={loading}
          className="font-mono text-xs"
        />
      </div>
      {preview && (
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Token Preview</Label>
          <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto max-h-32 overflow-y-auto">
            {JSON.stringify(preview, null, 2)}
          </pre>
        </div>
      )}
      <Button
        className="w-full"
        onClick={handleSetToken}
        disabled={loading || !token.trim()}
      >
        {loading ? "Setting Session..." : "Set Bearer Token"}
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Authenticated User Info
// ---------------------------------------------------------------------------

function AuthenticatedUserInfo() {
  const { user, session, signOut } = useSupabase()
  const [copied, setCopied] = useState(false)
  const [claimsOpen, setClaimsOpen] = useState(false)
  const [signingOut, setSigningOut] = useState(false)

  if (!user) return null

  const displayEmail = user.email || "Anonymous"
  const uid = user.id

  // Decode JWT to get role
  const jwtPayload = session?.access_token
    ? decodeJwtPayload(session.access_token)
    : null
  const role = jwtPayload?.role ?? "authenticated"

  async function handleCopyUid() {
    try {
      await navigator.clipboard.writeText(uid)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard API may not be available in all contexts
    }
  }

  async function handleSignOut() {
    setSigningOut(true)
    try {
      await signOut()
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <Card className="mt-4">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm">Authenticated User</CardTitle>
          </div>
          <Badge className="bg-emerald-600 text-white hover:bg-emerald-600">
            {String(role)}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Email */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Email</Label>
          <p className="text-sm font-mono truncate">{displayEmail}</p>
        </div>

        {/* UID with copy button */}
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">User ID</Label>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono bg-muted px-2 py-1 rounded truncate">
              {uid}
            </code>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={handleCopyUid}
              title="Copy UID"
            >
              <Copy className="h-3 w-3" />
            </Button>
            {copied && (
              <span className="text-xs text-emerald-500">Copied!</span>
            )}
          </div>
        </div>

        {/* JWT Claims — Collapsible */}
        <Collapsible open={claimsOpen} onOpenChange={setClaimsOpen}>
          <CollapsibleTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start gap-2 px-0"
            >
              {claimsOpen ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
              <span className="text-xs">JWT Claims &amp; Metadata</span>
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 space-y-3">
              {/* app_metadata */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  app_metadata
                </Label>
                <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto max-h-40 overflow-y-auto">
                  {JSON.stringify(user.app_metadata, null, 2)}
                </pre>
              </div>

              {/* user_metadata */}
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">
                  user_metadata
                </Label>
                <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto max-h-40 overflow-y-auto">
                  {JSON.stringify(user.user_metadata, null, 2)}
                </pre>
              </div>

              {/* Decoded JWT payload */}
              {jwtPayload && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">
                    JWT Payload
                  </Label>
                  <pre className="text-xs font-mono bg-muted p-2 rounded overflow-x-auto max-h-48 overflow-y-auto">
                    {JSON.stringify(jwtPayload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>

        {/* Sign Out */}
        <Button
          variant="destructive"
          size="sm"
          className="w-full"
          onClick={handleSignOut}
          disabled={signingOut}
        >
          <LogOut className="h-4 w-4" />
          {signingOut ? "Signing Out..." : "Sign Out"}
        </Button>
      </CardContent>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// AuthPanel — main export
// ---------------------------------------------------------------------------

export function AuthPanel() {
  const { user } = useSupabase()

  return (
    <ScrollArea className="h-full">
      <div className="space-y-4 p-4">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm">Authentication</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="signin">
              <TabsList className="w-full">
                <TabsTrigger value="signin" className="text-xs">
                  Sign In
                </TabsTrigger>
                <TabsTrigger value="signup" className="text-xs">
                  Sign Up
                </TabsTrigger>
                <TabsTrigger value="anon" className="text-xs">
                  Anonymous
                </TabsTrigger>
                <TabsTrigger value="oauth" className="text-xs">
                  OAuth
                </TabsTrigger>
                <TabsTrigger value="bearer" className="text-xs">
                  Bearer
                </TabsTrigger>
              </TabsList>

              <TabsContent value="signin" className="mt-4">
                <SignInTab />
              </TabsContent>

              <TabsContent value="signup" className="mt-4">
                <SignUpTab />
              </TabsContent>

              <TabsContent value="anon" className="mt-4">
                <AnonymousTab />
              </TabsContent>

              <TabsContent value="oauth" className="mt-4">
                <OAuthTab />
              </TabsContent>

              <TabsContent value="bearer" className="mt-4">
                <BearerTokenTab />
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>

        {/* Show authenticated user info below tabs when logged in */}
        {user && <AuthenticatedUserInfo />}
      </div>
    </ScrollArea>
  )
}
