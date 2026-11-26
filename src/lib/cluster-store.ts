'use client'

import { create } from 'zustand'

export type PodPhase =
  | 'Pending'
  | 'ContainerCreating'
  | 'Running'
  | 'CrashLoopBackOff'
  | 'Terminating'

export interface K8sNode {
  id: string
  name: string
  role: 'control-plane' | 'worker'
  cpuCapacity: number // millicores
  memCapacity: number // Mi
  position: { x: number; y: number }
}

export interface Pod {
  id: string
  name: string
  nodeId: string | null
  phase: PodPhase
  image: string
  cpuRequest: number
  memRequest: number
  restarts: number
  crashRate: number // probability of crash per tick while Running
  phaseTicks: number
  backoffTicks: number
  ageTicks: number
  deploymentId?: string
  logs: string[]
}

export interface Deployment {
  id: string
  name: string
  replicas: number
  image: string
  cpuRequest: number
  memRequest: number
}

export interface K8sEvent {
  id: string
  time: string
  type: 'Normal' | 'Warning'
  reason: string
  message: string
  object: string
}

export type SelectionId = string | null // 'node:<id>' | 'pod:<id>' | 'deployment:<id>'

const rand = (n: number) => Math.random().toString(36).slice(2, 2 + n)
const simTime = (t: number) => `00:${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`

let nextId = 1
const uid = (p: string) => `${p}-${nextId++}`

interface ClusterState {
  nodes: K8sNode[]
  pods: Pod[]
  deployments: Deployment[]
  events: K8sEvent[]
  tickCount: number
  running: boolean
  speed: number
  chaos: boolean
  selected: SelectionId
  // actions
  tick: () => void
  setRunning: (v: boolean) => void
  setSpeed: (v: number) => void
  setChaos: (v: boolean) => void
  select: (id: SelectionId) => void
  addNode: () => void
  removeNode: (id: string) => void
  moveNode: (id: string, position: { x: number; y: number }) => void
  addPod: (spec: Partial<Pod>, targetNodeId?: string | null) => void
  removePod: (id: string) => void
  crashPod: (id: string) => void
  restartPod: (id: string) => void
  addDeployment: (d: Omit<Deployment, 'id'>) => void
  scaleDeployment: (id: string, replicas: number) => void
  removeDeployment: (id: string) => void
  reset: () => void
}

function logEvent(state: ClusterState, type: 'Normal' | 'Warning', reason: string, message: string, object: string) {
  state.events.unshift({
    id: uid('ev'),
    time: simTime(state.tickCount),
    type,
    reason,
    message,
    object,
  })
  if (state.events.length > 80) state.events.length = 80
}

function podLog(pod: Pod, line: string) {
  pod.logs.push(`[${simTime(0)}] ${line}`.replace('[00:00:00]', `[${simTime(pod.ageTicks)}]`))
  if (pod.logs.length > 25) pod.logs.splice(0, pod.logs.length - 25)
}

function usageFor(pods: Pod[], nodeId: string) {
  return pods
    .filter((p) => p.nodeId === nodeId && p.phase !== 'Terminating')
    .reduce(
      (acc, p) => {
        acc.cpu += p.cpuRequest
        acc.mem += p.memRequest
        return acc
      },
      { cpu: 0, mem: 0 }
    )
}

