import type { EngineState, KubernetesResource, NodeResource, PodResource, RandomSource } from "./types";
import { appendEvent, putResource, resourceKey } from "./resources";
import { reconcileDeployments, reconcileReplicaSets, syncDeploymentStatuses } from "./reconcile";
import { schedulePod } from "./scheduler";
import { reconcileNodeResources } from "./resource-management";
import { advancePodLifecycle } from "./kubelet";

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

/** Run the scheduler stage without advancing controllers or container lifecycle. */
function schedulePendingPodsInPlace(state: EngineState): void {
  const nodes = getNodes(state);
  for (const pod of getPods(state)) {
    if (pod.status.phase !== "Pending" || pod.spec.nodeName) continue;
    const result = schedulePod(pod, nodes, getPods(state));
    if (result.node) {
      pod.spec.nodeName = result.node.metadata.name;
      pod.status.conditions = [
        { type: "PodScheduled", status: true, reason: "Scheduled" },
        { type: "Ready", status: false, reason: "ContainersNotReady" },
      ];
      putResource(state, pod);
      appendEvent(state, "Normal", "Scheduled", `Successfully assigned ${pod.metadata.name} to ${result.node.metadata.name}`, pod.metadata.name);
    } else if (state.tick % 4 === 0) {
      appendEvent(state, "Warning", "FailedScheduling", result.reason ?? "No eligible nodes", pod.metadata.name);
    }
  }
}

/** Public immutable scheduling helper for tests and isolated scheduler exercises. */
export function schedulePendingPods(state: EngineState): EngineState {
  const next = structuredClone(state);
  schedulePendingPodsInPlace(next);
  return next;
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

  schedulePendingPodsInPlace(next);

  for (const pod of getPods(next)) advancePodLifecycle(next, pod);
  reconcileNodeResources(next);
  reconcileReplicaSets(next);
  syncDeploymentStatuses(next);

  // Seeded randomness is passed to controllers that need stochastic behavior; keeping it
  // in the step contract makes replay deterministic as stochastic controllers are added.
  void rng;
  return next;
}

export function addResource(state: EngineState, resource: KubernetesResource): EngineState {
  const next = structuredClone(state);
  putResource(next, structuredClone(resource));
  return next;
}
