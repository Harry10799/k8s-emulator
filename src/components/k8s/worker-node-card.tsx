'use client'

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { Trash2, Cpu, MemoryStick, PencilLine } from 'lucide-react'
import { useCluster, type K8sNode, type Pod } from '@/lib/cluster-store'

export interface WorkerNodeData extends Record<string, unknown> {
  node: K8sNode
  pods: Pod[]
  usageCpu: number
  usageMem: number
}

const phaseStyle: Record<string, { dot: string; label: string; text: string }> = {
  Pending: { dot: 'bg-zinc-400', label: 'Pend', text: 'text-zinc-400' },
  ContainerCreating: { dot: 'bg-amber-400 animate-pulse', label: 'Creating', text: 'text-amber-500' },
  Running: { dot: 'bg-emerald-500', label: 'Running', text: 'text-emerald-500' },
  CrashLoopBackOff: { dot: 'bg-red-500 animate-pulse', label: 'CrashLoop', text: 'text-red-500' },
  Terminating: { dot: 'bg-zinc-500', label: 'Term', text: 'text-zinc-500' },
}

function Bar({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, Math.round((value / max) * 100))
  const color = pct >= 90 ? 'bg-red-500' : pct >= 70 ? 'bg-amber-500' : 'bg-emerald-500'
  return (
    <div className="h-1.5 w-full rounded-full bg-zinc-700/60 overflow-hidden">
      <div className={`h-full rounded-full transition-all duration-500 ${color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

export function WorkerNodeCard({ data }: NodeProps) {
  const d = data as WorkerNodeData
  const select = useCluster((s) => s.select)
  const setEditing = useCluster((s) => s.setEditing)
  const removeNode = useCluster((s) => s.removeNode)

  return (
    <div
      className="w-[320px] rounded-xl border border-zinc-700 bg-zinc-900/95 shadow-lg p-3"
      onDoubleClick={() => select(`node:${d.node.id}`)}
    >
      <Handle type="target" position={Position.Top} className="!bg-emerald-500 !border-zinc-800 !w-2.5 !h-2.5" />
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${d.node.role === 'worker' ? 'bg-emerald-500' : 'bg-zinc-400'}`} />
          <div>
            <div className="text-sm font-semibold text-zinc-100 font-mono">{d.node.name}</div>
            <div className="text-[10px] text-zinc-500">Ready · worker</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            aria-label={`Edit ${d.node.name}`}
            title="Edit node"
            className="p-1.5 rounded-md text-zinc-500 hover:text-emerald-400 hover:bg-zinc-800"
            onClick={(e) => {
              e.stopPropagation()
              setEditing(`node:${d.node.id}`)
            }}
          >
            <PencilLine className="h-4 w-4" />
          </button>
          <button
            aria-label={`Remove ${d.node.name}`}
            title="Delete node"
            className="p-1.5 rounded-md text-zinc-500 hover:text-red-400 hover:bg-zinc-800"
            onClick={(e) => {
              e.stopPropagation()
              removeNode(d.node.id)
            }}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="space-y-1.5 mb-2">
        <div className="flex items-center gap-2 text-[10px] text-zinc-400">
          <Cpu className="h-3 w-3" />
          <span className="font-mono w-24">{d.usageCpu}m / {d.node.cpuCapacity}m</span>
          <div className="flex-1"><Bar value={d.usageCpu} max={d.node.cpuCapacity} /></div>
        </div>
        <div className="flex items-center gap-2 text-[10px] text-zinc-400">
          <MemoryStick className="h-3 w-3" />
          <span className="font-mono w-24">{d.usageMem}Mi / {d.node.memCapacity}Mi</span>
          <div className="flex-1"><Bar value={d.usageMem} max={d.node.memCapacity} /></div>
        </div>
      </div>

      <div className="border-t border-zinc-800 pt-2">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Pods ({d.pods.length})</div>
        {d.pods.length === 0 ? (
          <div className="text-[11px] text-zinc-600 italic py-2">empty — drag a pod here</div>
        ) : (
          <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto custom-scroll">
            {d.pods.map((pod) => {
              const st = phaseStyle[pod.phase] ?? phaseStyle.Pending
              return (
                <button
                  key={pod.id}
                  onClick={(e) => {
                    e.stopPropagation()
                    select(`pod:${pod.id}`)
                  }}
                  title="click to inspect · double-click to edit"
                  onDoubleClick={(e) => {
                    e.stopPropagation()
                    setEditing(`pod:${pod.id}`)
                  }}
                  className={`group inline-flex items-center gap-1.5 rounded-md border border-zinc-700 bg-zinc-800/80 px-2 py-1 text-[10px] font-mono hover:border-emerald-600 transition-colors ${st.text}`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
                  <span className="text-zinc-200">{pod.name}</span>
                  <span className={st.text}>{st.label}</span>
                  {pod.restarts > 0 && <span className="text-red-400">↻{pod.restarts}</span>}
                  <PencilLine className="h-3 w-3 opacity-0 group-hover:opacity-100 text-zinc-500" />
                </button>
              )
            })}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-emerald-500 !border-zinc-800 !w-2.5 !h-2.5 opacity-0" />
    </div>
  )
}

export const workerNodeType = 'workerNode'
export type WorkerFlowNode = Node<WorkerNodeData>
