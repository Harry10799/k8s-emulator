'use client'

import { Package, Layers, Flame, Boxes } from 'lucide-react'
import type { DropPayload } from './cluster-canvas'

const templates: (DropPayload & { title: string; desc: string; icon: typeof Package })[] = [
  {
    kind: 'pod',
    title: 'nginx pod',
    desc: '500m CPU · 512Mi · stable',
    image: 'nginx:latest',
    cpuRequest: 500,
    memRequest: 512,
    crashRate: 0.02,
    icon: Package,
  },
  {
    kind: 'pod',
    title: 'busybox pod',
    desc: '250m CPU · 128Mi · light',
    image: 'busybox:1.36',
    cpuRequest: 250,
    memRequest: 128,
    crashRate: 0.02,
    icon: Package,
  },
  {
    kind: 'pod',
    title: 'heavy pod',
    desc: '3.5 CPU · 6Gi — fills a node',
    image: 'postgres:16',
    cpuRequest: 3500,
    memRequest: 6144,
    crashRate: 0.02,
    icon: Boxes,
  },
  {
    kind: 'pod',
    title: 'crashy pod',
    desc: 'crashes often — CrashLoopBackOff demo',
    image: 'bug:latest',
    cpuRequest: 250,
    memRequest: 256,
    crashRate: 0.25,
    icon: Flame,
  },
  {
    kind: 'deployment',
    title: 'web deployment',
    desc: '3 replicas · nginx · self-healing',
    image: 'nginx:latest',
    cpuRequest: 500,
    memRequest: 512,
    crashRate: 0.02,
    replicas: 3,
    icon: Layers,
  },
]

export function Palette() {
  return (
    <div className="p-3 space-y-2">
      <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider px-1">Workloads — drag onto canvas</div>
      {templates.map((t) => (
        <div
          key={t.title}
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/k8s', JSON.stringify(t))
            e.dataTransfer.effectAllowed = 'move'
          }}
          className="group cursor-grab active:cursor-grabbing rounded-lg border border-zinc-700 bg-zinc-900 p-2.5 hover:border-emerald-600/60 transition-colors"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-zinc-800 border border-zinc-700 group-hover:border-emerald-600/50">
              <t.icon className="h-4 w-4 text-emerald-500" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium text-zinc-200">{t.title}</div>
              <div className="text-[10px] text-zinc-500 truncate">{t.desc}</div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}
