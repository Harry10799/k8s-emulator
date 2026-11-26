'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Server, Waypoints } from 'lucide-react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  useReactFlow,
  type Edge,
  type Node,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { useCluster, nodeUsage, type DropPayload } from '@/lib/cluster-store'
import { WorkerNodeCard, type WorkerNodeData } from './worker-node-card'
import { ControlPlaneCard, type ControlPlaneData } from './control-plane-card'
import { CanvasRegistry } from './canvas-registry'
import { TopologyCanvas } from './topology-canvas'
import { ClusterHealth } from './cluster-health'

const nodeTypes: NodeTypes = {
  workerNode: WorkerNodeCard,
  controlPlane: ControlPlaneCard,
}

export function ClusterCanvas() {
  const [view, setView] = useState<'infra' | 'topo'>('infra')
  const nodes = useCluster((s) => s.nodes)
  const pods = useCluster((s) => s.pods)
  const deployments = useCluster((s) => s.deployments)
  const running = useCluster((s) => s.running)
  const speed = useCluster((s) => s.speed)
  const tick = useCluster((s) => s.tick)
  const moveNode = useCluster((s) => s.moveNode)
  const createResource = useCluster((s) => s.createResource)
  const wrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition } = useReactFlow()


  // simulation heartbeat
  useEffect(() => {
    if (!running) return
    const interval = setInterval(() => tick(), 1000 / speed)
    return () => clearInterval(interval)
  }, [running, speed, tick])

  // canvas nodes: control plane + workers
  const flowNodes: Node[] = useMemo(() => {
    const cp: Node<ControlPlaneData> = {
      id: 'cp1',
      type: 'controlPlane',
      position: nodes.find((n) => n.id === 'cp1')?.position ?? { x: 300, y: 0 },
      data: {
        nodeCount: nodes.filter((n) => n.role === 'worker').length,
        podCount: pods.length,
        deploymentCount: deployments.length,
      },
      draggable: false,
      selectable: false,
    }
    const workerNodes: Node<WorkerNodeData>[] = nodes
      .filter((n) => n.role === 'worker')
      .map((n) => {
        const u = nodeUsage(pods, n.id)
        return {
          id: n.id,
          type: 'workerNode' as const,
          position: n.position,
          data: {
            node: n,
            pods: pods.filter((p) => p.nodeId === n.id),
            usageCpu: u.cpu,
            usageMem: u.mem,
          },
        }
      })
    return [cp, ...workerNodes]
  }, [nodes, pods, deployments])

  const flowEdges: Edge[] = useMemo(
    () =>
      nodes
        .filter((n) => n.role === 'worker')
        .map((n) => ({
          id: `e-cp-${n.id}`,
          source: 'cp1',
          target: n.id,
          animated: running,
          style: { stroke: '#52525b', strokeWidth: 2 },
        })),
    [nodes, running]
  )

  // unscheduled pending pods shown as a small floating list node
  const pending = pods.filter((p) => !p.nodeId)

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault()
      const raw = event.dataTransfer.getData('application/k8s')
      if (!raw) return
      const payload = JSON.parse(raw) as DropPayload

      createResource({ ...payload, image: payload.image ?? 'nginx:latest' })
    },
    [createResource]
  )

  return (
    <div className="h-full w-full bg-zinc-950" ref={wrapper}>
      {/* view toggle: infrastructure (nodes & pods) vs topology (resource relations) */}
      <div className="absolute top-2 left-1/2 z-20 flex -translate-x-1/2 rounded-lg border border-zinc-700 bg-zinc-900/95 shadow-lg overflow-hidden">
        <button
          onClick={() => setView('infra')}
          aria-pressed={view === 'infra'}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium transition-colors ${
            view === 'infra' ? 'bg-zinc-800 text-emerald-400' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Server className="h-3.5 w-3.5" /> Infrastructure
        </button>
        <button
          onClick={() => setView('topo')}
          aria-pressed={view === 'topo'}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium transition-colors ${
            view === 'topo' ? 'bg-zinc-800 text-sky-400' : 'text-zinc-400 hover:text-zinc-200'
          }`}
        >
          <Waypoints className="h-3.5 w-3.5" /> Topology
        </button>
      </div>

      {view === 'infra' ? (
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeDragStop={(_, node) => moveNode(node.id, node.position)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.3}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={false}
        className="bg-zinc-950"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#3f3f46" />
        <Controls
          className="!bg-zinc-900 !border-zinc-700 [&_button]:!bg-zinc-900 [&_button]:!border-zinc-700 [&_button]:!fill-zinc-400 hover:[&_button]:!bg-zinc-800"
          showInteractive={false}
        />
      </ReactFlow>
      ) : (
        <TopologyCanvas />
      )}

      {view === 'infra' && pending.length > 0 && (
        <div className="absolute left-3 top-3 z-10 rounded-lg border border-amber-600/40 bg-zinc-900/95 p-2 shadow-lg max-w-[220px]">
          <div className="text-[10px] uppercase tracking-wider text-amber-500 mb-1 font-semibold">Unscheduled ({pending.length})</div>
          {pending.map((p) => (
            <div key={p.id} className="text-[10px] font-mono text-zinc-400 truncate">· {p.name} — waiting for capacity</div>
          ))}
        </div>
      )}

      {/* cluster-level resources (cm/secret/svc/cj/job) visible + editable on canvas */}
      {view === 'infra' && <CanvasRegistry />}
      <ClusterHealth />
    </div>
  )
}
