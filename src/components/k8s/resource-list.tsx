'use client'

import {
  Package, Layers, Copy, Server, Boxes, Network, FileJson, KeyRound, Clock, Briefcase, CheckCircle2, PencilLine, Circle, HardDrive, Globe,
} from 'lucide-react'
import { useCluster, serviceEndpoints, type ResourceKind } from '@/lib/cluster-store'

const kindMeta: Record<string, { label: string; icon: typeof Package; short: string }> = {
  namespace: { label: 'Namespaces', icon: Circle, short: 'ns' },
  deployment: { label: 'Deployments', icon: Layers, short: 'deploy' },
  replicaset: { label: 'ReplicaSets', icon: Copy, short: 'rs' },
  statefulset: { label: 'StatefulSets', icon: Boxes, short: 'sts' },
  daemonset: { label: 'DaemonSets', icon: Server, short: 'ds' },
  service: { label: 'Services', icon: Network, short: 'svc' },
  configmap: { label: 'ConfigMaps', icon: FileJson, short: 'cm' },
  secret: { label: 'Secrets', icon: KeyRound, short: 'secret' },
  cronjob: { label: 'CronJobs', icon: Clock, short: 'cj' },
  job: { label: 'Jobs', icon: Briefcase, short: 'job' },
  pvc: { label: 'Volumes', icon: HardDrive, short: 'pvc' },
  ingress: { label: 'Ingresses', icon: Globe, short: 'ing' },
}

export function ResourceList() {
  const select = useCluster((s) => s.select)
  const setEditing = useCluster((s) => s.setEditing)
  const activeNamespace = useCluster((s) => s.activeNamespace)
  const namespaces = useCluster((s) => s.namespaces)
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
  const pvcs = useCluster((s) => s.pvcs)
  const ingresses = useCluster((s) => s.ingresses)

  const inNs = <T extends { namespace: string }>(list: T[]) => (activeNamespace === 'all' ? list : list.filter((r) => r.namespace === activeNamespace))

  const groups: { kind: ResourceKind; items: { id: string; name: string; status: string; extra?: string; ns?: string }[] }[] = [
    {
      kind: 'namespace',
      items: (activeNamespace === 'all' ? namespaces : namespaces.filter((n) => n.name === activeNamespace)).map((n) => ({
        id: n.id,
        name: n.name,
        status: n.name === 'default' ? 'system' : 'active',
        extra: Object.keys(n.labels).length > 0 ? Object.entries(n.labels).map(([k, v]) => `${k}=${v}`).join(' ') : undefined,
      })),
    },
    {
      kind: 'deployment',
      items: inNs(deployments).map((d) => {
        const rsPods = pods.filter((p) => replicaSets.filter((r) => r.parentDeployment === d.id).some((r) => p.ownerId === r.id))
        const ready = rsPods.filter((p) => p.phase === 'Running').length
        return { id: d.id, name: d.name, status: `${ready}/${d.replicas}`, extra: `${d.image}${d.namespace !== 'default' ? ` · ns/${d.namespace}` : ''}` }
      }),
    },
    {
      kind: 'replicaset',
      items: inNs(replicaSets).map((r) => {
        const mine = pods.filter((p) => p.ownerId === r.id)
        const ready = mine.filter((p) => p.phase === 'Running').length
        return { id: r.id, name: r.name, status: `${ready}/${r.replicas}`, extra: `${r.superseded ? 'superseded · ' : ''}${r.image}` }
      }),
    },
    {
      kind: 'statefulset',
      items: inNs(statefulSets).map((d) => {
        const mine = pods.filter((p) => p.ownerId === d.id && p.phase !== 'Succeeded')
        const ready = mine.filter((p) => p.phase === 'Running').length
        return { id: d.id, name: d.name, status: `${ready}/${d.replicas}`, extra: `${d.serviceName}` }
      }),
    },
    {
      kind: 'daemonset',
      items: inNs(daemonSets).map((d) => {
        const mine = pods.filter((p) => p.ownerId === d.id && p.phase !== 'Succeeded')
        const ready = mine.filter((p) => p.phase === 'Running').length
        return { id: d.id, name: d.name, status: `${ready}/${mine.length}`, extra: d.image }
      }),
    },
    {
      kind: 'service',
      items: inNs(services).map((s) => {
        const eps = serviceEndpoints(pods, s)
        return { id: s.id, name: s.name, status: eps.length > 0 ? `${eps.length} endpoints` : 'no endpoints', extra: `${s.type} · ${s.clusterIP}${s.nodePort ? `:${s.nodePort}` : ''}` }
      }),
    },
    {
      kind: 'configmap',
      items: inNs(configMaps).map((c) => ({ id: c.id, name: c.name, status: `${Object.keys(c.data).length} keys` })),
    },
    {
      kind: 'secret',
      items: inNs(secrets).map((c) => ({ id: c.id, name: c.name, status: `${Object.keys(c.data).length} keys` })),
    },
    {
      kind: 'cronjob',
      items: inNs(cronJobs).map((c) => ({ id: c.id, name: c.name, status: `${c.completions} done${c.active ? ` · ${c.active} active` : ''}`, extra: `schedule ${c.schedule}s` })),
    },
    {
      kind: 'job',
      items: inNs(jobs).map((j) => ({ id: j.id, name: j.name, status: j.status, extra: j.image })),
    },
    {
      kind: 'pvc',
      items: inNs(pvcs).map((c) => ({ id: c.id, name: c.name, status: c.status, extra: `${c.sizeGi}Gi · ${c.storageClass}` })),
    },
    {
      kind: 'ingress',
      items: inNs(ingresses).map((g) => ({ id: g.id, name: g.name, status: g.host, extra: `${g.path} → ${g.serviceName}` })),
    },
  ]

  const total = groups.reduce((a, g) => a + g.items.length, 0)

  return (
    <div className="p-3 space-y-2">
      <div className="text-xs font-semibold text-zinc-400 uppercase tracking-wider px-1">
        Cluster resources {total > 0 && <span className="text-zinc-600 font-mono normal-case">({total})</span>}
      </div>
      <div className="text-[10px] text-zinc-600 px-1 -mt-1">click to inspect · ✎ to edit · double-click = edit</div>
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
                  onDoubleClick={() => setEditing(`${g.kind}:${item.id}`)}
                  title="click to inspect · double-click to edit"
                  className="group cursor-pointer rounded-md border border-zinc-800 bg-zinc-900 px-2 py-1.5 hover:border-emerald-600/60 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] font-mono text-zinc-200 truncate">{item.name}</span>
                    <span className="flex items-center gap-1 shrink-0">
                      <span className={`text-[10px] font-mono flex items-center gap-1 ${item.status.includes('endpoints') && item.status.startsWith('0') ? 'text-amber-500' : 'text-zinc-500'}`}>
                        {item.status.includes('Complete') && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
                        {item.status}
                      </span>
                      <button
                        aria-label={`Edit ${item.name}`}
                        onClick={(e) => {
                          e.stopPropagation()
                          setEditing(`${g.kind}:${item.id}`)
                        }}
                        className="h-5 w-5 flex items-center justify-center rounded text-zinc-600 hover:text-emerald-400 hover:bg-zinc-800 transition-colors"
                      >
                        <PencilLine className="h-3 w-3" />
                      </button>
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
