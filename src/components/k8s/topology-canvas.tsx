'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
  type Connection,
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
  type LucideIcon,
} from 'lucide-react'
import { useCluster, selectorMatches, type Labels } from '@/lib/cluster-store'

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
    <div
      title="click to inspect · double-click to edit"
      className={`group w-[190px] rounded-lg border bg-zinc-900/95 px-2.5 py-2 shadow-md transition-colors ${
        isSel ? 'border-emerald-500 ring-1 ring-emerald-500/40' : 'border-zinc-700 hover:border-zinc-500'
      } ${data.dim ? 'opacity-40' : ''}`}
    >
      <div className="flex items-center gap-2">
        {/* invisible handles so v13 can wire edges (card → card, left → right) */}
        <Handle type="target" position={Position.Left} isConnectable={true} className="!h-2 !w-2 !border-0 !bg-cyan-400 !opacity-0 group-hover:!opacity-100" />
        <Icon className="h-4 w-4 shrink-0" style={{ color: data.color }} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-[11px] font-medium text-zinc-100">{data.name}</span>
            {data.dot && <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: data.dot }} />}
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="shrink-0 text-[9px] uppercase tracking-wider text-zinc-500">{data.kind}</span>
            <span className="truncate text-[9px] text-zinc-500">{data.sub}</span>
          </div>
        </div>
        <Handle type="source" position={Position.Right} isConnectable={true} className="!h-2 !w-2 !border-0 !bg-cyan-400 !opacity-0 group-hover:!opacity-100" />
      </div>
    </div>
  )
}

