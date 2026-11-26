import type { EngineState, KubernetesResource, NodeResource, PodResource, RandomSource } from "./types";
import { appendEvent, putResource, resourceKey } from "./resources";
import { reconcileDeployments, reconcileReplicaSets, syncDeploymentStatuses } from "./reconcile";
import { schedulePod } from "./scheduler";

export function createInitialState(resources: KubernetesResource[] = []): EngineState {
  const state: EngineState = { tick: 0, nextId: 1, nextResourceVersion: 1, resources: {}, events: [] };
  for (const resource of resources) {
    state.resources[resourceKey(resource)] = structuredClone(resource);
    state.nextResourceVersion = Math.max(state.nextResourceVersion, resource.metadata.resourceVersion + 1);
  }
  return state;
}

function getNodes(state: EngineState): NodeResource[] {
  return Object.values(state.resources).filter(
    (resource): resource is NodeResource => resource.kind === "Node",
  );
}

function getPods(state: EngineState): PodResource[] {
  return Object.values(state.resources).filter(
    (resource): resource is PodResource => resource.kind === "Pod",
  );
}

function updatePodReadiness(state: EngineState, pod: PodResource): void {
  if (!pod.spec.nodeName || pod.status.phase !== "Pending") return;
  pod.status.phase = "Running";
  pod.status.conditions = [
    { type: "PodScheduled", status: true },
    { type: "Ready", status: true },
  ];
  pod.status.containerStatuses = pod.spec.containers.map((container) => ({
    name: container.name,
    ready: true,
    restartCount: 0,
    state: "Running",
  }));
  putResource(state, pod);
  appendEvent(state, "Normal", "Started", `Started containers for pod ${pod.metadata.name}`, pod.metadata.name);
}

/**
 * Advance one deterministic simulation tick.
 * The input state is never mutated; callers can retain prior snapshots for undo/redo.
 */
export function step(state: EngineState, rng: RandomSource): EngineState {
  const next: EngineState = structuredClone(state);
  next.tick += 1;

  // Control-plane order: Deployment -> ReplicaSet -> scheduler/kubelet.
  reconcileDeployments(next);
  reconcileReplicaSets(next);

  const nodes = getNodes(next);
  for (const pod of getPods(next)) {
    if (pod.status.phase !== "Pending" || pod.spec.nodeName) continue;
    const result = schedulePod(pod, nodes, getPods(next));
    if (result.node) {
      pod.spec.nodeName = result.node.metadata.name;
      pod.status.conditions = [
        { type: "PodScheduled", status: true, reason: "Scheduled" },
        { type: "Ready", status: false, reason: "ContainersNotReady" },
      ];
      putResource(next, pod);
      appendEvent(next, "Normal", "Scheduled", `Successfully assigned ${pod.metadata.name} to ${result.node.metadata.name}`, pod.metadata.name);
    } else if (next.tick % 4 === 0) {
      appendEvent(next, "Warning", "FailedScheduling", result.reason ?? "No eligible nodes", pod.metadata.name);
    }
  }

  for (const pod of getPods(next)) updatePodReadiness(next, pod);
  reconcileReplicaSets(next);
  syncDeploymentStatuses(next);

  // Consume one deterministic random value per tick for future stochastic controllers.
  rng.next();
  return next;
}

export function addResource(state: EngineState, resource: KubernetesResource): EngineState {
  const next = structuredClone(state);
  putResource(next, structuredClone(resource));
  return next;
}
