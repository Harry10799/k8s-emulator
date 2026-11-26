'use client'

import { useCallback, useEffect, useMemo, useRef } from 'react'
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
import { useCluster, nodeUsage } from '@/lib/cluster-store'
import { WorkerNodeCard, type WorkerNodeData } from './worker-node-card'
import { ControlPlaneCard, type ControlPlaneData } from './control-plane-card'

const nodeTypes: NodeTypes = {
  workerNode: WorkerNodeCard,
  controlPlane: ControlPlaneCard,
}

export interface DropPayload {
  kind: 'pod' | 'deployment'
  image: string
  cpuRequest: number
  memRequest: number
  crashRate: number
  replicas?: number
}

export function ClusterCanvas() {
  const nodes = useCluster((s) => s.nodes)
  const pods = useCluster((s) => s.pods)
  const deployments = useCluster((s) => s.deployments)
  const running = useCluster((s) => s.running)
  const speed = useCluster((s) => s.speed)
  const tick = useCluster((s) => s.tick)
  const moveNode = useCluster((s) => s.moveNode)
  const addPod = useCluster((s) => s.addPod)
  const addDeployment = useCluster((s) => s.addDeployment)
  const wrapper = useRef<HTMLDivElement>(null)
  const { screenToFlowPosition } = useReactFlow()

  // simulation heartbeat
  useEffect(() => {
    if (!running) return
    const interval = setInterval(() => tick(), 1000 / speed)
    return () => clearInterval(interval)
  }, [running, speed, tick])

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
      const pos = screenToFlowPosition({ x: event.clientX, y: event.clientY })

      // find worker node whose card contains the drop point
      let targetId: string | undefined
      for (const n of nodes) {
        if (n.role !== 'worker') continue
        const w = 320
        const h = 230
        if (pos.x >= n.position.x && pos.x <= n.position.x + w && pos.y >= n.position.y && pos.y <= n.position.y + h) {
          targetId = n.id
          break
        }
      }
      if (payload.kind === 'deployment') {
        addDeployment({
          name: payload.image.split(':')[0],
          replicas: payload.replicas ?? 3,
          image: payload.image,
          cpuRequest: payload.cpuRequest,
          memRequest: payload.memRequest,
        })
      } else {
        addPod(
          {
            image: payload.image,
            cpuRequest: payload.cpuRequest,
            memRequest: payload.memRequest,
            crashRate: payload.crashRate,
          },
          targetId ?? null
        )
      }
    },
    [nodes, screenToFlowPosition, addPod, addDeployment]
  )

  return (
    <div className="h-full w-full bg-zinc-950" ref={wrapper}>
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

      {pending.length > 0 && (
        <div className="absolute left-3 top-3 z-10 rounded-lg border border-amber-600/40 bg-zinc-900/95 p-2 shadow-lg max-w-[220px]">
          <div className="text-[10px] uppercase tracking-wider text-amber-500 mb-1 font-semibold">Unscheduled ({pending.length})</div>
          {pending.map((p) => (
            <div key={p.id} className="text-[10px] font-mono text-zinc-400 truncate">· {p.name} — waiting for capacity</div>
          ))}
        </div>
      )}
    </div>
  )
}
