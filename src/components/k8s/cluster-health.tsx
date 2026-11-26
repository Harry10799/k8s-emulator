'use client'

import { useState } from 'react'
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, Server } from 'lucide-react'
import { engineStore, useEngineSnapshot } from '@/lib/engine-store'

const components = [
  ['apiServerAvailable', 'API server'],
  ['etcdAvailable', 'etcd'],
  ['schedulerAvailable', 'Scheduler'],
  ['controllerManagerAvailable', 'Controller manager'],
] as const

export function ClusterHealth() {
  const [expanded, setExpanded] = useState(false)
  const state = useEngineSnapshot(snapshot => snapshot)
  const resources = Object.values(state.resources)
  const nodes = resources.filter(resource => resource.kind === 'Node')
  const pods = resources.filter(resource => resource.kind === 'Pod')
  const readyNodes = nodes.filter(node => node.status.conditions.some(condition => condition.type === 'Ready' && condition.status)).length
  const pendingPods = pods.filter(pod => pod.status.phase === 'Pending').length
  const failedPods = pods.filter(pod => pod.status.phase === 'Failed').length
  const controlPlane = state.controlPlane ?? { apiServerAvailable: true, etcdAvailable: true, schedulerAvailable: true, controllerManagerAvailable: true }
  const healthy = components.every(([key]) => controlPlane[key]) && readyNodes === nodes.length && failedPods === 0

  return (
    <section className="absolute right-3 top-3 z-20 w-[min(330px,calc(100vw-24px))] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950/95 shadow-xl">
      <button onClick={() => setExpanded(value => !value)} aria-expanded={expanded} className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left">
        <span className="flex min-w-0 items-center gap-2">
          <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${healthy ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'}`}>
            {healthy ? <CheckCircle2 className="h-4 w-4"/> : <AlertTriangle className="h-4 w-4"/>}
          </span>
          <span className="min-w-0">
            <span className="block text-xs font-semibold text-zinc-100">Cluster health</span>
            <span className="block text-[10px] text-zinc-500">{readyNodes}/{nodes.length} nodes ready · {pods.length} pods · {pendingPods} pending</span>
          </span>
        </span>
        <span className="flex items-center gap-2 text-zinc-500">
          <Activity className="h-3.5 w-3.5"/>
          {expanded ? <ChevronUp className="h-4 w-4"/> : <ChevronDown className="h-4 w-4"/>}
        </span>
      </button>
      {expanded && (
        <div className="space-y-3 border-t border-zinc-800 p-3">
          <div>
            <div className="mb-1.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-500">Control plane</div>
            <div className="grid grid-cols-2 gap-1.5">
              {components.map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1.5 text-[10px] text-zinc-300">
                  <span>{label}</span>
                  <input aria-label={label + ' availability'} type="checkbox" checked={controlPlane[key]} onChange={event => engineStore.setControlPlane(key, event.target.checked)} className="accent-emerald-500"/>
                </label>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1.5 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-zinc-500"><Server className="h-3 w-3"/> Worker nodes</div>
            {nodes.length === 0 && <p className="text-[10px] text-zinc-500">Node inventory appears after the first simulation tick.</p>}
            <div className="space-y-1.5">
              {nodes.map(node => {
                const ready = node.status.conditions.some(condition => condition.type === 'Ready' && condition.status)
                return <div key={node.metadata.uid} className="flex items-center justify-between gap-2 rounded-md border border-zinc-800 bg-zinc-900/70 px-2 py-1.5">
                  <span className="min-w-0">
                    <span className="block truncate text-[10px] text-zinc-200">{node.metadata.name}</span>
                    <span className={`text-[9px] ${ready ? 'text-emerald-400' : 'text-rose-400'}`}>{ready ? 'Ready' : 'NotReady'}{node.spec.unschedulable ? ' · cordoned' : ''}</span>
                  </span>
                  <span className="flex shrink-0 gap-1">
                    <button onClick={() => engineStore.setHeartbeat(node.metadata.name, node.status.heartbeatEnabled === false)} className="rounded bg-zinc-800 px-1.5 py-1 text-[9px] text-zinc-300 hover:bg-zinc-700">{node.status.heartbeatEnabled === false ? 'Restore' : 'Stop heartbeat'}</button>
                    <button onClick={() => engineStore.cordon(node.metadata.name, !node.spec.unschedulable)} className="rounded bg-zinc-800 px-1.5 py-1 text-[9px] text-zinc-300 hover:bg-zinc-700">{node.spec.unschedulable ? 'Uncordon' : 'Cordon'}</button>
                    <button onClick={() => engineStore.drain(node.metadata.name)} className="rounded bg-amber-950/70 px-1.5 py-1 text-[9px] text-amber-300 hover:bg-amber-900">Drain</button>
                  </span>
                </div>
              })}
            </div>
          </div>
          <div className="flex items-center justify-between border-t border-zinc-800 pt-2 text-[10px] text-zinc-500">
            <span>{failedPods} failed pods</span>
            <span>Simulation tick {state.tick}</span>
          </div>
        </div>
      )}
    </section>
  )
}
