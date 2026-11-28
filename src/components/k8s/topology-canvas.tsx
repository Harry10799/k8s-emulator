'use client'

import { useMemo, useState } from 'react'
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  type Edge,
  MarkerType,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import {
  Package,
  Layers,
  Copy,
  Server,
  Boxes,
  Network,
  FileJson,
  KeyRound,
  Clock,
  Briefcase,
  HardDrive,
  Globe,
  Activity,
  type LucideIcon,
} from 'lucide-react'
import { useCluster } from '@/lib/cluster-store'
import { getCanvasRuntimeState } from '../../../engine/canvas-runtime'
import { useEngineSnapshot } from '@/lib/engine-store'
import { useConnections } from '@/hooks/use-connections'
import { useTraffic } from '@/hooks/use-traffic'
import { TrafficDashboard } from '@/components/k8s/traffic-dashboard'

// ---------------------------------------------------------------- card sizes
const NW = 190 // card width
const NH = 54 // card height
const VGAP = 14 // vertical gap between cards in a column
const COLX = { providers: 0, controllers: 240, middle: 480, pods: 720 }

type TopoCardData = {
  selectionId: string
  kind: string
  name: string
  sub: string
  icon: LucideIcon
  color: string
  dot: string | null
  dim: boolean
}

type TopoCardNode = Node<TopoCardData, 'topoCard'>
type NsFrameData = { ns: string; count: number; width: number; height: number }
type NsFrameNode = Node<NsFrameData, 'nsFrame'>

const PHASE_DOT: Record<string, string> = {
  Running: '#34d399',
  Pending: '#fbbf24',
  ContainerCreating: '#38bdf8',
  CrashLoopBackOff: '#f87171',
  Terminating: '#a1a1aa',
  Succeeded: '#2dd4bf',
}

function TopoCard({ data }: NodeProps<TopoCardNode>) {
  const selected = useCluster((s) => s.selected)
  const Icon = data.icon
  const isSel = selected === data.selectionId
  return (
    <div title="click to inspect · double-click to edit" className={`topology-rack-card group w-[190px] ${isSel ? 'is-selected' : ''} ${data.dim ? 'is-dim' : ''}`} data-kind={data.kind}>
      <div className="topology-rack-topline"><span className="rack-screw"/><span className="rack-screw"/><span className="rack-unit-label">{data.kind.toUpperCase()} / RESOURCE</span><span className="rack-screw"/></div>
      <div className="topology-rack-body">
        <Handle type="target" position={Position.Left} isConnectable={true} className="!h-2 !w-2 !border-0 !bg-amber-500 !opacity-0 group-hover:!opacity-100"/>
        <div className="topology-icon-bay"><Icon className="h-4 w-4 shrink-0" style={{color:'var(--brass-soft)'}}/></div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5"><span className="truncate font-mono text-[11px] font-medium topology-resource-name">{data.name}</span>{data.dot&&<span className="topology-status-led" style={{background:data.dot}}/>}</div>
          <div className="flex items-center justify-between gap-2 mt-1"><span className="shrink-0 text-[11px] uppercase tracking-wider topology-resource-kind">{data.kind}</span><span className="truncate text-[11px] topology-resource-sub">{data.sub}</span></div>
        </div>
        <Handle type="source" position={Position.Right} isConnectable={true} className="!h-2 !w-2 !border-0 !bg-amber-500 !opacity-0 group-hover:!opacity-100"/>
      </div>
      <div className="topology-rack-footer"><span>UNIT STATUS</span><span>{data.dim?'INACTIVE':data.dot?'INDICATED':'REGISTERED'}</span></div>
    </div>
  )
}
function NsFrame({ data }: NodeProps<NsFrameNode>) {
  return (
    <div
      className="namespace-blueprint-frame"
      style={{ width: data.width, height: data.height }}
    >
      <div className="namespace-blueprint-label">
        namespace / {data.ns} · {data.count} resources
      </div>
    </div>
  )
}

const nodeTypes: NodeTypes = { topoCard: TopoCard, nsFrame: NsFrame }

