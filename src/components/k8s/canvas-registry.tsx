'use client'

import {
  Network, FileJson, KeyRound, Clock, Briefcase, PencilLine, Trash2,
} from 'lucide-react'
import { useCluster, serviceEndpoints, type ResourceKind } from '@/lib/cluster-store'

const kindMeta: Record<string, { label: string; icon: typeof FileJson; color: string }> = {
  service: { label: 'Services', icon: Network, color: 'text-sky-400' },
  configmap: { label: 'ConfigMaps', icon: FileJson, color: 'text-amber-400' },
  secret: { label: 'Secrets', icon: KeyRound, color: 'text-fuchsia-400' },
  cronjob: { label: 'CronJobs', icon: Clock, color: 'text-violet-400' },
  job: { label: 'Jobs', icon: Briefcase, color: 'text-teal-400' },
}

/** Floating panel on the canvas showing cluster-level resources that do not
 *  live inside worker nodes (configmaps, secrets, services, cronjobs, jobs).
 *  Dragging one of these onto the canvas creates it — this panel makes it visible,
 *  inspectable and editable right on the canvas. */
export function CanvasRegistry() {
  const pods = useCluster((s) => s.pods)
  const services = useCluster((s) => s.services)
  const configMaps = useCluster((s) => s.configMaps)
  const secrets = useCluster((s) => s.secrets)
  const cronJobs = useCluster((s) => s.cronJobs)
  const jobs = useCluster((s) => s.jobs)
  const select = useCluster((s) => s.select)
  const setEditing = useCluster((s) => s.setEditing)
  const removeResource = useCluster((s) => s.removeResource)

  const groups: { kind: ResourceKind; items: { id: string; name: string; sub: string }[] }[] = [
    {
      kind: 'service',
      items: services.map((s) => {
        const eps = serviceEndpoints(pods, s)
        return { id: s.id, name: s.name, sub: `${s.type} · ${eps.length} ep${s.nodePort ? ` · :${s.nodePort}` : ''}` }
      }),
    },
    {
      kind: 'configmap',
      items: configMaps.map((c) => ({ id: c.id, name: c.name, sub: `${Object.keys(c.data).length} keys` })),
    },
    {
      kind: 'secret',
      items: secrets.map((c) => ({ id: c.id, name: c.name, sub: `${Object.keys(c.data).length} keys` })),
    },
    {
      kind: 'cronjob',
      items: cronJobs.map((c) => ({ id: c.id, name: c.name, sub: `every ${c.schedule}s · ${c.completions} done` })),
    },
    {
      kind: 'job',
      items: jobs.map((j) => ({ id: j.id, name: j.name, sub: j.status })),
    },
  ]

  const total = groups.reduce((a, g) => a + g.items.length, 0)
  if (total === 0) return null

  return (
    <div className="absolute left-3 bottom-3 z-10 rounded-lg border border-zinc-700 bg-zinc-900/95 p-2 shadow-lg max-w-[260px] max-h-64 overflow-y-auto custom-scroll">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1.5 font-semibold px-0.5">
        Cluster resources ({total}) — click to inspect
      </div>
      {groups.map((g) => {
        if (g.items.length === 0) return null
        const meta = kindMeta[g.kind]
        const Icon = meta.icon
        return (
          <div key={g.kind} className="mb-1.5 last:mb-0">
            <div className="flex items-center gap-1 px-0.5 mb-0.5 text-[9px] uppercase tracking-wider text-zinc-600 font-semibold">
              <Icon className={`h-3 w-3 ${meta.color}`} />
              {meta.label}
            </div>
            {g.items.map((item) => (
              <div
                key={item.id}
                onClick={() => select(`${g.kind}:${item.id}`)}
                className="group flex items-center gap-1.5 rounded-md px-1.5 py-1 hover:bg-zinc-800 cursor-pointer"
              >
                <span className="text-[11px] font-mono text-zinc-200 truncate flex-1">{item.name}</span>
                <span className="text-[9px] font-mono text-zinc-600 truncate hidden sm:inline">{item.sub}</span>
                <button
                  aria-label={`Edit ${item.name}`}
                  title="Edit"
                  className="p-0.5 rounded text-zinc-600 hover:text-emerald-400 opacity-0 group-hover:opacity-100 transition"
                  onClick={(e) => {
                    e.stopPropagation()
                    setEditing(`${g.kind}:${item.id}`)
                  }}
                >
                  <PencilLine className="h-3 w-3" />
                </button>
                <button
                  aria-label={`Delete ${item.name}`}
                  title="Delete"
                  className="p-0.5 rounded text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition"
                  onClick={(e) => {
                    e.stopPropagation()
                    removeResource(g.kind, item.id)
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}
