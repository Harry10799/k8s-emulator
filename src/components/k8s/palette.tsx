'use client'

import {
  Package, Layers, Boxes, Flame, Network, FileJson, KeyRound, Clock, Briefcase, Copy, Server,
} from 'lucide-react'
import type { DropPayload } from '@/lib/cluster-store'

const templates: (DropPayload & { title: string; desc: string; icon: typeof Package })[] = [
  {
    kind: 'pod', title: 'pod · nginx', desc: '500m · 512Mi · stable', image: 'nginx:latest', cpuRequest: 500, memRequest: 512, crashRate: 0.02, name: 'nginx',
    labels: { app: 'nginx' }, icon: Package,
  },
  {
    kind: 'pod', title: 'pod · crashy', desc: 'CrashLoopBackOff demo', image: 'bug:latest', cpuRequest: 250, memRequest: 256, crashRate: 0.25, name: 'crashy',
    labels: { app: 'crashy' }, icon: Flame,
  },
  {
    kind: 'deployment', title: 'deployment · web', desc: '3 replicas · self-healing', image: 'nginx:latest', cpuRequest: 500, memRequest: 512, crashRate: 0.02, replicas: 3, name: 'web',
    labels: { app: 'web' }, selector: { app: 'web' }, icon: Layers,
  },
  {
    kind: 'replicaset', title: 'replicaset · rs', desc: '2 replicas · no rollout', image: 'redis:7', cpuRequest: 250, memRequest: 256, crashRate: 0.02, replicas: 2, name: 'cache',
    labels: { app: 'cache' }, selector: { app: 'cache' }, icon: Copy,
  },
  {
    kind: 'daemonset', title: 'daemonset · log agent', desc: 'one pod per node', image: 'fluentd:v1.16', cpuRequest: 100, memRequest: 128, crashRate: 0.02, name: 'log-agent',
    labels: { app: 'log-agent' }, selector: { app: 'log-agent' }, icon: Server,
  },
  {
    kind: 'statefulset', title: 'statefulset · db', desc: 'web-0, web-1… ordered', image: 'postgres:16', cpuRequest: 500, memRequest: 512, crashRate: 0.02, replicas: 3, name: 'db',
    labels: { app: 'db' }, serviceName: 'db-headless', icon: Boxes,
  },
  {
    kind: 'service', title: 'service · ClusterIP', desc: 'selector: app=web', serviceType: 'ClusterIP', port: 80, targetPort: 8080, name: 'web-svc',
    selector: { app: 'web' }, icon: Network,
  },
  {
    kind: 'service', title: 'service · NodePort', desc: 'exposes 30000–32767', serviceType: 'NodePort', port: 80, targetPort: 8080, name: 'web-np',
    selector: { app: 'web' }, icon: Network,
  },
  {
    kind: 'configmap', title: 'configmap · app-config', desc: 'editable key/value data', name: 'app-config',
    data: { 'APP_MODE': 'production', 'LOG_LEVEL': 'info' }, icon: FileJson,
  },
  {
    kind: 'secret', title: 'secret · db-creds', desc: 'sensitive key/value', name: 'db-creds',
    data: { username: 'admin', password: 'changeme' }, icon: KeyRound,
  },
  {
    kind: 'cronjob', title: 'cronjob · backup', desc: 'runs every 15s sim-time', schedule: '*/15', image: 'backup:latest', cpuRequest: 100, memRequest: 128, duration: 5, name: 'backup',
    icon: Clock,
  },
  {
    kind: 'job', title: 'job · migrate', desc: 'runs once → Succeeded', image: 'migrate:latest', cpuRequest: 100, memRequest: 128, duration: 6, name: 'migrate',
    icon: Briefcase,
  },
]

export function Palette() {
  return (
    <div className="p-3 space-y-2">
      <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider px-1">Resources — drag onto canvas</div>
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
