'use client'

import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { useCluster } from '@/lib/cluster-store'

export interface ControlPlaneData extends Record<string, unknown> {
  nodeCount: number
  podCount: number
  deploymentCount: number
}

export function ControlPlaneCard({ data }: NodeProps) {
  const d = data as ControlPlaneData
  return (
    <div className="w-[300px] rounded-xl border border-zinc-700 bg-zinc-900/95 shadow-lg p-3">
      <div className="flex items-center gap-2.5 mb-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-600 bg-zinc-800 text-zinc-300 font-mono text-lg">⎈</div>
        <div>
          <div className="text-sm font-semibold text-zinc-100 font-mono">control-plane-1</div>
          <div className="text-[10px] text-zinc-500">api-server · scheduler · controller-mgr</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-1.5 text-center">
        <div className="rounded-md bg-zinc-800/70 py-1.5">
          <div className="text-sm font-bold text-emerald-400 font-mono">{d.nodeCount}</div>
          <div className="text-[9px] text-zinc-500">nodes</div>
        </div>
        <div className="rounded-md bg-zinc-800/70 py-1.5">
          <div className="text-sm font-bold text-emerald-400 font-mono">{d.podCount}</div>
          <div className="text-[9px] text-zinc-500">pods</div>
        </div>
        <div className="rounded-md bg-zinc-800/70 py-1.5">
          <div className="text-sm font-bold text-emerald-400 font-mono">{d.deploymentCount}</div>
          <div className="text-[9px] text-zinc-500">deployments</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bg-emerald-500 !border-zinc-800 !w-2.5 !h-2.5" />
    </div>
  )
}

export const controlPlaneNodeType = 'controlPlane'
export type ControlPlaneFlowNode = Node<ControlPlaneData>
