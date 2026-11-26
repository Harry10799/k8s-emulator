'use client'

import { ReactFlowProvider } from '@xyflow/react'
import { Play, Pause, Plus, RotateCcw, Gauge, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Toaster } from '@/components/ui/sonner'
import { useCluster } from '@/lib/cluster-store'
import { ClusterCanvas } from '@/components/k8s/cluster-canvas'
import { Palette } from '@/components/k8s/palette'
import { Inspector } from '@/components/k8s/inspector'
import { EventFeed } from '@/components/k8s/event-feed'
import { WorkloadsPanel } from '@/components/k8s/workloads-panel'

function Toolbar() {
  const running = useCluster((s) => s.running)
  const speed = useCluster((s) => s.speed)
  const chaos = useCluster((s) => s.chaos)
  const setRunning = useCluster((s) => s.setRunning)
  const setSpeed = useCluster((s) => s.setSpeed)
  const setChaos = useCluster((s) => s.setChaos)
  const addNode = useCluster((s) => s.addNode)
  const reset = useCluster((s) => s.reset)

  return (
    <header className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-950 px-3 py-2 shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-lg leading-none">⎈</span>
        <div>
          <div className="text-sm font-bold text-zinc-100 tracking-tight">k8s playground</div>
          <div className="text-[9px] text-zinc-500 -mt-0.5 hidden sm:block">drag-and-drop cluster simulator</div>
        </div>
      </div>

      <div className="ml-auto flex items-center gap-1.5 flex-wrap justify-end">
        <Button size="sm" variant={running ? 'secondary' : 'default'} className="h-8 text-xs" onClick={() => setRunning(!running)}>
          {running ? <Pause className="h-3.5 w-3.5 mr-1" /> : <Play className="h-3.5 w-3.5 mr-1" />}
          {running ? 'Pause' : 'Resume'}
        </Button>

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

export default function Home() {
  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100 antialiased">
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        {/* left: palette + workloads */}
        <aside className="hidden md:flex w-60 shrink-0 flex-col border-r border-zinc-800 bg-zinc-950 overflow-y-auto custom-scroll">
          <Palette />
          <WorkloadsPanel />
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
      <Toaster theme="dark" />
    </div>
  )
}
