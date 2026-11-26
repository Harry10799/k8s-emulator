'use client'

import { useEffect, useState } from 'react'
import { ReactFlowProvider } from '@xyflow/react'
import { Play, Pause, Plus, RotateCcw, Gauge, Zap, PencilLine, Boxes } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Toaster } from '@/components/ui/sonner'
import { ScrollArea } from '@/components/ui/scroll-area'
import { useCluster } from '@/lib/cluster-store'
import { ClusterCanvas } from '@/components/k8s/cluster-canvas'
import { Palette } from '@/components/k8s/palette'
import { Inspector } from '@/components/k8s/inspector'
import { EditDialog } from '@/components/k8s/edit-dialog'
import { NodeInternalsDialog } from '@/components/k8s/node-internals'
import { EventFeed } from '@/components/k8s/event-feed'
import { ResourceList } from '@/components/k8s/resource-list'

function Toolbar() {
  const running = useCluster((s) => s.running)
  const speed = useCluster((s) => s.speed)
  const chaos = useCluster((s) => s.chaos)
  const setRunning = useCluster((s) => s.setRunning)
  const setSpeed = useCluster((s) => s.setSpeed)
  const setChaos = useCluster((s) => s.setChaos)
  const addNode = useCluster((s) => s.addNode)
  const reset = useCluster((s) => s.reset)
  const namespaces = useCluster((s) => s.namespaces)
  const activeNamespace = useCluster((s) => s.activeNamespace)
  const setNamespace = useCluster((s) => s.setNamespace)

  return (
    <header className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-3 py-2 shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-lg leading-none">⎈</span>
        <div>
          <div className="text-sm font-bold text-zinc-100 tracking-tight">k8s playground</div>
          <div className="text-[9px] text-zinc-500 -mt-0.5 hidden sm:block">full-fledged cluster simulator · everything editable</div>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
        <Button size="sm" variant={running ? 'secondary' : 'default'} className="h-8 text-xs" onClick={() => setRunning(!running)}>
          {running ? <Pause className="h-3.5 w-3.5 mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
          {running ? 'Pause' : 'Resume'}
        </Button>

        <div className="flex items-center gap-1 text-zinc-500" title="Filter resources by namespace">
          <Boxes className="h-3.5 w-3.5" />
          <Select value={activeNamespace} onValueChange={(v) => setNamespace(v)}>
            <SelectTrigger className="h-8 w-[110px] text-xs border-zinc-700 bg-zinc-900">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700">
              <SelectItem value="all" className="text-xs font-mono">all namespaces</SelectItem>
              {namespaces.map((ns) => (
                <SelectItem key={ns.id} value={ns.name} className="text-xs font-mono">ns/{ns.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-1.5 text-zinc-500">
          <Gauge className="h-3.5 w-3.5" />
          <Select value={String(speed)} onValueChange={(v) => setSpeed(Number(v))}>
            <SelectTrigger className="h-8 w-[64px] text-xs border-zinc-700 bg-zinc-900">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="bg-zinc-900 border-zinc-700">
              {[0.5, 1, 2, 4].map((s) => (
                <SelectItem key={s} value={String(s)} className="text-xs">{s}x</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Button
          size="sm"
          variant={chaos ? 'destructive' : 'outline'}
          className={`h-8 text-xs ${chaos ? '' : 'border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-500/50'}`}
          onClick={() => setChaos(!chaos)}
          aria-pressed={chaos}
        >
          <Zap className="h-3.5 w-3.5 mr-1" /> Chaos
        </Button>

        <Button size="sm" variant="outline" className="h-8 text-xs border-zinc-700 text-zinc-400 hover:text-emerald-400 hover:border-emerald-600/50" onClick={addNode}>
          <Plus className="h-3.5 w-3.5 mr-1" /> Node
        </Button>

        <Button size="sm" variant="outline" className="h-8 text-xs border-zinc-700 text-zinc-400 hover:text-zinc-200" onClick={reset}>
          <RotateCcw className="h-3.5 w-3.5 mr-1" /> Reset
        </Button>
      </div>
    </header>
  )
}

/* On screens narrower than lg the right-side inspector panel is hidden.
   This floating button opens the same Inspector in a sheet so edit/delete
   actions are reachable at every viewport size. */
function InspectorSheet() {
  const [open, setOpen] = useState(false)
  const selected = useCluster((s) => s.selected)

  // auto-open when a resource gets selected on a small screen
  useEffect(() => {
    if (selected) setOpen(true)
  }, [selected])

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          aria-label="Inspect / edit selected resource"
          className="lg:hidden fixed bottom-4 right-4 z-40 flex items-center gap-1.5 rounded-full border border-emerald-600/50 bg-zinc-900/95 px-3.5 py-2.5 text-xs font-mono text-emerald-400 shadow-lg hover:bg-zinc-800 transition-colors"
        >
          <PencilLine className="h-4 w-4" />
          Inspect / Edit
          {selected && <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-80 border-zinc-800 bg-zinc-950 p-0 overflow-y-auto custom-scroll">
        <SheetTitle className="sr-only">Inspector</SheetTitle>
        <Inspector />
      </SheetContent>
    </Sheet>
  )
}

export default function Home() {
  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100 antialiased">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        {/* left: palette + resources */}
        <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
          <Tabs defaultValue="create" className="flex min-h-0 flex-col flex-1">
            <TabsList className="mx-3 mt-2 grid grid-cols-2 bg-zinc-900 border border-zinc-800 shrink-0">
              <TabsTrigger value="create" className="text-xs data-[state=active]:bg-zinc-800">Create</TabsTrigger>
              <TabsTrigger value="resources" className="text-xs data-[state=active]:bg-zinc-800">Resources</TabsTrigger>
            </TabsList>
            <TabsContent value="create" className="flex-1 min-h-0 mt-0">
              <ScrollArea className="h-full">
                <Palette />
              </ScrollArea>
            </TabsContent>
            <TabsContent value="resources" className="flex-1 min-h-0 mt-0">
              <ScrollArea className="h-full">
                <ResourceList />
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </aside>

        {/* center: canvas + event feed */}
        <main className="flex min-w-0 flex-1 flex-col">
          <div className="relative min-h-0 flex-1">
            <ReactFlowProvider>
              <ClusterCanvas />
            </ReactFlowProvider>
          </div>
          <div className="h-36 shrink-0">
            <EventFeed />
          </div>
        </main>

        {/* right: inspector */}
        <aside className="hidden lg:block w-80 shrink-0 border-l border-zinc-800 bg-zinc-950 overflow-y-auto custom-scroll">
          <Inspector />
        </aside>
      </div>
      <InspectorSheet />
      <EditDialog />
      <NodeInternalsDialog />
      <Toaster theme="dark" />
    </div>
  )
}
