import { createInitialState, step } from "./engine";
import { resourceKey } from "./resources";
import type { EngineEvent, EngineState, NodeResource, PodResource, RandomSource } from "./types";

export interface CanvasNode {
  id: string;
  name: string;
  role: "control-plane" | "worker";
  cpuCapacity: number;
  memCapacity: number;
}
export interface CanvasPod {
  id: string;
  name: string;
  namespace: string;
  labels: Record<string, string>;
  phase: "Pending" | "ContainerCreating" | "Running" | "CrashLoopBackOff" | "Terminating" | "Succeeded";
  image: string;
  cpuRequest: number;
  memRequest: number;
  restarts: number;
  crashRate: number;
  phaseTicks: number;
  ageTicks: number;
  requiredNode: string | null;
  completionTicks: number | null;
  nodeId: string | null;
  logs: string[];
}
export interface CanvasRuntimeResult {
  pods: CanvasPod[];
  events: EngineEvent[];
}

let engineState: EngineState | null = null;

function toNode(node: CanvasNode): NodeResource {
  return {
    apiVersion: "v1",
    kind: "Node",
    metadata: { name: node.name, uid: node.id, resourceVersion: 1, generation: 1, labels: { "kubernetes.io/hostname": node.name }, annotations: {}, creationTimestamp: 0 },
    spec: { capacity: { cpuMilli: node.cpuCapacity, memoryMi: node.memCapacity } },
    status: { conditions: [{ type: "Ready", status: true }] },
  };
}

function toPod(pod: CanvasPod, nodes: CanvasNode[], previous?: PodResource): PodResource {
  const targetId = pod.nodeId ?? pod.requiredNode;
  const targetName = nodes.find(node => node.id === targetId)?.name;
  const imageChanged = previous?.spec.containers[0]?.image !== pod.image;
  const status = previous && !imageChanged ? structuredClone(previous.status) : {
    phase: "Pending" as const,
    conditions: [],
    containerStatuses: [],
  };
  if (pod.phase === "CrashLoopBackOff" && status.phase === "Running") {
    const container = status.containerStatuses[0];
    if (container && container.waitingReason !== "CrashLoopBackOff") {
      container.state = "Terminated";
      container.ready = false;
      container.waitingReason = "CrashLoopBackOff";
      container.restartCount = Math.max(container.restartCount, pod.restarts);
      container.lastTerminationReason = "Error";
      container.nextRestartTick = (engineState?.tick ?? 0) + Math.min(2 ** Math.max(0, pod.restarts - 1), 16);
    }
  } else if (pod.phase === "ContainerCreating" && status.phase === "Running") {
    for (const container of status.containerStatuses) {
      container.state = "Waiting";
      container.ready = false;
      container.waitingReason = "ContainerCreating";
      container.nextRestartTick = undefined;
    }
    status.phase = "Pending";
  }
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: pod.name, namespace: pod.namespace, uid: pod.id, resourceVersion: previous?.metadata.resourceVersion ?? 1, generation: previous?.metadata.generation ?? 1, labels: { ...pod.labels }, annotations: {}, creationTimestamp: pod.ageTicks },
    spec: {
      containers: [{
        name: "main",
        image: pod.image,
        resources: { requests: { cpuMilli: pod.cpuRequest, memoryMi: pod.memRequest } },
        simulatedCrashRate: pod.crashRate,
        ...(pod.completionTicks !== null ? { runForTicks: pod.completionTicks, exitCode: 0 } : {}),
      }],
      restartPolicy: pod.completionTicks !== null ? "Never" : "Always",
      ...(targetName ? { nodeName: targetName } : {}),
    },
    status,
    ownerReferences: previous?.ownerReferences,
  };
}

function projectPod(resource: PodResource, original: CanvasPod, nodes: CanvasNode[], tick: number): CanvasPod {
  const container = resource.status.containerStatuses[0];
  const waiting = container?.waitingReason;
  let phase: CanvasPod["phase"];
  if (resource.status.phase === "Succeeded") phase = "Succeeded";
  else if (waiting === "CrashLoopBackOff" || waiting === "ImagePullBackOff" || waiting === "ErrImagePull") phase = "CrashLoopBackOff";
  else if (resource.status.phase === "Running") phase = "Running";
  else if (resource.spec.nodeName) phase = "ContainerCreating";
  else phase = "Pending";
  const node = nodes.find(item => item.name === resource.spec.nodeName);
  const restarts = Math.max(original.restarts, ...resource.status.containerStatuses.map(item => item.restartCount), 0);
  return {
    ...original,
    phase,
    nodeId: node?.id ?? original.nodeId,
    restarts,
    ageTicks: original.ageTicks + 1,
    phaseTicks: phase === original.phase ? original.phaseTicks + 1 : 0,
  };
}

/** Synchronize canvas objects into a retained EngineState, run one pure engine tick, then project Pod status. */
export function advanceCanvasRuntime(nodes: CanvasNode[], pods: CanvasPod[], tick: number, rng: RandomSource): CanvasRuntimeResult {
  const workerNodes = nodes.filter(node => node.role === "worker");
  if (!engineState) engineState = createInitialState(workerNodes.map(toNode));
  const previousEvents = new Set(engineState.events.map(event => event.id));
  const resources = { ...engineState.resources };
  for (const [key, resource] of Object.entries(resources)) {
    if (resource.kind === "Node" || resource.kind === "Pod") delete resources[key];
  }
  for (const node of workerNodes) {
    const resource = toNode(node);
    resources[resourceKey(resource)] = resource;
    engineState.imageCache[node.id] ??= ["nginx:1.27", "nginx:1.28", "busybox", "busybox:1.36"];
  }
  const activePods = pods.filter(pod => pod.phase !== "Terminating" && pod.phase !== "Succeeded");
  const previousPods = new Map(Object.values(engineState.resources).filter((resource): resource is PodResource => resource.kind === "Pod").map(pod => [pod.metadata.uid, pod]));
  for (const pod of activePods) {
    const resource = toPod(pod, workerNodes, previousPods.get(pod.id));
    resources[resourceKey(resource)] = resource;
  }
  engineState = { ...engineState, tick: Math.max(0, tick - 1), resources, imageCache: Object.fromEntries(workerNodes.map(node => [node.id, engineState?.imageCache[node.id] ?? []])) };
  engineState = step(engineState, rng);
  const projected = activePods.map(pod => {
    const resource = Object.values(engineState!.resources).find((item): item is PodResource => item.kind === "Pod" && item.metadata.uid === pod.id);
    return resource ? projectPod(resource, pod, workerNodes, tick) : pod;
  });
  const byId = new Map(projected.map(pod => [pod.id, pod]));
  const nextPods = pods.map(pod => byId.get(pod.id) ?? pod);
  const events = engineState.events.filter(event => !previousEvents.has(event.id));
  return { pods: nextPods, events };
}

export function resetCanvasRuntime(): void {
  engineState = null;
}
