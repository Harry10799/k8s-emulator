'use client'

import {
  Package, Layers, Copy, Server, Boxes, Network, FileJson, KeyRound, Clock, Briefcase, CheckCircle2,
} from 'lucide-react'
import { useCluster, serviceEndpoints, type ResourceKind } from '@/lib/cluster-store'

const kindMeta: Record<string, { label: string; icon: typeof Package; short: string }> = {
  deployment: { label: 'Deployments', icon: Layers, short: 'deploy' },
  replicaset: { label: 'ReplicaSets', icon: Copy, short: 'rs' },
  statefulset: { label: 'StatefulSets', icon: Boxes, short: 'sts' },
  daemonset: { label: 'DaemonSets', icon: Server, short: 'ds' },
  service: { label: 'Services', icon: Network, short: 'svc' },
  configmap: { label: 'ConfigMaps', icon: FileJson, short: 'cm' },
  secret: { label: 'Secrets', icon: KeyRound, short: 'secret' },
  cronjob: { label: 'CronJobs', icon: Clock, short: 'cj' },
  job: { label: 'Jobs', icon: Briefcase, short: 'job' },
}

export function ResourceList() {
  const select = useCluster((s) => s.select)
  const pods = useCluster((s) => s.pods)
  const deployments = useCluster((s) => s.deployments)
  const replicaSets = useCluster((s) => s.replicaSets)
  const daemonSets = useCluster((s) => s.daemonSets)
  const statefulSets = useCluster((s) => s.statefulSets)
  const services = useCluster((s) => s.services)
  const configMaps = useCluster((s) => s.configMaps)
  const secrets = useCluster((s) => s.secrets)
  const cronJobs = useCluster((s) => s.cronJobs)
  const jobs = useCluster((s) => s.jobs)

  const groups: { kind: ResourceKind; items: { id: string; name: string; status: string; extra?: string }[] }[] = [
    {
      kind: 'deployment',
      items: deployments.map((d) => {
        const rsPods = pods.filter((p) => replicaSets.filter((r) => r.parentDeployment === d.id).some((r) => p.ownerId === r.id))
        const ready = rsPods.filter((p) => p.phase === 'Running').length
        return { id: d.id, name: d.name, status: `${ready}/${d.replicas}`, extra: d.image }
      }),
    },
    {
      kind: 'replicaset',
      items: replicaSets.map((r) => {
        const mine = pods.filter((p) => p.ownerId === r.id)
        const ready = mine.filter((p) => p.phase === 'Running').length
        return { id: r.id, name: r.name, status: `${ready}/${r.replicas}`, extra: `${r.superseded ? 'superseded · ' : ''}${r.image}` }
      }),
    },
    {
      kind: 'statefulset',
      items: statefulSets.map((d) => {
        const mine = pods.filter((p) => p.ownerId === d.id && p.phase !== 'Succeeded')
        const ready = mine.filter((p) => p.phase === 'Running').length
        return { id: d.id, name: d.name, status: `${ready}/${d.replicas}`, extra: `${d.serviceName}` }
      }),
    },
    {
      kind: 'daemonset',
      items: daemonSets.map((d) => {
        const mine = pods.filter((p) => p.ownerId === d.id && p.phase !== 'Succeeded')
        const ready = mine.filter((p) => p.phase === 'Running').length
        return { id: d.id, name: d.name, status: `${ready}/${mine.length}`, extra: d.image }
      }),
    },
    {
      kind: 'service',
      items: services.map((s) => {
        const eps = serviceEndpoints(pods, s)
        return { id: s.id, name: s.name, status: eps.length > 0 ? `${eps.length} endpoints` : 'no endpoints', extra: `${s.type} · ${s.clusterIP}${s.nodePort ? `:${s.nodePort}` : ''}` }
      }),
    },
    {
      kind: 'configmap',
      items: configMaps.map((c) => ({ id: c.id, name: c.name, status: `${Object.keys(c.data).length} keys` })),
    },
    {
      kind: 'secret',
      items: secrets.map((c) => ({ id: c.id, name: c.name, status: `${Object.keys(c.data).length} keys` })),
    },
    {
      kind: 'cronjob',
      items: cronJobs.map((c) => ({ id: c.id, name: c.name, status: `${c.completions} done${c.active ? ` · ${c.active} active` : ''}`, extra: `schedule ${c.schedule}s` })),
    },
    {
      kind: 'job',
      items: jobs.map((j) => ({ id: j.id, name: j.name, status: j.status, extra: j.image })),
    },
  ]

  const total = groups.reduce((a, g) => a + g.items.length, 0)

  return (
    <div className="p-3 space-y-2">
      <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider px-1">
        Cluster resources {total > 0 && <span className="text-zinc-600 font-mono normal-case">({total})</span>}
      </div>
      {total === 0 && (
        <div className="text-[11px] text-zinc-600 italic px-1">empty — drag resources from the palette above</div>
      )}
      {groups.map((g) => {
        if (g.items.length === 0) return null
        const meta = kindMeta[g.kind]
        const Icon = meta.icon
        return (
          <div key={g.kind}>
            <div className="flex items-center gap-1.5 px-1 mb-1 text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">
              <Icon className="h-3 w-3 text-zinc-600" />
              {meta.label}
            </div>
            <div className="space-y-1">
              {g.items.map((item) => (
                <div
                  key={item.id}
                  onClick={() => select(`${g.kind}:${item.id}`)}
                  className="cursor-pointer rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 hover:border-emerald-600/60 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono text-zinc-200 truncate">{item.name}</span>
                    <span className={`text-[10px] font-mono shrink-0 flex items-center gap-1 ${item.status.includes('endpoints') && item.status.startsWith('0') ? 'text-amber-500' : 'text-zinc-500'}`}>
                      {item.status.includes('Complete') && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                      {item.status}
                    </span>
                  </div>
                  {item.extra && <div className="text-[10px] text-zinc-600 font-mono truncate">{item.extra}</div>}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