// ---------------------------------------------------------------- graph build
export function TopologyCanvas() {
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
  const namespaces = useCluster((s) => s.namespaces)
  const activeNamespace = useCluster((s) => s.activeNamespace)
  const running = useCluster((s) => s.running)
  const select = useCluster((s) => s.select)
  const selectedResource = useCluster((s) => s.selected)
  const engineState = useEngineSnapshot((state) => state)
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null)
  const [showTrafficDashboard, setShowTrafficDashboard] = useState(false)
  const setEditing = useCluster((s) => s.setEditing)
  const { selectedIngressId, setSelectedIngressId, trafficRoute, trafficMessage, setTrafficMessage, lastTrafficResult, sendRequest, trafficRps, setTrafficRps } = useTraffic(activeNamespace)
  const onConnect = useConnections(setTrafficMessage)

  const { flowNodes, flowEdges, total } = useMemo(() => {
    const visibleNs = namespaces.filter((n) => activeNamespace === 'all' || n.name === activeNamespace)
    // node ids must be colon-free (ReactFlow edge SVG ids break with ':'); selection ids keep 'kind:id' format for the store
    const nid = (kind: string, id: string) => `t-${kind}-${id}`
    const sid = (kind: string, id: string) => `${kind}:${id}`

    const cards: Node[] = []
    const edges: Edge[] = []
    const frames: Node[] = []
    let totalRes = 0
    let cursorY = 0

    const ownStyle = { stroke: '#8e7955', strokeWidth: 1.5 }
    const faded = { stroke: '#766f61', strokeWidth: 1, strokeDasharray: '4 4' }
    const svcStyle = { stroke: '#b58a43', strokeWidth: 2 }
    const cmStyle = { stroke: '#b58a43', strokeWidth: 1.5, strokeDasharray: '6 3' }
    const secStyle = { stroke: '#9b835d', strokeWidth: 1.5, strokeDasharray: '6 3' }
    const cjStyle = { stroke: '#a68b60', strokeWidth: 1.5 }
    const pvcStyle = { stroke: '#ad8b58', strokeWidth: 1.5, strokeDasharray: '2 4' }
    const ingStyle = { stroke: '#c69b4d', strokeWidth: 2 }

    for (const ns of visibleNs) {
      const nsPods = pods.filter((p) => p.namespace === ns.name)
      const nsDeps = deployments.filter((d) => d.namespace === ns.name)
      const nsRs = replicaSets.filter(
        (r) =>
          r.namespace === ns.name &&
          (r.parentDeployment === null ||
            !r.superseded ||
            pods.some((p) => p.ownerId === r.id && p.phase !== 'Succeeded'))
      )
      const nsDs = daemonSets.filter((d) => d.namespace === ns.name)
      const nsSts = statefulSets.filter((d) => d.namespace === ns.name)
      const nsSvcs = services.filter((v) => v.namespace === ns.name)
      const nsCms = configMaps.filter((c) => c.namespace === ns.name)
      const nsSecs = secrets.filter((c) => c.namespace === ns.name)
      const nsCjs = cronJobs.filter((c) => c.namespace === ns.name)
      const nsJobs = jobs.filter((j) => j.namespace === ns.name)
      const nsPvcs = pvcs.filter((c) => c.namespace === ns.name)
      const nsIngs = ingresses.filter((c) => c.namespace === ns.name)

      // providers: ingress → services → pvcs → configmaps → secrets
      const prov = [
        ...nsIngs.map((g) => ({
          selectionId: sid('ingress', g.id),
          kind: 'ingress',
          name: g.name,
          sub: `${g.host}${g.path}`,
          icon: Globe as LucideIcon,
          color: '#c69b4d',
          dot: null as string | null,
          dim: false,
        })),
        ...nsSvcs.map((v) => ({
          selectionId: sid('service', v.id),
          kind: 'service',
          name: v.name,
          sub: `${v.type} · ${v.clusterIP}`,
          icon: Network as LucideIcon,
          color: '#c69b4d',
          dot: null as string | null,
          dim: false,
        })),
        ...nsCms.map((c) => ({
          selectionId: sid('configmap', c.id),
          kind: 'configmap',
          name: c.name,
          sub: `${Object.keys(c.data).length} keys`,
          icon: FileJson as LucideIcon,
          color: '#c69b4d',
          dot: null as string | null,
          dim: false,
        })),
        ...nsPvcs.map((c) => ({
          selectionId: sid('pvc', c.id),
          kind: 'pvc',
          name: c.name,
          sub: `${c.sizeGi}Gi · ${c.status}`,
          icon: HardDrive as LucideIcon,
          color: '#b58a43',
          dot: c.status === 'Bound' ? '#b58a43' : '#c69b4d',
          dim: false,
        })),
        ...nsSecs.map((c) => ({
          selectionId: sid('secret', c.id),
          kind: 'secret',
          name: c.name,
          sub: `${Object.keys(c.data).length} keys`,
          icon: KeyRound as LucideIcon,
          color: '#b58a43',
          dot: null as string | null,
          dim: false,
        })),
      ]

      const ctrls = [
        ...nsDeps.map((d) => ({
          selectionId: sid('deployment', d.id),
          kind: 'deployment',
          name: d.name,
          sub: `${d.replicas} replicas · ${d.image}`,
          icon: Layers as LucideIcon,
          color: '#c69b4d',
          dot: null as string | null,
          dim: false,
        })),
        ...nsDs.map((d) => ({
          selectionId: sid('daemonset', d.id),
          kind: 'daemonset',
          name: d.name,
          sub: `every node · ${d.image}`,
          icon: Server as LucideIcon,
          color: '#b58a43',
          dot: null as string | null,
          dim: false,
        })),
        ...nsSts.map((d) => ({
          selectionId: sid('statefulset', d.id),
          kind: 'statefulset',
          name: d.name,
          sub: `${d.replicas} replicas · ${d.image}`,
          icon: Boxes as LucideIcon,
          color: '#c69b4d',
          dot: null as string | null,
          dim: false,
        })),
        ...nsCjs.map((c) => ({
          selectionId: sid('cronjob', c.id),
          kind: 'cronjob',
          name: c.name,
          sub: `every ${c.schedule.replace('*/', '')}s · ${c.completions} done`,
          icon: Clock as LucideIcon,
          color: '#b58a43',
          dot: null as string | null,
          dim: false,
        })),
      ]

      const mids = [
        ...nsRs.map((r) => ({
          selectionId: sid('replicaset', r.id),
          kind: 'replicaset',
          name: r.name,
          sub: r.superseded ? `superseded rev ${r.revision}` : `rev ${r.revision} · ${r.replicas} replicas`,
          icon: Copy as LucideIcon,
          color: '#c69b4d',
          dot: null as string | null,
          dim: r.superseded,
        })),
        ...nsJobs.map((j) => ({
          selectionId: sid('job', j.id),
          kind: 'job',
          name: j.name,
          sub: j.status === 'Complete' ? 'complete' : 'running',
          icon: Briefcase as LucideIcon,
          color: '#c69b4d',
          dot: j.status === 'Complete' ? '#c69b4d' : '#c69b4d',
          dim: j.status === 'Complete',
        })),
      ]

      const podCards = nsPods.map((p) => {
        const crashBadge = p.crashRate > 0 ? ` · crash ${Math.round(p.crashRate * 100)}%` : ''
        return {
          selectionId: sid('pod', p.id),
          kind: 'pod',
          name: p.name,
          sub: `${p.phase}${p.restarts > 0 ? ` · ${p.restarts}R` : ''}${crashBadge}`,
          icon: Package as LucideIcon,
          color: '#b6a27d',
          dot: PHASE_DOT[p.phase] ?? '#b6a27d',
          dim: p.phase === 'Terminating' || p.phase === 'Succeeded',
        }
      })

      totalRes += prov.length + ctrls.length + mids.length + podCards.length

      const rows = Math.max(prov.length, ctrls.length, mids.length, podCards.length, 1)
      const bandHeight = rows * (NH + VGAP) + 80

      const addCol = (col: number, items: typeof prov) => {
        items.forEach((d, i) => {
          cards.push({
            id: 't-' + d.selectionId.replace(':', '-'),
            type: 'topoCard',
            position: { x: col, y: cursorY + i * (NH + VGAP) },
            data: d,
            selectable: true,
            draggable: false,
          } as TopoCardNode)
        })
      }
      addCol(COLX.providers, prov)
      addCol(COLX.controllers, ctrls)
      addCol(COLX.middle, mids)
      addCol(COLX.pods, podCards)

      // External client is rendered only while a request is in flight.
      if (trafficRoute) {
        const ingressNode = cards.find((node) => node.id === nid('ingress', trafficRoute.ingressId))
        if (ingressNode) {
          cards.push({
            id: 't-traffic-client',
            type: 'topoCard',
            position: { x: -240, y: ingressNode.position.y },
            data: { selectionId: 'traffic:client', kind: 'client', name: 'external-client', sub: 'HTTP request', icon: Globe as LucideIcon, color: '#c69b4d', dot: '#c69b4d', dim: false },
            selectable: false,
            draggable: false,
          } as TopoCardNode)
          edges.push({ id: 'e-client-ingress', source: 't-traffic-client', target: nid('ingress', trafficRoute.ingressId), style: { stroke: '#c69b4d', strokeWidth: 3 } })
        }
      }

      // ---- edges
      // deployment → ReplicaSet (owner chain)
      for (const d of nsDeps) {
        for (const r of replicaSets.filter((r) => r.parentDeployment === d.id)) {
          edges.push({
            id: `e-dep-${d.id}-rs-${r.id}`,
            source: nid('deployment', d.id),
            target: nid('replicaset', r.id),
            style: r.superseded ? faded : ownStyle,
          })
        }
      }
      // ReplicaSet / DaemonSet / StatefulSet / Job → pod (owner)
      const ownerEdges = (ownerId: string, ownerKind: string, style: { stroke: string; strokeWidth: number; strokeDasharray?: string }, fadedStyle = false) => {
        for (const p of nsPods.filter((p) => p.ownerId === ownerId)) {
          edges.push({
            id: `e-${ownerKind}-${ownerId}-${p.id}`,
            source: nid(ownerKind, ownerId),
            target: nid('pod', p.id),
            style: fadedStyle ? faded : style,
          })
        }
      }
      for (const r of nsRs) ownerEdges(r.id, 'replicaset', ownStyle, r.superseded)
      for (const d of nsDs) ownerEdges(d.id, 'daemonset', ownStyle)
      for (const d of nsSts) ownerEdges(d.id, 'statefulset', ownStyle)
      for (const j of nsJobs) ownerEdges(j.id, 'job', ownStyle)
      // cronjob → job
      for (const c of nsCjs) {
        for (const j of nsJobs.filter((j) => j.cronjobOwner === c.id)) {
          edges.push({ id: `e-cj-${c.id}-${j.id}`, source: nid('cronjob', c.id), target: nid('job', j.id), style: cjStyle })
        }
      }
      // Service → Pod edges mirror the engine-published Ready endpoint set.
      const engineResources = Object.values(getCanvasRuntimeState().resources)
      for (const v of nsSvcs) {
        const engineService = engineResources.find(resource => resource.kind === 'Service' && resource.metadata.uid === v.id)
        const endpointIds = new Set(engineService?.kind === 'Service' ? engineService.status.endpoints.map(endpoint => endpoint.podUid) : [])
        for (const p of nsPods) {
          if (endpointIds.has(p.id)) {
            edges.push({
              id: `e-svc-${v.id}-${p.id}`,
              source: nid('service', v.id),
              target: nid('pod', p.id),
              style: svcStyle,
              animated: running,
            })
          }
        }
      }
      // ConfigMap/Secret imports are Pod-template relationships on controllers.
      for (const c of nsCms) {
        for (const workload of [...nsDeps, ...nsDs, ...nsSts]) {
          if (workload.namespace === c.namespace && workload.envConfigMaps?.includes(c.name)) {
            const kind = 'replicas' in workload ? ('revision' in workload ? 'deployment' : 'statefulset') : 'daemonset';
            edges.push({ id: `e-cm-${c.id}-${kind}-${workload.id}`, source: nid('configmap', c.id), target: nid(kind, workload.id), style: cmStyle });
          }
        }
      }
      for (const c of nsSecs) {
        for (const workload of [...nsDeps, ...nsDs, ...nsSts]) {
          if (workload.namespace === c.namespace && workload.envSecrets?.includes(c.name)) {
            const kind = 'replicas' in workload ? ('revision' in workload ? 'deployment' : 'statefulset') : 'daemonset';
            edges.push({ id: `e-sec-${c.id}-${kind}-${workload.id}`, source: nid('secret', c.id), target: nid(kind, workload.id), style: secStyle });
          }
        }
      }
      // Explicit PVC → StatefulSet claim wiring.
      for (const c of nsPvcs) {
        for (const sts of nsSts.filter((item) => item.claimName === c.name)) {
          edges.push({ id: `e-pvc-sts-${c.id}-${sts.id}`, source: nid('pvc', c.id), target: nid('statefulset', sts.id), style: pvcStyle })
        }
      }
      // pvc → pod it is mounted by (statefulset volumeClaimTemplate)
      for (const c of nsPvcs) {
        const mounters = nsPods.filter((p) => p.mountedPvc === c.name)
        for (const p of mounters) {
          edges.push({ id: `e-pvc-${c.id}-${p.id}`, source: nid('pvc', c.id), target: nid('pod', p.id), style: pvcStyle })
        }
      }
      // ingress → service (routing rule)
      for (const g of nsIngs) {
        const svc = nsSvcs.find((v) => v.name === g.serviceName)
        if (svc) {
          edges.push({ id: `e-ing-${g.id}-${svc.id}`, source: nid('ingress', g.id), target: nid('service', svc.id), style: ingStyle, animated: running })
        }
      }

      frames.push({
        id: `t-frame-${ns.id}`,
        type: 'nsFrame',
        position: { x: -20, y: cursorY - 34 },
        data: { ns: ns.name, count: prov.length + ctrls.length + mids.length + podCards.length, width: COLX.pods + NW + 50, height: bandHeight + 34 },
        selectable: false,
        draggable: false,
        deletable: false,
      } as NsFrameNode)

      cursorY += bandHeight + 60
    }

    // Give every relationship a visible direction and animate the flow while the cluster is running.
    // React Flow's `animated` edge style is applied to the path itself; node handles remain non-connectable.
    const activeTrafficEdges = trafficRoute ? new Set([
      'e-client-ingress',
      `e-ing-${trafficRoute.ingressId}-${trafficRoute.serviceId}`,
      `e-svc-${trafficRoute.serviceId}-${trafficRoute.podId}`,
    ]) : null
    const selectedNodeId = selectedResource ? 't-' + selectedResource.replace(':', '-') : null
    const connectedNodeIds = new Set<string>()
    const connectedEdgeIds = new Set<string>()
    if (selectedNodeId && cards.some((node) => node.id === selectedNodeId)) {
      connectedNodeIds.add(selectedNodeId)
      let changed = true
      while (changed) {
        changed = false
        for (const edge of edges) {
          if (connectedNodeIds.has(edge.source) || connectedNodeIds.has(edge.target)) {
            connectedEdgeIds.add(edge.id)
            if (!connectedNodeIds.has(edge.source)) { connectedNodeIds.add(edge.source); changed = true }
            if (!connectedNodeIds.has(edge.target)) { connectedNodeIds.add(edge.target); changed = true }
          }
        }
      }
    }
    const flowEdges: Edge[] = edges.map((edge) => {
      const isTraffic = activeTrafficEdges?.has(edge.id) ?? false
      const isPath = connectedEdgeIds.has(edge.id)
      const isChosen = selectedEdgeId === edge.id
      const baseStroke = (edge.style?.stroke as string | undefined) ?? '#71717a'
      const stroke = isTraffic || isChosen ? '#e0b45f' : isPath ? '#c69b4d' : baseStroke
      const hasSelection = Boolean(selectedNodeId && connectedNodeIds.size)
      return {
        ...edge,
        type: 'smoothstep',
        animated: isTraffic || (hasSelection && isPath) || (running && !hasSelection),
        interactionWidth: 22,
        style: {
          ...edge.style,
          stroke,
          strokeWidth: isTraffic || isChosen ? 3.5 : isPath ? 3 : Math.max(1.5, Number(edge.style?.strokeWidth ?? 1.5)),
          opacity: hasSelection && !isPath ? 0.16 : 1,
        },
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 14, height: 14 },
      }
    })
    const flowNodes = [...frames, ...cards].map((node) => {
      if (node.type !== 'topoCard' || !selectedNodeId || !connectedNodeIds.size) return node
      const active = connectedNodeIds.has(node.id)
      return { ...node, style: { ...node.style, opacity: active ? 1 : 0.28 } }
    })

    return { flowNodes, flowEdges, total: totalRes }
  }, [pods, deployments, replicaSets, daemonSets, statefulSets, services, configMaps, secrets, cronJobs, jobs, pvcs, ingresses, namespaces, activeNamespace, running, trafficRoute, selectedResource, selectedEdgeId, engineState, lastTrafficResult])

  return (
    <div className="relative h-full w-full bg-zinc-950">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        onNodeClick={(_, node) => {
          if (node.type === 'topoCard') select((node.data as TopoCardData).selectionId)
        }}
        onNodeDoubleClick={(_, node) => {
          if (node.type === 'topoCard') setEditing((node.data as TopoCardData).selectionId)
        }}
        onPaneClick={() => { select(null); setSelectedEdgeId(null) }}
        onEdgeClick={(_, edge) => setSelectedEdgeId(edge.id)}
        zoomOnDoubleClick={false}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.15}
        proOptions={{ hideAttribution: true }}
        nodesConnectable={true}
        onConnect={onConnect}
        className="bg-zinc-950"
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} color="#3f3f46" />
        <Controls
          className="!bg-zinc-900 !border-zinc-700 [&_button]:!bg-zinc-900 [&_button]:!border-zinc-700 [&_button]:!fill-zinc-400 hover:[&_button]:!bg-zinc-800"
          showInteractive={false}
        />
      </ReactFlow>

      <div className="absolute right-3 top-3 z-20">
        <button
          type="button"
          onClick={() => setShowTrafficDashboard(value => !value)}
          aria-expanded={showTrafficDashboard}
          className="flex items-center gap-2 rounded-lg border border-amber-600/40 bg-[var(--panel)] px-3 py-2 text-[11px] font-semibold text-[var(--foreground)] shadow-lg hover:border-amber-500"
        >
          <Activity className="h-3.5 w-3.5 text-amber-500" />
          Traffic telemetry
          <span className="font-mono text-[10px] text-[var(--muted-foreground)]">{engineState.trafficRequestCount ?? 0}</span>
        </button>
      </div>
      {showTrafficDashboard && <TrafficDashboard state={engineState} activeNamespace={activeNamespace} onClose={() => setShowTrafficDashboard(false)} />}

      {selectedEdgeId && (() => {
        const edge = flowEdges.find((item) => item.id === selectedEdgeId)
        const source = flowNodes.find((node) => node.id === edge?.source)
        const target = flowNodes.find((node) => node.id === edge?.target)
        const sourceData = source?.type === 'topoCard' ? source.data as TopoCardData : null
        const targetData = target?.type === 'topoCard' ? target.data as TopoCardData : null
        if (!edge || !sourceData || !targetData) return null
        const relation = edge.id.startsWith('e-ing-') ? 'Ingress routes to Service'
          : edge.id.startsWith('e-svc-') ? 'Service selects Ready Pod'
          : edge.id.startsWith('e-dep-') ? 'Deployment owns ReplicaSet'
          : edge.id.startsWith('e-cj-') ? 'CronJob creates Job'
          : edge.id.startsWith('e-cm-') ? 'Workload imports ConfigMap'
          : edge.id.startsWith('e-sec-') ? 'Workload imports Secret'
          : edge.id.startsWith('e-pvc-') ? 'Persistent volume is mounted / claimed'
          : 'Controller ownership relationship'
        const health = (data: TopoCardData) => data.kind !== 'pod' ? 'n/a' : data.sub.split(' · ')[0]
        const serviceUid = sourceData.kind === 'service' ? sourceData.selectionId.split(':')[1] : targetData.kind === 'service' ? targetData.selectionId.split(':')[1] : null
        const serviceResource = serviceUid ? Object.values(engineState.resources).find(resource => resource.kind === 'Service' && resource.metadata.uid === serviceUid) : null
        const readyEndpoints = serviceResource?.kind === 'Service' ? serviceResource.status.endpoints : []
        const latestRequest = serviceResource?.kind === 'Service' && lastTrafficResult?.namespace === (serviceResource.metadata.namespace ?? 'default') && lastTrafficResult.result.serviceName === serviceResource.metadata.name ? lastTrafficResult.result : null
        return <div className="absolute left-1/2 top-3 z-30 w-[min(420px,calc(100%-24px))] -translate-x-1/2 rounded-xl border border-amber-600/40 bg-[var(--panel)] p-3 shadow-2xl">
          <div className="flex items-center justify-between gap-3">
            <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-500">Relationship inspector</div>
            <button onClick={() => setSelectedEdgeId(null)} className="rounded border border-[var(--border)] px-2 py-1 text-[10px]">Close</button>
          </div>
          <div className="mt-2 text-xs font-semibold text-[var(--foreground)]">{relation}</div>
          <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-[11px]">
            <div className="min-w-0"><div className="truncate font-mono">{sourceData.name}</div><div className="mt-1 text-[10px] uppercase text-[var(--muted-foreground)]">{sourceData.kind}</div><div className="mt-1 text-[10px] text-[var(--muted-foreground)]">Endpoint: {health(sourceData)}</div></div>
            <span className="text-amber-500">→</span>
            <div className="min-w-0 text-right"><div className="truncate font-mono">{targetData.name}</div><div className="mt-1 text-[10px] uppercase text-[var(--muted-foreground)]">{targetData.kind}</div><div className="mt-1 text-[10px] text-[var(--muted-foreground)]">Endpoint: {health(targetData)}</div></div>
          </div>
          {serviceResource?.kind === 'Service' && <div className="mt-3 rounded-lg border border-[var(--border)] p-2">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]"><span>Live Service endpoints</span><b className={readyEndpoints.length ? 'text-emerald-400' : 'text-amber-400'}>{readyEndpoints.length} ready</b></div>
            {readyEndpoints.length ? <div className="mt-1.5 flex flex-wrap gap-1">{readyEndpoints.map(endpoint => <span key={endpoint.podUid} className="rounded border border-emerald-500/25 bg-emerald-500/5 px-1.5 py-1 font-mono text-[10px]">{endpoint.podName}</span>)}</div> : <div className="mt-1 text-[10px] text-amber-400">No Ready endpoints published by the Service controller.</div>}
          </div>}
          {latestRequest && <div className="mt-2 rounded-lg border border-[var(--border)] p-2">
            <div className="flex items-center justify-between"><span className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">Latest simulated request</span><b className={latestRequest.ok ? 'text-emerald-400' : 'text-red-400'}>{latestRequest.statusCode} · {latestRequest.ok ? 'SUCCESS' : 'FAILED'}</b></div>
            <div className="mt-1 grid grid-cols-3 gap-2 text-[10px]"><span>Pod<b className="block truncate font-mono text-[var(--foreground)]">{latestRequest.podName ?? '—'}</b></span><span>Latency<b className="block text-[var(--foreground)]">{latestRequest.latencyMs} ms</b></span><span>Modeled error<b className="block text-[var(--foreground)]">{Math.round(latestRequest.errorRate * 100)}%</b></span></div>
            {latestRequest.reason && <div className="mt-1 text-[10px] text-red-400">Reason: {latestRequest.reason}</div>}
          </div>}
          <div className="mt-2 border-t border-[var(--border)] pt-2 text-[10px] text-[var(--muted-foreground)]">Traffic: {serviceResource?.kind === 'Service' ? 'Endpoint membership is live engine state; request outcome is the latest simulated request.' : edge.id.startsWith('e-ing-') ? 'Routing rule relationship; send a test request to inspect the backend outcome.' : 'Control-plane relationship; no per-edge traffic metric is modeled.'}</div>
        </div>
      })()}

      {total === 0 && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="rounded-xl border border-zinc-800 bg-zinc-900/90 px-6 py-4 text-center">
            <div className="text-sm font-medium text-zinc-300">no resources yet</div>
            <div className="mt-1 text-xs text-zinc-500">
              switch to <span className="text-emerald-400">Infrastructure</span> view and drag resources onto the canvas —
              their relationships appear here
            </div>
          </div>
        </div>
      )}

      <div className="absolute right-3 bottom-3 z-20 flex max-w-[min(420px,calc(100%-24px))] flex-col items-end gap-2">
        <select aria-label="Ingress host and path rule" value={selectedIngressId} onChange={(event) => setSelectedIngressId(event.target.value)} className="max-w-[220px] rounded-lg border border-zinc-700 bg-zinc-900 px-2 py-2 text-[10px] text-zinc-200">
          <option value="">Select Ingress host/path…</option>
          {ingresses.filter(item => activeNamespace === 'all' || item.namespace === activeNamespace).map(item => <option key={item.id} value={item.id}>{item.host}{item.path} → {item.serviceName}</option>)}
        </select>
        <label className="flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/95 px-2 py-2 text-[10px] text-zinc-300">
          <span>Load {trafficRps} RPS</span>
          <input aria-label="Simulated requests per second" type="range" min="0" max="100" step="5" value={trafficRps} onChange={(event) => setTrafficRps(Number(event.target.value))} className="w-24 accent-cyan-400" />
        </label>
        <button onClick={sendRequest} className="rounded-lg border border-cyan-500/40 bg-cyan-950/90 px-3 py-2 text-[11px] font-semibold text-cyan-200 shadow-lg hover:bg-cyan-900">
          <span className="mr-1.5">↗</span> Send test request
        </button>
        {trafficMessage && <div role="status" className="max-w-full rounded-lg border border-zinc-700 bg-zinc-900/95 px-3 py-2 text-right text-[10px] text-zinc-300 shadow-lg">{trafficMessage}</div>}
      </div>

      {/* legend */}
      <div className="absolute bottom-3 left-3 z-10 rounded-lg border border-zinc-800 bg-zinc-900/95 p-2.5 shadow-lg">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Topology legend</div>
        {[
          { style: '#71717a', dash: false, label: 'owns (dep → RS → pod)' },
          { style: '#c69b4d', dash: false, label: 'selects pods (service)' },
          { style: '#c69b4d', dash: true, label: 'env from ConfigMap' },
          { style: '#b58a43', dash: true, label: 'env from Secret' },
          { style: '#b58a43', dash: false, label: 'triggers (cronjob)' },
          { style: '#b58a43', dash: true, label: 'mounts PVC (statefulset)' },
          { style: '#c69b4d', dash: false, label: 'routes to service (ingress)' },
        ].map((l) => (
          <div key={l.label} className="flex items-center gap-2 py-0.5">
            <span
              className="h-0 w-6 shrink-0 border-t-2"
              style={{ borderColor: l.style, borderTopStyle: l.dash ? 'dashed' : 'solid' }}
            />
            <span className="text-[10px] text-zinc-400">{l.label}</span>
          </div>
        ))}
        <div className="mt-1.5 border-t border-zinc-800 pt-1.5 text-[10px] text-zinc-500">
          click card = inspect · double-click = edit · drag handle = wire resources
        </div>
      </div>
    </div>
  )
}
