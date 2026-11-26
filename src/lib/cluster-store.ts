'use client'

import { create } from 'zustand'
import { createSeededRng } from '../../engine/rng'
import { advanceCanvasRuntime, resetCanvasRuntime, type CanvasControllers } from '../../engine/canvas-runtime'

export type PodPhase =
  | 'Pending'
  | 'ContainerCreating'
  | 'Running'
  | 'CrashLoopBackOff'
  | 'Terminating'
  | 'Succeeded'

export type Labels = Record<string, string>

export type ResourceKind =
  | 'pod' | 'deployment' | 'replicaset' | 'daemonset' | 'statefulset'
  | 'service' | 'configmap' | 'secret' | 'cronjob' | 'job' | 'node' | 'namespace'
  | 'pvc' | 'ingress'

export interface K8sNode {
  id: string
  name: string
  role: 'control-plane' | 'worker'
  cpuCapacity: number // millicores
  memCapacity: number // Mi
  position: { x: number; y: number }
}

export interface Namespace {
  id: string
  name: string
  labels: Labels
}

export interface Pod {
  id: string
  name: string
  namespace: string
  labels: Labels
  ownerId: string | null // rs/ds/sts/job id
  ownerKind: 'replicaset' | 'daemonset' | 'statefulset' | 'job' | 'deployment' | 'none'
  phase: PodPhase
  image: string
  cpuRequest: number
  memRequest: number
  restarts: number
  crashRate: number
  phaseTicks: number
  ageTicks: number
  requiredNode: string | null // daemonset pods pin to a node
  completionTicks: number | null // job pods: ticks until Succeeded
  envConfigMap: string | null
  envSecret: string | null
  ports: number[]
  logs: string[]
  nodeId: string | null
  mountedPvc: string | null // statefulset volumeClaimTemplate PVC name
}

export interface ReplicaSet {
  id: string
  name: string
  namespace: string
  labels: Labels
  selector: Labels
  replicas: number
  image: string
  cpuRequest: number
  memRequest: number
  crashRate: number
  revision: number
  parentDeployment: string | null
  superseded: boolean
}

export interface Deployment {
  id: string
  name: string
  namespace: string
  labels: Labels
  selector: Labels
  replicas: number
  image: string
  cpuRequest: number
  memRequest: number
  crashRate: number
  revision: number
}

export interface DaemonSet {
  id: string
  name: string
  namespace: string
  labels: Labels
  selector: Labels
  image: string
  cpuRequest: number
  memRequest: number
  crashRate: number
}

export interface StatefulSet {
  id: string
  name: string
  namespace: string
  labels: Labels
  serviceName: string
  replicas: number
  image: string
  cpuRequest: number
  memRequest: number
  crashRate: number
  storageGi: number // volumeClaimTemplate size; 0 = no claims
  claimName?: string // explicitly connected PVC, when set
}

export type ServiceType = 'ClusterIP' | 'NodePort' | 'LoadBalancer'

export interface Service {
  id: string
  name: string
  namespace: string
  type: ServiceType
  selector: Labels
  port: number
  targetPort: number
  protocol: 'TCP' | 'UDP'
  clusterIP: string
  nodePort: number | null
  externalIP: string | null
  lbTicks: number // countdown until LB ip assigned
}

export interface ConfigMap {
  id: string
  name: string
  namespace: string
  data: Record<string, string>
}

export interface Secret {
  id: string
  name: string
  namespace: string
  data: Record<string, string>
}

export interface Pvc {
  id: string
  name: string
  namespace: string
  sizeGi: number
  storageClass: string
  status: 'Pending' | 'Bound'
  createdTick: number
}

export interface Ingress {
  id: string
  name: string
  namespace: string
  host: string
  path: string
  serviceName: string
}

export interface CronJob {
  id: string
  name: string
  namespace: string
  schedule: string // simplified: "*/N" every N sim-seconds, "* * * * *" = 60s
  image: string
  cpuRequest: number
  memRequest: number
  duration: number // job pod runtime in ticks
  lastRun: number
  active: number
  completions: number
}

export interface Job {
  id: string
  name: string
  namespace: string
  image: string
  duration: number
  status: 'Active' | 'Complete'
  cronjobOwner: string | null
  createdTick: number
  cpuRequest?: number
  memRequest?: number
}

export interface K8sEvent {
  id: string
  time: string
  type: 'Normal' | 'Warning'
  reason: string
  message: string
  object: string
}

export type SelectionId = string | null // 'kind:id'

let idRng = createSeededRng(0x5eed1234)
const rand = (n: number) => {
  let token = ''
  while (token.length < n) token += Math.floor(idRng.next() * 36).toString(36)
  return token.slice(0, n)
}
const simTime = (t: number) => `00:${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`

let nextId = 1
const uid = (p: string) => `${p}-${nextId++}`

