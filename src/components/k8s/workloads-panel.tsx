'use client'

import { Minus, Plus } from 'lucide-react'
import { useCluster } from '@/lib/cluster-store'

export function WorkloadsPanel() {
  const deployments = useCluster((s) => s.deployments)
  const pods = useCluster((s) => s.pods)
  const select = useCluster((s) => s.select)
  const scaleDeployment = useCluster((s) => s.scaleDeployment)

  return (
    <div className="border-t border-zinc-800">
      <div className="px-3 pt-3 pb-1.5 text-xs font-semibold text-zinc-400 uppercase tracking-wider">Deployments</div>
      {deployments.length === 0 ? (
        <div className="px-3 pb-3 text-[11px] text-zinc-600 italic">none — drag the “web deployment” onto the canvas</div>
      ) : (
        <div className="px-3 pb-3 space-y-1.5">
          {deployments.map((d) => {
            const mine = pods.filter((p) => p.deploymentId === d.id)
            const ready = mine.filter((p) => p.phase === 'Running').length
            return (
              <div
                key={d.id}
                onClick={() => select(`deployment:${d.id}`)}
                className="cursor-pointer rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 hover:border-emerald-600/60 transition-colors"
              >
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <div className="text-xs font-mono text-zinc-200 truncate">{d.name}</div>
                    <div className="text-[10px] text-zinc-500">
                      {ready}/{d.replicas} ready · {d.image}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      aria-label="scale down"
                      className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
                      onClick={(e) => {
                        e.stopPropagation()
                        scaleDeployment(d.id, d.replicas - 1)
                      }}
                    >
                      <Minus className="h-3.5 w-3.5" />
                    </button>
                    <span className="font-mono text-xs text-zinc-300 w-4 text-center">{d.replicas}</span>
                    <button
                      aria-label="scale up"
                      className="p-1 rounded text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800"
                      onClick={(e) => {
                        e.stopPropagation()
                        scaleDeployment(d.id, d.replicas + 1)
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