function NsFrame({ data }: NodeProps<NsFrameNode>) {
  return (
    <div
      className="rounded-2xl border border-dashed border-zinc-700/70 bg-zinc-900/25"
      style={{ width: data.width, height: data.height }}
    >
      <div className="px-3 pt-2 font-mono text-[10px] uppercase tracking-widest text-zinc-500">
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
  const setEditing = useCluster((s) => s.setEditing)
  const [trafficRoute, setTrafficRoute] = useState<{ ingressId: string; serviceId: string; podId: string } | null>(null)
  const [trafficMessage, setTrafficMessage] = useState('')

  useEffect(() => {
    if (!trafficRoute) return
    const timer = window.setTimeout(() => setTrafficRoute(null), 2200)
    return () => window.clearTimeout(timer)
  }, [trafficRoute])

  const sendRequest = useCallback(() => {
    const state = useCluster.getState()
    const ingress = state.ingresses.find((item) => activeNamespace === 'all' || item.namespace === activeNamespace)
    if (!ingress) {
      setTrafficMessage('No Ingress found in the selected namespace')
      return
    }
    const service = state.services.find((item) => item.namespace === ingress.namespace && item.name === ingress.serviceName)
    if (!service) {
      setTrafficMessage(`Ingress ${ingress.name} has no matching Service backend`)
      return
    }
    const pod = state.pods.find((item) =>
      item.namespace === service.namespace &&
      item.phase === 'Running' &&
      selectorMatches(service.selector as Labels, item.labels)
    )
    if (!pod) {
      setTrafficMessage(`Request rejected: Service ${service.name} has no ready endpoints`)
      return
    }
    setTrafficMessage(`200 OK · ${ingress.host}${ingress.path} → ${service.name} → ${pod.name}`)
    setTrafficRoute({ ingressId: ingress.id, serviceId: service.id, podId: pod.id })
  }, [activeNamespace])
  
  const onConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return
    const state = useCluster.getState()
    const source = connection.source
    const target = connection.target
    const id = (nodeId: string, kind: string) => nodeId.startsWith(`t-${kind}-`) ? nodeId.slice(kind.length + 3) : null
    const svcId = id(source, 'service')
    const depId = id(target, 'deployment')
    if (svcId && depId) {
      const service = state.services.find((item) => item.id === svcId)
      const deployment = state.deployments.find((item) => item.id === depId)
      if (!service || !deployment || service.namespace !== deployment.namespace) return
      state.updateResource('service', service.id, { selector: { ...deployment.selector } })
      return
    }
    const ingressId = id(source, 'ingress')
    const targetServiceId = id(target, 'service')
    if (ingressId && targetServiceId) {
      const ingress = state.ingresses.find((item) => item.id === ingressId)
      const service = state.services.find((item) => item.id === targetServiceId)
      if (!ingress || !service || ingress.namespace !== service.namespace) return
      state.updateResource('ingress', ingress.id, { serviceName: service.name })
      return
    }
    const configMapId = id(source, 'configmap')
    const secretId = id(source, 'secret')
    const podId = id(target, 'pod')
    if (podId && configMapId) {
      const configMap = state.configMaps.find((item) => item.id === configMapId)
      const pod = state.pods.find((item) => item.id === podId)
      if (!configMap || !pod || configMap.namespace !== pod.namespace) return
      state.updateResource('pod', pod.id, { envConfigMap: configMap.name })
      return
    }
    if (podId && secretId) {
      const secret = state.secrets.find((item) => item.id === secretId)
      const pod = state.pods.find((item) => item.id === podId)
      if (!secret || !pod || secret.namespace !== pod.namespace) return
      state.updateResource('pod', pod.id, { envSecret: secret.name })
      return
    }
    const pvcId = id(source, 'pvc')
    const statefulSetId = id(target, 'statefulset')
    if (pvcId && statefulSetId) {
      const pvc = state.pvcs.find((item) => item.id === pvcId)
      const statefulSet = state.statefulSets.find((item) => item.id === statefulSetId)
      if (!pvc || !statefulSet || pvc.namespace !== statefulSet.namespace) return
      state.updateResource('statefulset', statefulSet.id, { storageGi: pvc.sizeGi, claimName: pvc.name })
    }
  }, [])

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

    const ownStyle = { stroke: '#71717a', strokeWidth: 1.5 }
    const faded = { stroke: '#52525b', strokeWidth: 1, strokeDasharray: '4 4' }
    const svcStyle = { stroke: '#38bdf8', strokeWidth: 2 }
    const cmStyle = { stroke: '#fbbf24', strokeWidth: 1.5, strokeDasharray: '6 3' }
    const secStyle = { stroke: '#e879f9', strokeWidth: 1.5, strokeDasharray: '6 3' }
    const cjStyle = { stroke: '#a78bfa', strokeWidth: 1.5 }
    const pvcStyle = { stroke: '#f472b6', strokeWidth: 1.5, strokeDasharray: '2 4' }
    const ingStyle = { stroke: '#fb7185', strokeWidth: 2 }

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
          color: '#fb7185',
          dot: null as string | null,
          dim: false,
        })),
        ...nsSvcs.map((v) => ({
          selectionId: sid('service', v.id),
          kind: 'service',
          name: v.name,
          sub: `${v.type} · ${v.clusterIP}`,
          icon: Network as LucideIcon,
          color: '#38bdf8',
          dot: null as string | null,
          dim: false,
        })),
        ...nsCms.map((c) => ({
          selectionId: sid('configmap', c.id),
          kind: 'configmap',
          name: c.name,
          sub: `${Object.keys(c.data).length} keys`,
          icon: FileJson as LucideIcon,
          color: '#fbbf24',
          dot: null as string | null,
          dim: false,
        })),
        ...nsPvcs.map((c) => ({
          selectionId: sid('pvc', c.id),
          kind: 'pvc',
          name: c.name,
          sub: `${c.sizeGi}Gi · ${c.status}`,
          icon: HardDrive as LucideIcon,
          color: '#f472b6',
          dot: c.status === 'Bound' ? '#f472b6' : '#fbbf24',
          dim: false,
        })),
        ...nsSecs.map((c) => ({
          selectionId: sid('secret', c.id),
          kind: 'secret',
          name: c.name,
          sub: `${Object.keys(c.data).length} keys`,
          icon: KeyRound as LucideIcon,
          color: '#e879f9',
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
          color: '#34d399',
          dot: null as string | null,
          dim: false,
        })),
        ...nsDs.map((d) => ({
          selectionId: sid('daemonset', d.id),
          kind: 'daemonset',
          name: d.name,
          sub: `every node · ${d.image}`,
          icon: Server as LucideIcon,
          color: '#fb923c',
          dot: null as string | null,
          dim: false,
        })),
        ...nsSts.map((d) => ({
          selectionId: sid('statefulset', d.id),
          kind: 'statefulset',
          name: d.name,
          sub: `${d.replicas} replicas · ${d.image}`,
          icon: Boxes as LucideIcon,
          color: '#60a5fa',
          dot: null as string | null,
          dim: false,
        })),
        ...nsCjs.map((c) => ({
          selectionId: sid('cronjob', c.id),
          kind: 'cronjob',
          name: c.name,
          sub: `every ${c.schedule.replace('*/', '')}s · ${c.completions} done`,
          icon: Clock as LucideIcon,
          color: '#a78bfa',
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
          color: '#2dd4bf',
          dot: null as string | null,
          dim: r.superseded,
        })),
        ...nsJobs.map((j) => ({
          selectionId: sid('job', j.id),
          kind: 'job',
          name: j.name,
          sub: j.status === 'Complete' ? 'complete' : 'running',
          icon: Briefcase as LucideIcon,
          color: '#22d3ee',
          dot: j.status === 'Complete' ? '#2dd4bf' : '#38bdf8',
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
          color: '#a1a1aa',
          dot: PHASE_DOT[p.phase] ?? '#a1a1aa',
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
            data: { selectionId: 'traffic:client', kind: 'client', name: 'external-client', sub: 'HTTP request', icon: Globe as LucideIcon, color: '#22d3ee', dot: '#22d3ee', dim: false },
            selectable: false,
            draggable: false,
          } as TopoCardNode)
          edges.push({ id: 'e-client-ingress', source: 't-traffic-client', target: nid('ingress', trafficRoute.ingressId), style: { stroke: '#22d3ee', strokeWidth: 3 } })
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
      // service → pods (selector match — like real endpoints)
      for (const v of nsSvcs) {
        for (const p of nsPods) {
          if (selectorMatches(v.selector as Labels, p.labels) && p.phase === 'Running') {
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
      // configmap / secret → pod (env from)
      for (const c of nsCms) {
        for (const p of nsPods.filter((p) => p.envConfigMap === c.name)) {
          edges.push({ id: `e-cm-${c.id}-${p.id}`, source: nid('configmap', c.id), target: nid('pod', p.id), style: cmStyle })
        }
      }
      for (const c of nsSecs) {
        for (const p of nsPods.filter((p) => p.envSecret === c.name)) {
          edges.push({ id: `e-sec-${c.id}-${p.id}`, source: nid('secret', c.id), target: nid('pod', p.id), style: secStyle })
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
    const flowEdges: Edge[] = edges.map((edge) => {
      const stroke = activeTrafficEdges?.has(edge.id) ? '#22d3ee' : (edge.style?.stroke as string | undefined) ?? '#71717a'
      return {
        ...edge,
        type: 'smoothstep',
        animated: activeTrafficEdges ? activeTrafficEdges.has(edge.id) : running,
        markerEnd: { type: MarkerType.ArrowClosed, color: stroke, width: 14, height: 14 },
        style: { ...edge.style, stroke, strokeWidth: activeTrafficEdges?.has(edge.id) ? 3 : Math.max(2, Number(edge.style?.strokeWidth ?? 1.5)) },
      }
    })

    return { flowNodes: [...frames, ...cards], flowEdges, total: totalRes }
  }, [pods, deployments, replicaSets, daemonSets, statefulSets, services, configMaps, secrets, cronJobs, jobs, pvcs, ingresses, namespaces, activeNamespace, running, trafficRoute])

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
        onPaneClick={() => select(null)}
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
          { style: '#38bdf8', dash: false, label: 'selects pods (service)' },
          { style: '#fbbf24', dash: true, label: 'env from ConfigMap' },
          { style: '#e879f9', dash: true, label: 'env from Secret' },
          { style: '#a78bfa', dash: false, label: 'triggers (cronjob)' },
          { style: '#f472b6', dash: true, label: 'mounts PVC (statefulset)' },
          { style: '#fb7185', dash: false, label: 'routes to service (ingress)' },
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