export function selectorMatches(selector: Labels, labels: Labels): boolean {
  return Object.entries(selector).every(([k, v]) => labels[k] === v)
}


// PodN kept as alias for readability
export type PodN = Pod

export interface ClusterState {
  nodes: K8sNode[]
  pods: Pod[]
  deployments: Deployment[]
  replicaSets: ReplicaSet[]
  daemonSets: DaemonSet[]
  statefulSets: StatefulSet[]
  services: Service[]
  configMaps: ConfigMap[]
  secrets: Secret[]
  cronJobs: CronJob[]
  jobs: Job[]
  pvcs: Pvc[]
  ingresses: Ingress[]
  namespaces: Namespace[]
  activeNamespace: string // 'all' or a namespace name
  internalsNode: SelectionId // node whose internals dialog is open
  events: K8sEvent[]
  tickCount: number
  running: boolean
  speed: number
  chaos: boolean
  selected: SelectionId
  editing: SelectionId // resource being edited in dialog

  tick: () => void
  setRunning: (v: boolean) => void
  setSpeed: (v: number) => void
  setChaos: (v: boolean) => void
  select: (id: SelectionId) => void
  setEditing: (id: SelectionId) => void
  setNamespace: (ns: string) => void
  setInternalsNode: (id: SelectionId) => void

  addNode: () => void
  removeNode: (id: string) => void
  moveNode: (id: string, position: { x: number; y: number }) => void

  // creation from palette drop
  createResource: (payload: DropPayload) => void

  // updates (edit dialog)
  updateResource: (kind: ResourceKind, id: string, patch: Record<string, unknown>) => void
  removeResource: (kind: ResourceKind, id: string) => void

  // pod actions
  crashPod: (id: string) => void
  restartPod: (id: string) => void

  // scaling shortcuts
  scaleDeployment: (id: string, replicas: number) => void
  scaleReplicaSet: (id: string, replicas: number) => void
  scaleStatefulSet: (id: string, replicas: number) => void

  reset: () => void
}

export interface DropPayload {
  kind: ResourceKind
  [k: string]: unknown
}

function logEvent(state: Pick<ClusterState, 'events' | 'tickCount'>, type: 'Normal' | 'Warning', reason: string, message: string, object: string) {
  state.events.unshift({ id: uid('ev'), time: simTime(state.tickCount), type, reason, message, object })
  if (state.events.length > 100) state.events.length = 100
}

export function nodeUsage(pods: Pod[], nodeId: string) {
  return pods
    .filter((p) => p.requiredNode === nodeId || (p.requiredNode === null && p.nodeId === nodeId))
    .filter((p) => p.phase !== 'Terminating' && p.phase !== 'Succeeded')
    .reduce(
      (acc, p) => {
        acc.cpu += p.cpuRequest
        acc.mem += p.memRequest
        return acc
      },
      { cpu: 0, mem: 0 }
    )
}


function basePod(over: Partial<Pod>): Pod {
  return {
    id: uid('pod'),
    name: 'pod',
    namespace: 'default',
    labels: { app: 'x' },
    nodeId: null,
    ownerId: null,
    ownerKind: 'none',
    phase: 'Pending',
    image: 'nginx:latest',
    cpuRequest: 500,
    memRequest: 512,
    restarts: 0,
    crashRate: 0,
    phaseTicks: 0,
    ageTicks: 0,
    requiredNode: null,
    completionTicks: null,
    envConfigMap: null,
    envSecret: null,
    ports: [],
    logs: [],
    mountedPvc: null,
    ...over,
  }
}