export const useCluster = create<ClusterState>((set, get) => ({
  nodes: [
    { id: 'cp1', name: 'control-plane-1', role: 'control-plane', cpuCapacity: 4000, memCapacity: 8192, position: { x: 300, y: 0 } },
    { id: 'n1', name: 'worker-node-1', role: 'worker', cpuCapacity: 4000, memCapacity: 8192, position: { x: 0, y: 180 } },
    { id: 'n2', name: 'worker-node-2', role: 'worker', cpuCapacity: 4000, memCapacity: 8192, position: { x: 600, y: 180 } },
  ],
  pods: [],
  deployments: [],
  events: [],
  tickCount: 0,
  running: true,
  speed: 1,
  chaos: false,
  selected: null,

  tick: () =>
    set((state) => {
      const s = { ...state, pods: state.pods.map((p) => ({ ...p })), nodes: state.nodes.map((n) => ({ ...n })), deployments: state.deployments.map((d) => ({ ...d })) } as ClusterState
      s.tickCount = state.tickCount + 1
      const t = s.tickCount

      // ---- pods dropped directly onto a node: kubelet binds them ----
      for (const pod of s.pods) {
        if (pod.phase === 'Pending' && pod.nodeId) {
          pod.phase = 'ContainerCreating'
          pod.phaseTicks = 0
          const host = s.nodes.find((n) => n.id === pod.nodeId)
          logEvent(s, 'Normal', 'Scheduled', `${pod.name} assigned to ${host?.name ?? pod.nodeId} (manual placement)`, pod.name)
          podLog(pod, `Assigned to ${host?.name ?? pod.nodeId}`)
        }
      }

      // ---- scheduler: place Pending pods onto nodes with capacity ----
      for (const pod of s.pods) {
        if (pod.phase !== 'Pending' || pod.nodeId) continue
        const workers = s.nodes.filter((n) => n.role === 'worker')
        const candidates = workers.filter((n) => {
          const u = usageFor(s.pods, n.id)
          return u.cpu + pod.cpuRequest <= n.cpuCapacity && u.mem + pod.memRequest <= n.memCapacity
        })
        if (candidates.length > 0) {
          // least-allocated-first (simple kube-scheduler hint)
          candidates.sort((a, b) => {
            const ua = usageFor(s.pods, a.id)
            const ub = usageFor(s.pods, b.id)
            return (ua.cpu / a.cpuCapacity) - (ub.cpu / b.cpuCapacity)
          })
          pod.nodeId = candidates[0].id
          pod.phase = 'ContainerCreating'
          pod.phaseTicks = 0
          logEvent(s, 'Normal', 'Scheduled', `Successfully assigned ${pod.name} to ${candidates[0].name}`, pod.name)
          podLog(pod, `Assigned to ${candidates[0].name}`)
        } else if (t % 4 === 0) {
          logEvent(s, 'Warning', 'FailedScheduling', `0/${workers.length} nodes are available: insufficient cpu/memory for ${pod.name}.`, pod.name)
        }
      }

      // ---- pod lifecycle transitions ----
      for (const pod of s.pods) {
        pod.ageTicks += 1
        pod.phaseTicks += 1
        switch (pod.phase) {
          case 'ContainerCreating':
            if (pod.phaseTicks >= 3) {
              pod.phase = 'Running'
              pod.phaseTicks = 0
              pod.backoffTicks = 0
              logEvent(s, 'Normal', 'Started', `Started container ${pod.image} in pod ${pod.name}`, pod.name)
              podLog(pod, `Container started: ${pod.image}`)
            }
            break
          case 'Running':
            if (Math.random() < pod.crashRate) {
              pod.phase = 'CrashLoopBackOff'
              pod.phaseTicks = 0
              pod.restarts += 1
              logEvent(s, 'Warning', 'BackOff', `Back-off restarting failed container in pod ${pod.name} (restart #${pod.restarts})`, pod.name)
              podLog(pod, 'ERROR: container exited with code 137 (OOMKilled / crash)')
            }
            break
          case 'CrashLoopBackOff': {
            const backoff = Math.min(2 ** Math.min(pod.restarts, 4), 16) // 2,4,8,16...
            if (pod.phaseTicks >= backoff) {
              pod.phase = 'ContainerCreating'
              pod.phaseTicks = 0
              logEvent(s, 'Normal', 'Pulling', `Restarting container ${pod.image} in pod ${pod.name}`, pod.name)
            }
            break
          }
          case 'Terminating':
            if (pod.phaseTicks >= 2) {
              pod.phase = 'Succeeded' as never
            }
            break
          default:
            break
        }
      }

      // ---- chaos monkey ----
      if (s.chaos && t % 3 === 0) {
        const runningPods = s.pods.filter((p) => p.phase === 'Running')
        if (runningPods.length > 0 && Math.random() < 0.5) {
          const victim = runningPods[Math.floor(Math.random() * runningPods.length)]
          victim.phase = 'CrashLoopBackOff'
          victim.phaseTicks = 0
          victim.restarts += 1
          logEvent(s, 'Warning', 'ChaosMonkey', `Random failure injected in pod ${victim.name} 🐒`, victim.name)
        }
      }

      // ---- deployment controller: reconcile replicas ----
      for (const dep of s.deployments) {
        const mine = s.pods.filter((p) => p.deploymentId === dep.id && p.phase !== 'Terminating')
        if (mine.length < dep.replicas) {
          const missing = dep.replicas - mine.length
          for (let i = 0; i < missing; i++) {
            const pod: Pod = {
              id: uid('pod'),
              name: `${dep.name}-${rand(5)}-${rand(5)}`,
              nodeId: null,
              phase: 'Pending',
              image: dep.image,
              cpuRequest: dep.cpuRequest,
              memRequest: dep.memRequest,
              restarts: 0,
              crashRate: 0.02,
              phaseTicks: 0,
              backoffTicks: 0,
              ageTicks: 0,
              deploymentId: dep.id,
              logs: [],
            }
            s.pods.push(pod)
            logEvent(s, 'Normal', 'SuccessfulCreate', `Created pod: ${pod.name}`, dep.name)
          }
        } else if (mine.length > dep.replicas) {
          const excess = mine.slice(dep.replicas)
          for (const pod of excess) {
            const real = s.pods.find((p) => p.id === pod.id)!
            real.phase = 'Terminating'
            real.phaseTicks = 0
            logEvent(s, 'Normal', 'Killing', `Stopping container ${real.image} in pod ${real.name}`, dep.name)
          }
        }
      }

      // ---- cleanup fully terminated pods ----
      s.pods = s.pods.filter((p) => !(p.phase === 'Succeeded' as never))
      return s
    }),

  setRunning: (v) => set({ running: v }),
  setSpeed: (v) => set({ speed: v }),
  setChaos: (v) => set({ chaos: v }),
  select: (id) => set({ selected: id }),

  addNode: () =>
    set((state) => {
      const workers = state.nodes.filter((n) => n.role === 'worker')
      const n = workers.length + 1
      const node: K8sNode = {
        id: uid('node'),
        name: `worker-node-${n}`,
        role: 'worker',
        cpuCapacity: 4000,
        memCapacity: 8192,
        position: { x: (workers.length % 3) * 600, y: 180 + Math.floor(workers.length / 3) * 240 },
      }
      logEvent(state as ClusterState, 'Normal', 'NodeAdded', `Node ${node.name} joined the cluster`, node.name)
      return { nodes: [...state.nodes, node] }
    }),

  removeNode: (id) =>
    set((state) => {
      const node = state.nodes.find((n) => n.id === id)
      if (!node || node.role === 'control-plane') return state
      const evicted = state.pods.filter((p) => p.nodeId === id)
      const pods = state.pods
        .filter((p) => p.nodeId !== id)
        .map((p) => (p.phase === 'Pending' ? p : p))
      const s = { ...state, nodes: state.nodes.filter((n) => n.id !== id), pods, selected: state.selected?.startsWith(`node:${id}`) ? null : state.selected } as ClusterState
      logEvent(s, 'Warning', 'NodeDeleted', `Node ${node.name} removed — ${evicted.length} pod(s) will be rescheduled by controllers`, node.name)
      for (const p of evicted) {
        if (p.deploymentId) {
          // deployment controller will recreate on next tick
          logEvent(s, 'Warning', 'NodeNotReady', `Pod ${p.name} is evicted (node gone)`, p.name)
        }
      }
      // pods belonging to deployments: drop them so controller recreates; standalone: drop too
      s.pods = s.pods.filter((p) => p.nodeId !== id)
      return s
    }),

  moveNode: (id, position) =>
    set((state) => ({
      nodes: state.nodes.map((n) => (n.id === id ? { ...n, position } : n)),
    })),

  addPod: (spec, targetNodeId) =>
    set((state) => {
      const s = { ...state } as ClusterState
      const pod: Pod = {
        id: uid('pod'),
        name: `${spec.image?.split(':')[0] ?? 'pod'}-${rand(5)}-${rand(5)}`,
        nodeId: targetNodeId ?? null,
        phase: 'Pending',
        image: spec.image ?? 'nginx:latest',
        cpuRequest: spec.cpuRequest ?? 500,
        memRequest: spec.memRequest ?? 512,
        restarts: 0,
        crashRate: spec.crashRate ?? 0.02,
        phaseTicks: 0,
        backoffTicks: 0,
        ageTicks: 0,
        logs: [],
      }
      s.pods = [...state.pods, pod]
      logEvent(s, 'Normal', 'Created', `Pod ${pod.name} created (${pod.cpuRequest}m CPU, ${pod.memRequest}Mi mem)`, pod.name)
      if (targetNodeId) {
        const node = s.nodes.find((n) => n.id === targetNodeId)
        const u = node ? usageFor(s.pods.filter((p) => p.id !== pod.id), node.id) : null
        if (node && u && (u.cpu + pod.cpuRequest > node.cpuCapacity || u.mem + pod.memRequest > node.memCapacity)) {
          logEvent(s, 'Warning', 'FailedScheduling', `Node ${node.name} does not have enough resources for ${pod.name}`, pod.name)
          pod.nodeId = null
        }
      }
      return s
    }),

  removePod: (id) =>
    set((state) => {
      const pod = state.pods.find((p) => p.id === id)
      if (!pod) return state
      const s = { ...state, pods: state.pods.map((p) => (p.id === id ? { ...p, phase: 'Terminating' as PodPhase, phaseTicks: 0 } : p)), selected: state.selected === `pod:${id}` ? null : state.selected } as ClusterState
      logEvent(s, 'Normal', 'Killing', `Stopping container ${pod.image} in pod ${pod.name}`, pod.name)
      return s
    }),

  crashPod: (id) =>
    set((state) => {
      const pod = state.pods.find((p) => p.id === id)
      if (!pod || pod.phase !== 'Running') return state
      const s = { ...state, pods: state.pods.map((p) => (p.id === id ? { ...p, phase: 'CrashLoopBackOff' as PodPhase, phaseTicks: 0, restarts: p.restarts + 1, logs: [...p.logs, '[crash] container exited (code 1)'] } : p)) } as ClusterState
      logEvent(s, 'Warning', 'BackOff', `Back-off restarting failed container in pod ${pod.name} (restart #${pod.restarts + 1})`, pod.name)
      return s
    }),

  restartPod: (id) =>
    set((state) => {
      const s = { ...state, pods: state.pods.map((p) => (p.id === id ? { ...p, phase: 'ContainerCreating' as PodPhase, phaseTicks: 0, logs: [...p.logs, 'restarting container...'] } : p)) } as ClusterState
      const pod = state.pods.find((p) => p.id === id)
      if (pod) logEvent(s, 'Normal', 'Started', `Manual restart of pod ${pod.name}`, pod.name)
      return s
    }),

  addDeployment: (d) =>
    set((state) => {
      const s = { ...state } as ClusterState
      const dep: Deployment = { ...d, id: uid('dep') }
      s.deployments = [...state.deployments, dep]
      logEvent(s, 'Normal', 'ScalingReplicaSet', `Deployment ${dep.name} created with ${dep.replicas} replica(s)`, dep.name)
      // controller will create pods on next tick
      return s
    }),

  scaleDeployment: (id, replicas) =>
    set((state) => {
      const dep = state.deployments.find((d) => d.id === id)
      if (!dep) return state
      const s = { ...state, deployments: state.deployments.map((d) => (d.id === id ? { ...d, replicas: Math.max(0, replicas) } : d)) } as ClusterState
      logEvent(s, 'Normal', 'ScalingReplicaSet', `Scaled ${dep.name} from ${dep.replicas} to ${Math.max(0, replicas)} replicas`, dep.name)
      return s
    }),

  removeDeployment: (id) =>
    set((state) => {
      const dep = state.deployments.find((d) => d.id === id)
      if (!dep) return state
      const s = { ...state, deployments: state.deployments.filter((d) => d.id !== id), pods: state.pods.map((p) => (p.deploymentId === id ? { ...p, phase: 'Terminating' as PodPhase, phaseTicks: 0 } : p)) } as ClusterState
      logEvent(s, 'Normal', 'Deleting', `Deployment ${dep.name} deleted — pods terminating`, dep.name)
      return s
    }),

  reset: () =>
    set({
      nodes: [
        { id: 'cp1', name: 'control-plane-1', role: 'control-plane', cpuCapacity: 4000, memCapacity: 8192, position: { x: 300, y: 0 } },
        { id: 'n1', name: 'worker-node-1', role: 'worker', cpuCapacity: 4000, memCapacity: 8192, position: { x: 0, y: 180 } },
        { id: 'n2', name: 'worker-node-2', role: 'worker', cpuCapacity: 4000, memCapacity: 8192, position: { x: 600, y: 180 } },
      ],
      pods: [],
      deployments: [],
      events: [],
      tickCount: 0,
      selected: null,
    }),
}))

// helpers used by UI
export function nodeUsage(pods: Pod[], nodeId: string) {
  return usageFor(pods, nodeId)
}
