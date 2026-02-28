"use client"

import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable"
import { Header } from "@/components/supabase-pwn/header"
import { InitForm } from "@/components/supabase-pwn/init-form"
import { AuthPanel } from "@/components/supabase-pwn/auth-panel"
import { DatabaseExplorer } from "@/components/supabase-pwn/database-explorer"
import { StorageExplorer } from "@/components/supabase-pwn/storage-explorer"
import { EdgeFunctions } from "@/components/supabase-pwn/edge-functions"
import { Realtime } from "@/components/supabase-pwn/realtime"
import { AutoPwn } from "@/components/supabase-pwn/autopwn"
import { OutputLog } from "@/components/supabase-pwn/output-log"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { useSupabase } from "@/lib/supabase-context"
import {
  Database,
  HardDrive,
  Zap,
  Radio,
  ShieldAlert,
} from "lucide-react"

export default function Home() {
  const { initialized } = useSupabase()

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <Header />
      <InitForm />
      <ResizablePanelGroup orientation="vertical" className="flex-1 min-h-0">
        <ResizablePanel id="main-top" defaultSize="75%" minSize="30%">
          <ResizablePanelGroup orientation="horizontal">
            <ResizablePanel id="tabs-panel" defaultSize="70%" minSize="40%">
              {initialized ? (
                <Tabs
                  defaultValue="database"
                  className="flex h-full flex-col overflow-hidden"
                >
                  <TabsList className="mx-4 mt-2 w-fit shrink-0">
                    <TabsTrigger value="database">
                      <Database className="mr-1.5 h-3.5 w-3.5" />
                      Database
                    </TabsTrigger>
                    <TabsTrigger value="storage">
                      <HardDrive className="mr-1.5 h-3.5 w-3.5" />
                      Storage
                    </TabsTrigger>
                    <TabsTrigger value="functions">
                      <Zap className="mr-1.5 h-3.5 w-3.5" />
                      Edge Functions
                    </TabsTrigger>
                    <TabsTrigger value="realtime">
                      <Radio className="mr-1.5 h-3.5 w-3.5" />
                      Realtime
                    </TabsTrigger>
                    <TabsTrigger value="autopwn">
                      <ShieldAlert className="mr-1.5 h-3.5 w-3.5" />
                      Autopwn
                    </TabsTrigger>
                  </TabsList>
                  <TabsContent
                    value="database"
                    className="flex-1 min-h-0 overflow-auto p-4"
                  >
                    <DatabaseExplorer />
                  </TabsContent>
                  <TabsContent
                    value="storage"
                    className="flex-1 min-h-0 overflow-auto p-4"
                  >
                    <StorageExplorer />
                  </TabsContent>
                  <TabsContent
                    value="functions"
                    className="flex-1 min-h-0 overflow-auto p-4"
                  >
                    <EdgeFunctions />
                  </TabsContent>
                  <TabsContent
                    value="realtime"
                    className="flex-1 min-h-0 overflow-auto p-4"
                  >
                    <Realtime />
                  </TabsContent>
                  <TabsContent
                    value="autopwn"
                    className="flex-1 min-h-0 overflow-auto p-4"
                  >
                    <AutoPwn />
                  </TabsContent>
                </Tabs>
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  Initialize a Supabase project to get started
                </div>
              )}
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="auth-panel" defaultSize="30%" minSize="20%" maxSize="40%">
              {initialized ? (
                <AuthPanel />
              ) : (
                <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
                  Auth panel
                </div>
              )}
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>
        <ResizableHandle withHandle />
        <ResizablePanel id="output-log" defaultSize="25%" minSize="10%">
          <OutputLog />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  )
}