export const useCluster = create<ClusterState>((set, get) => ({
  nodes: [
    { id: 'cp1', name: 'control-plane-1', role: 'control-plane', cpuCapacity: 4000, memCapacity: 8192, position: { x: 300, y: 0 } },
    { id: 'n1', name: 'worker-node-1', role: 'worker', cpuCapacity: 4000, memCapacity: 8192, position: { x: 0, y: 180 } },
    { id: 'n2', name: 'worker-node-2', role: 'worker', cpuCapacity: 4000, memCapacity: 8192, position: { x: 600, y: 180 } },
  ],
  pods: [],
  deployments: [],
  replicaSets: [],
  daemonSets: [],
  statefulSets: [],
  services: [],
  configMaps: [],
  secrets: [],
  cronJobs: [],
  jobs: [],
  pvcs: [],
  ingresses: [],
  namespaces: [{ id: 'ns-default', name: 'default', labels: { 'kubernetes.io/metadata.name': 'default' } }],
  activeNamespace: 'all',
  internalsNode: null,
  events: [],
  tickCount: 0,
  running: true,
  speed: 1,
  chaos: false,
  selected: null,
  editing: null,

  tick: () =>
    set((state) => {
      const s: ClusterState = {
        ...state,
        nodes: state.nodes.map((n) => ({ ...n })),
        pods: state.pods.map((p) => ({ ...p })),
        deployments: state.deployments.map((d) => ({ ...d })),
        replicaSets: state.replicaSets.map((r) => ({ ...r })),
        daemonSets: state.daemonSets.map((d) => ({ ...d })),
        statefulSets: state.statefulSets.map((d) => ({ ...d })),
        services: state.services.map((d) => ({ ...d })),
        configMaps: state.configMaps.map((d) => ({ ...d })),
        secrets: state.secrets.map((d) => ({ ...d })),
        cronJobs: state.cronJobs.map((d) => ({ ...d })),
        jobs: state.jobs.map((d) => ({ ...d })),
        pvcs: state.pvcs.map((d) => ({ ...d })),
        ingresses: state.ingresses.map((d) => ({ ...d })),
        events: [...state.events],
      }
      s.tickCount = state.tickCount + 1
      const t = s.tickCount
      // Re-seeding per tick makes crash injection reproducible for the same tick.
      const tickRng = createSeededRng(0x5eed1234 ^ t)
      // ---- persistent engine owns scheduling, kubelet lifecycle and workload controllers ----
      const runtime = advanceCanvasRuntime(s.nodes, s.pods, t, tickRng, {
        deployments: s.deployments,
        replicaSets: s.replicaSets,
        daemonSets: s.daemonSets,
        statefulSets: s.statefulSets,
        cronJobs: s.cronJobs,
        jobs: s.jobs,
        pvcs: s.pvcs,
        services: s.services,
        chaos: s.chaos,
      } satisfies CanvasControllers)
      s.pods = runtime.pods
      if (runtime.controllers) {
        s.deployments = runtime.controllers.deployments ?? s.deployments
        s.replicaSets = runtime.controllers.replicaSets ?? s.replicaSets
        s.daemonSets = runtime.controllers.daemonSets
        s.statefulSets = runtime.controllers.statefulSets
        s.cronJobs = runtime.controllers.cronJobs
        s.jobs = runtime.controllers.jobs
        s.pvcs = runtime.controllers.pvcs
        s.services = runtime.controllers.services
      }
      for (const event of runtime.events) {
        s.events.unshift({ id: event.id, time: simTime(t), type: event.type, reason: event.reason, message: event.message, object: event.object })
      }
      if (s.events.length > 100) s.events.length = 100

      // ---- cleanup finished pods ----
      s.pods = s.pods.filter((p) => {
        if (p.phase === 'Terminating' && p.phaseTicks >= 2) return false
        if (p.phase === 'Succeeded' && p.phaseTicks >= 4) return false
        return true
      })

      // Deployment, ReplicaSet and workload controllers reconcile in the engine registry.

      return s
    }),

  setRunning: (v) => set({ running: v }),
  setSpeed: (v) => set({ speed: v }),
  setChaos: (v) => set({ chaos: v }),
  select: (id) => set({ selected: id }),
  setEditing: (id) => set({ editing: id }),
  setNamespace: (ns) => set({ activeNamespace: ns }),
  setInternalsNode: (id) => set({ internalsNode: id }),

  addNode: () =>
    set((state) => {
      const workers = state.nodes.filter((n) => n.role === 'worker')
      const node: K8sNode = {
        id: uid('node'),
        name: `worker-node-${workers.length + 1}`,
        role: 'worker',
        cpuCapacity: 4000,
        memCapacity: 8192,
        position: { x: (workers.length % 3) * 600, y: 180 + Math.floor(workers.length / 3) * 240 },
      }
      const events = [...state.events]
      const s = { ...state, nodes: [...state.nodes, node], events } as ClusterState
      logEvent(s, 'Normal', 'NodeAdded', `Node ${node.name} joined the cluster — DaemonSets will schedule on it`, node.name)
      return s
    }),

  removeNode: (id) =>
    set((state) => {
      const node = state.nodes.find((n) => n.id === id)
      if (!node || node.role === 'control-plane') return state
      const s = { ...state, nodes: state.nodes.filter((n) => n.id !== id), pods: state.pods.filter((p) => p.nodeId !== id && p.requiredNode !== id), events: [...state.events], selected: state.selected?.startsWith(`node:${id}`) ? null : state.selected } as ClusterState
      logEvent(s, 'Warning', 'NodeDeleted', `Node ${node.name} removed — evicted pods will be rescheduled by controllers`, node.name)
      return s
    }),

  moveNode: (id, position) =>
    set((state) => ({ nodes: state.nodes.map((n) => (n.id === id ? { ...n, position } : n)) })),

  createResource: (payload) =>
    set((state) => {
      const s = { ...state, events: [...state.events] } as ClusterState
      const kind = payload.kind
      const name = (payload.name as string) ?? 'res'
      switch (kind) {
        case 'pod':
          s.pods = [...state.pods, basePod({ name: `${name}-${rand(5)}-${rand(5)}`, namespace: (payload.namespace as string) ?? 'default', labels: (payload.labels as Labels) ?? { app: name }, image: (payload.image as string) ?? 'nginx:latest', cpuRequest: (payload.cpuRequest as number) ?? 500, memRequest: (payload.memRequest as number) ?? 512, crashRate: (payload.crashRate as number) ?? 0 }) as never]
          logEvent(s, 'Normal', 'Created', `Pod created: ${name} (ns/${(payload.namespace as string) ?? 'default'})`, name)
          break
        case 'deployment':
          s.deployments = [...state.deployments, { id: uid('dep'), name, namespace: (payload.namespace as string) ?? 'default', labels: (payload.labels as Labels) ?? { app: name }, selector: (payload.selector as Labels) ?? { app: name }, replicas: (payload.replicas as number) ?? 3, image: (payload.image as string) ?? 'nginx:latest', cpuRequest: (payload.cpuRequest as number) ?? 500, memRequest: (payload.memRequest as number) ?? 512, crashRate: (payload.crashRate as number) ?? 0, revision: 1 }]
          logEvent(s, 'Normal', 'ScalingReplicaSet', `Deployment ${name} created with ${payload.replicas ?? 3} replica(s)`, name)
          break
        case 'replicaset':
          s.replicaSets = [...state.replicaSets, { id: uid('rs'), name, namespace: (payload.namespace as string) ?? 'default', labels: (payload.labels as Labels) ?? { app: name }, selector: (payload.selector as Labels) ?? { app: name }, replicas: (payload.replicas as number) ?? 2, image: (payload.image as string) ?? 'nginx:latest', cpuRequest: (payload.cpuRequest as number) ?? 500, memRequest: (payload.memRequest as number) ?? 512, crashRate: (payload.crashRate as number) ?? 0, revision: 1, parentDeployment: null, superseded: false }]
          logEvent(s, 'Normal', 'SuccessfulCreate', `ReplicaSet ${name} created with ${payload.replicas ?? 2} replica(s)`, name)
          break
        case 'daemonset':
          s.daemonSets = [...state.daemonSets, { id: uid('ds'), name, namespace: (payload.namespace as string) ?? 'default', labels: (payload.labels as Labels) ?? { app: name }, selector: (payload.selector as Labels) ?? { app: name }, image: (payload.image as string) ?? 'fluentd:latest', cpuRequest: (payload.cpuRequest as number) ?? 100, memRequest: (payload.memRequest as number) ?? 128, crashRate: (payload.crashRate as number) ?? 0 }]
          logEvent(s, 'Normal', 'SuccessfulCreate', `DaemonSet ${name} created — one pod per node`, name)
          break
        case 'statefulset':
          s.statefulSets = [...state.statefulSets, { id: uid('sts'), name, namespace: (payload.namespace as string) ?? 'default', labels: (payload.labels as Labels) ?? { app: name }, serviceName: (payload.serviceName as string) ?? `${name}-headless`, replicas: (payload.replicas as number) ?? 3, image: (payload.image as string) ?? 'postgres:16', cpuRequest: (payload.cpuRequest as number) ?? 500, memRequest: (payload.memRequest as number) ?? 512, crashRate: (payload.crashRate as number) ?? 0, storageGi: (payload.storageGi as number) ?? 1 }]
          logEvent(s, 'Normal', 'SuccessfulCreate', `StatefulSet ${name} created with ${payload.replicas ?? 3} replica(s)${(payload.storageGi as number) ?? 1 > 0 ? `, volumeClaimTemplate ${(payload.storageGi as number) ?? 1}Gi each` : ''}`, name)
          break
        case 'service': {
          const type = (payload.serviceType as ServiceType) ?? 'ClusterIP'
          const svc: Service = { id: uid('svc'), name, namespace: (payload.namespace as string) ?? 'default', type, selector: (payload.selector as Labels) ?? { app: name }, port: (payload.port as number) ?? 80, targetPort: (payload.targetPort as number) ?? 8080, protocol: 'TCP', clusterIP: `10.96.${rand2(1, 200)}.${rand2(2, 250)}`, nodePort: type === 'ClusterIP' ? null : rand2(30000, 32767), externalIP: null, lbTicks: type === 'LoadBalancer' ? 5 : 0 }
          s.services = [...state.services, svc]
          logEvent(s, 'Normal', 'Created', `Service ${name} (${type}) created — clusterIP ${svc.clusterIP}${svc.nodePort ? `, nodePort ${svc.nodePort}` : ''}`, name)
          break
        }
        case 'configmap':
          s.configMaps = [...state.configMaps, { id: uid('cm'), name, namespace: (payload.namespace as string) ?? 'default', data: (payload.data as Record<string, string>) ?? { 'config.yaml': 'key: value' } }]
          logEvent(s, 'Normal', 'Created', `ConfigMap ${name} created (ns/${(payload.namespace as string) ?? 'default'})`, name)
          break
        case 'secret':
          s.secrets = [...state.secrets, { id: uid('sec'), name, namespace: (payload.namespace as string) ?? 'default', data: (payload.data as Record<string, string>) ?? { username: 'admin' } }]
          logEvent(s, 'Normal', 'Created', `Secret ${name} created (ns/${(payload.namespace as string) ?? 'default'})`, name)
          break
        case 'cronjob':
          s.cronJobs = [...state.cronJobs, { id: uid('cj'), name, namespace: (payload.namespace as string) ?? 'default', schedule: (payload.schedule as string) ?? '*/10', image: (payload.image as string) ?? 'busybox:1.36', cpuRequest: (payload.cpuRequest as number) ?? 100, memRequest: (payload.memRequest as number) ?? 128, duration: (payload.duration as number) ?? 5, lastRun: state.tickCount, active: 0, completions: 0 }]
          logEvent(s, 'Normal', 'Created', `CronJob ${name} created (schedule ${(payload.schedule as string) ?? '*/10'}s)`, name)
          break
        case 'job': {
          const job: Job = { id: uid('job'), name, namespace: (payload.namespace as string) ?? 'default', image: (payload.image as string) ?? 'busybox:1.36', duration: (payload.duration as number) ?? 6, status: 'Active', cronjobOwner: null, createdTick: state.tickCount }
          s.jobs = [...state.jobs, { ...job, cpuRequest: (payload.cpuRequest as number) ?? 100, memRequest: (payload.memRequest as number) ?? 128 }]
          logEvent(s, 'Normal', 'Created', `Job ${name} created — runs for ${job.duration}s sim-time`, name)
          break
        }
        case 'pvc': {
          const pvc: Pvc = { id: uid('pvc'), name, namespace: (payload.namespace as string) ?? 'default', sizeGi: (payload.sizeGi as number) ?? 1, storageClass: (payload.storageClass as string) ?? 'standard', status: 'Pending', createdTick: state.tickCount }
          s.pvcs = [...state.pvcs, pvc]
          logEvent(s, 'Normal', 'Created', `PersistentVolumeClaim ${name} (${pvc.sizeGi}Gi) created — waiting for a Volume to bind`, name)
          break
        }
        case 'ingress': {
          const ing: Ingress = { id: uid('ing'), name, namespace: (payload.namespace as string) ?? 'default', host: (payload.host as string) ?? `${name}.example.com`, path: (payload.path as string) ?? '/', serviceName: (payload.serviceName as string) ?? 'web-svc' }
          s.ingresses = [...state.ingresses, ing]
          logEvent(s, 'Normal', 'Created', `Ingress ${name} created — http://${ing.host}${ing.path} → service ${ing.serviceName}`, name)
          break
        }
        case 'namespace': {
          const nsName = (payload.name as string) ?? `ns-${rand(4)}`
          if (state.namespaces.some((n) => n.name === nsName)) {
            logEvent(s, 'Warning', 'AlreadyExists', `Namespace "${nsName}" already exists`, nsName)
            break
          }
          s.namespaces = [...state.namespaces, { id: uid('ns'), name: nsName, labels: (payload.labels as Labels) ?? {} }]
          logEvent(s, 'Normal', 'Created', `Namespace ${nsName} created — resources can now be isolated in it`, nsName)
          break
        }
        default:
          break
      }
      return s
    }),

  updateResource: (kind, id, patch) =>
    set((state) => {
      const s = { ...state, events: [...state.events] } as ClusterState
      const name = (patch.name as string) ?? ''
      switch (kind) {
        case 'deployment': {
          const dep = state.deployments.find((d) => d.id === id)
          if (!dep) return state
          const next = { ...dep, ...patch, labels: (patch.labels as Labels) ?? dep.labels, selector: (patch.selector as Labels) ?? dep.selector } as Deployment
          const specChanged = next.image !== dep.image || next.cpuRequest !== dep.cpuRequest || next.memRequest !== dep.memRequest
          if (specChanged) next.revision = dep.revision + 1
          s.deployments = state.deployments.map((d) => (d.id === id ? next : d))
          logEvent(s, 'Normal', specChanged ? 'RolloutStarted' : 'ScalingReplicaSet', specChanged ? `Deployment ${next.name}: image → ${next.image}, rolling out revision ${next.revision}` : `Deployment ${next.name} scaled to ${next.replicas}`, next.name)
          break
        }
        case 'replicaset':
          s.replicaSets = state.replicaSets.map((r) => (r.id === id ? ({ ...r, ...patch, labels: (patch.labels as Labels) ?? r.labels } as ReplicaSet) : r))
          logEvent(s, 'Normal', 'ScalingReplicaSet', `ReplicaSet ${name || id} updated`, name)
          break
        case 'daemonset': {
          const ds = state.daemonSets.find((d) => d.id === id)
          if (!ds) return state
          const next = { ...ds, ...patch, labels: (patch.labels as Labels) ?? ds.labels } as DaemonSet
          const specChanged = next.image !== ds.image
          s.daemonSets = state.daemonSets.map((d) => (d.id === id ? next : d))
          if (specChanged) {
            // recreate all pods
            s.pods = state.pods.filter((p) => p.ownerId !== id)
            logEvent(s, 'Normal', 'RollingUpdate', `DaemonSet ${next.name}: image → ${next.image}, restarting pods on every node`, next.name)
          }
          break
        }
        case 'statefulset': {
          const sts = state.statefulSets.find((d) => d.id === id)
          if (!sts) return state
          const next = { ...sts, ...patch } as StatefulSet
          const specChanged = next.image !== sts.image
          s.statefulSets = state.statefulSets.map((d) => (d.id === id ? next : d))
          if (specChanged) {
            s.pods = state.pods.filter((p) => p.ownerId !== id)
            logEvent(s, 'Normal', 'RollingUpdate', `StatefulSet ${next.name}: image → ${next.image}, recreating pods in order`, next.name)
          } else {
            logEvent(s, 'Normal', 'ScalingStatefulSet', `StatefulSet ${next.name} scaled to ${next.replicas} — ${next.replicas > sts.replicas ? 'creating' : 'removing'} ordinal pods`, next.name)
          }
          break
        }
        case 'service': {
          const svc = state.services.find((v) => v.id === id)
          if (!svc) return state
          const next = { ...svc, ...patch, selector: (patch.selector as Labels) ?? svc.selector } as Service
          if (next.type !== svc.type) {
            next.nodePort = next.type === 'ClusterIP' ? null : rand2(30000, 32767)
            next.externalIP = null
            next.lbTicks = next.type === 'LoadBalancer' ? 5 : 0
          }
          s.services = state.services.map((v) => (v.id === id ? next : v))
          logEvent(s, 'Normal', 'Updated', `Service ${next.name} updated (${next.type}, selector ${JSON.stringify(next.selector)})`, next.name)
          break
        }
        case 'configmap':
          s.configMaps = state.configMaps.map((c) => (c.id === id ? ({ ...c, ...patch, data: (patch.data as Record<string, string>) ?? c.data } as ConfigMap) : c))
          logEvent(s, 'Normal', 'Updated', `ConfigMap ${name || id} updated`, name)
          break
        case 'secret':
          s.secrets = state.secrets.map((c) => (c.id === id ? ({ ...c, ...patch, data: (patch.data as Record<string, string>) ?? c.data } as Secret) : c))
          logEvent(s, 'Normal', 'Updated', `Secret ${name || id} updated`, name)
          break
        case 'cronjob':
          s.cronJobs = state.cronJobs.map((c) => (c.id === id ? ({ ...c, ...patch } as CronJob) : c))
          logEvent(s, 'Normal', 'Updated', `CronJob ${name || id} updated (schedule ${(patch.schedule as string) ?? ''})`, name)
          break
        case 'pvc':
          s.pvcs = state.pvcs.map((c) => (c.id === id ? ({ ...c, ...patch } as Pvc) : c))
          logEvent(s, 'Normal', 'Updated', `PersistentVolumeClaim ${name || id} updated`, name)
          break
        case 'ingress':
          s.ingresses = state.ingresses.map((c) => (c.id === id ? ({ ...c, ...patch } as Ingress) : c))
          logEvent(s, 'Normal', 'Updated', `Ingress ${name || id} updated — ${(patch.host as string) ?? ''}${(patch.path as string) ?? ''} → ${(patch.serviceName as string) ?? ''}`, name)
          break
        case 'job':
          s.jobs = state.jobs.map((j) => (j.id === id ? ({ ...j, ...patch } as Job) : j))
          break
        case 'pod': {
          const pod = state.pods.find((p) => p.id === id)
          if (!pod) return state
          s.pods = state.pods.map((p) => (p.id === id ? ({ ...p, ...patch, labels: (patch.labels as Labels) ?? p.labels } as typeof pod) : p))
          const next = { ...pod, ...patch } as typeof pod
          logEvent(s, 'Normal', 'Updated', `Pod ${next.name} edited — env: ${next.envConfigMap ? `ConfigMap ${next.envConfigMap}` : 'none'}${next.envSecret ? `, Secret ${next.envSecret}` : ''}`, next.name)
          break
        }
        case 'namespace': {
          const ns = state.namespaces.find((n) => n.id === id)
          if (!ns) return state
          const nextNs = { ...ns, ...patch, labels: (patch.labels as Labels) ?? ns.labels } as Namespace
          s.namespaces = state.namespaces.map((n) => (n.id === id ? nextNs : n))
          logEvent(s, 'Normal', 'Updated', `Namespace ${nextNs.name} updated`, nextNs.name)
          break
        }
        default:
          break
      }
      return s
    }),

  removeResource: (kind, id) =>
    set((state) => {
      const s = { ...state, events: [...state.events] } as ClusterState
      const drop = (pred: (p: typeof state.pods[number]) => boolean) => {
        for (const p of state.pods.filter(pred)) {
          if (p.phase !== 'Terminating') {
            const pod = s.pods.find((x) => x.id === p.id)
            if (pod) {
              pod.phase = 'Terminating'
              pod.phaseTicks = 0
            }
          }
        }
        // hard drop if already terminating or succeeded
        s.pods = s.pods.filter((p) => !pred(p) || (p.phase !== 'Terminating' && p.phase !== 'Succeeded'))
      }
      switch (kind) {
        case 'pod':
          drop((p) => p.id === id)
          logEvent(s, 'Normal', 'Killing', `Deleting pod ${id}`, id)
          break
        case 'deployment':
          s.deployments = state.deployments.filter((d) => d.id !== id)
          s.replicaSets = state.replicaSets.filter((r) => r.parentDeployment !== id)
          drop((p) => state.replicaSets.filter((r) => r.parentDeployment === id).some((r) => p.ownerId === r.id))
          logEvent(s, 'Normal', 'Deleting', `Deployment deleted — cascading to ReplicaSets and pods`, id)
          break
        case 'replicaset':
          s.replicaSets = state.replicaSets.filter((r) => r.id !== id)
          drop((p) => p.ownerId === id)
          logEvent(s, 'Normal', 'Deleting', `ReplicaSet deleted — pods terminating`, id)
          break
        case 'daemonset':
          s.daemonSets = state.daemonSets.filter((d) => d.id !== id)
          drop((p) => p.ownerId === id)
          logEvent(s, 'Normal', 'Deleting', `DaemonSet deleted — pods terminating`, id)
          break
        case 'statefulset':
          s.statefulSets = state.statefulSets.filter((d) => d.id !== id)
          drop((p) => p.ownerId === id)
          logEvent(s, 'Normal', 'Deleting', `StatefulSet deleted`, id)
          break
        case 'service':
          s.services = state.services.filter((v) => v.id !== id)
          logEvent(s, 'Normal', 'Deleting', `Service deleted`, id)
          break
        case 'configmap':
          s.configMaps = state.configMaps.filter((c) => c.id !== id)
          logEvent(s, 'Normal', 'Deleting', `ConfigMap deleted`, id)
          break
        case 'secret':
          s.secrets = state.secrets.filter((c) => c.id !== id)
          logEvent(s, 'Normal', 'Deleting', `Secret deleted`, id)
          break
        case 'cronjob':
          s.cronJobs = state.cronJobs.filter((c) => c.id !== id)
          logEvent(s, 'Normal', 'Deleting', `CronJob deleted`, id)
          break
        case 'job':
          s.jobs = state.jobs.filter((j) => j.id !== id)
          drop((p) => p.ownerId === id)
          logEvent(s, 'Normal', 'Deleting', `Job deleted`, id)
          break
        case 'pvc':
          s.pvcs = state.pvcs.filter((c) => c.id !== id)
          logEvent(s, 'Normal', 'Deleting', `PersistentVolumeClaim deleted`, id)
          break
        case 'ingress':
          s.ingresses = state.ingresses.filter((c) => c.id !== id)
          logEvent(s, 'Normal', 'Deleting', `Ingress deleted`, id)
          break
        case 'namespace': {
          const ns = state.namespaces.find((n) => n.id === id)
          if (!ns) return state
          if (ns.name === 'default') {
            logEvent(s, 'Warning', 'Forbidden', `Namespace "default" cannot be deleted (system namespace)`, ns.name)
            return state
          }
          // cascade: delete every resource inside the namespace (like kubectl delete ns)
          s.namespaces = state.namespaces.filter((n) => n.id !== id)
          s.deployments = state.deployments.filter((d) => d.namespace !== ns.name)
          s.replicaSets = state.replicaSets.filter((r) => r.namespace !== ns.name)
          s.daemonSets = state.daemonSets.filter((d) => d.namespace !== ns.name)
          s.statefulSets = state.statefulSets.filter((d) => d.namespace !== ns.name)
          s.services = state.services.filter((v) => v.namespace !== ns.name)
          s.configMaps = state.configMaps.filter((c) => c.namespace !== ns.name)
          s.secrets = state.secrets.filter((c) => c.namespace !== ns.name)
          s.cronJobs = state.cronJobs.filter((c) => c.namespace !== ns.name)
          s.jobs = state.jobs.filter((j) => j.namespace !== ns.name)
          s.pvcs = state.pvcs.filter((c) => c.namespace !== ns.name)
          s.ingresses = state.ingresses.filter((c) => c.namespace !== ns.name)
          drop((p) => p.namespace === ns.name)
          if (state.activeNamespace === ns.name) s.activeNamespace = 'all'
          logEvent(s, 'Warning', 'NamespaceTerminating', `Namespace ${ns.name} deleted — all resources inside it were terminated too`, ns.name)
          break
        }
        default:
          break
      }
      if (state.selected && state.selected.startsWith(`${kind}:`)) s.selected = null
      return s
    }),

  crashPod: (id) =>
    set((state) => {
      const pod = state.pods.find((p) => p.id === id)
      if (!pod || pod.phase !== 'Running') return state
      const s = { ...state, events: [...state.events], pods: state.pods.map((p) => (p.id === id ? { ...p, phase: 'CrashLoopBackOff' as PodPhase, phaseTicks: 0, restarts: p.restarts + 1 } : p)) } as ClusterState
      logEvent(s, 'Warning', 'BackOff', `Back-off restarting failed container in pod ${pod.name} (restart #${pod.restarts + 1})`, pod.name)
      return s
    }),

  restartPod: (id) =>
    set((state) => {
      const s = { ...state, events: [...state.events], pods: state.pods.map((p) => (p.id === id ? { ...p, phase: 'ContainerCreating' as PodPhase, phaseTicks: 0 } : p)) } as ClusterState
      const pod = state.pods.find((p) => p.id === id)
      if (pod) logEvent(s, 'Normal', 'Started', `Manual restart of pod ${pod.name}`, pod.name)
      return s
    }),

  scaleDeployment: (id, replicas) =>
    set((state) => {
      const dep = state.deployments.find((d) => d.id === id)
      if (!dep) return state
      const s = { ...state, events: [...state.events], deployments: state.deployments.map((d) => (d.id === id ? { ...d, replicas: Math.max(0, replicas) } : d)) } as ClusterState
      logEvent(s, 'Normal', 'ScalingReplicaSet', `Scaled deployment ${dep.name} from ${dep.replicas} to ${Math.max(0, replicas)}`, dep.name)
      return s
    }),

  scaleReplicaSet: (id, replicas) =>
    set((state) => {
      const rs = state.replicaSets.find((r) => r.id === id)
      if (!rs) return state
      const s = { ...state, events: [...state.events], replicaSets: state.replicaSets.map((r) => (r.id === id ? { ...r, replicas: Math.max(0, replicas) } : r)) } as ClusterState
      logEvent(s, 'Normal', 'ScalingReplicaSet', `Scaled ReplicaSet ${rs.name} to ${Math.max(0, replicas)}`, rs.name)
      return s
    }),

  scaleStatefulSet: (id, replicas) =>
    set((state) => {
      const sts = state.statefulSets.find((d) => d.id === id)
      if (!sts) return state
      const s = { ...state, events: [...state.events], statefulSets: state.statefulSets.map((d) => (d.id === id ? { ...d, replicas: Math.max(0, replicas) } : d)) } as ClusterState
      logEvent(s, 'Normal', 'ScalingStatefulSet', `Scaled StatefulSet ${sts.name} to ${Math.max(0, replicas)} — ${Math.max(0, replicas) > sts.replicas ? 'adding' : 'removing'} ordinal pods`, sts.name)
      return s
    }),

  reset: () => {
    resetCanvasRuntime()
    nextId = 1
    idRng = createSeededRng(0x5eed1234)
    set({
      nodes: [
        { id: 'cp1', name: 'control-plane-1', role: 'control-plane', cpuCapacity: 4000, memCapacity: 8192, position: { x: 300, y: 0 } },
        { id: 'n1', name: 'worker-node-1', role: 'worker', cpuCapacity: 4000, memCapacity: 8192, position: { x: 0, y: 180 } },
        { id: 'n2', name: 'worker-node-2', role: 'worker', cpuCapacity: 4000, memCapacity: 8192, position: { x: 600, y: 180 } },
      ],
      pods: [],
      deployments: [],
      replicaSets: [],
      daemonSets: [],
      statefulSets: [],
      services: [],
      configMaps: [],
      secrets: [],
      cronJobs: [],
      jobs: [],
      pvcs: [],
      ingresses: [],
      namespaces: [{ id: 'ns-default', name: 'default', labels: { 'kubernetes.io/metadata.name': 'default' } }],
      activeNamespace: 'all',
      internalsNode: null,
      events: [],
      tickCount: 0,
      selected: null,
      editing: null,
    })
  },
}))

function rand2(min: number, max: number): number {
  return Math.floor(idRng.next() * (max - min + 1)) + min
}

// endpoints helper for services (used by UI)
export function serviceEndpoints(pods: (Pod & { nodeId: string | null })[], svc: Service): (Pod & { nodeId: string | null })[] {
  return pods.filter((p) => selectorMatches(svc.selector, p.labels) && p.phase === 'Running')
}

