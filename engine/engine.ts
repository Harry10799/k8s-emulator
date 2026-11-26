import type { EngineState, KubernetesResource, NodeResource, PodResource, RandomSource } from "./types";
import { appendEvent, putResource, resourceKey } from "./resources";
import { schedulePod } from "./scheduler";
import { reconcileNodeResources } from "./resource-management";
import { advancePodLifecycle, injectChaosFailure } from "./kubelet";
import { createInitialImageCache } from "./image-registry";
import { reconcileControllers, reconcilePostKubeletControllers } from "./controllers/registry";
import { reconcileNodeHeartbeats, evictNotReadyPods } from "./node-lifecycle";

export function createInitialState(resources: KubernetesResource[] = []): EngineState {
  const state: EngineState = { tick: 0, nextId: 1, nextResourceVersion: 1, resources: {}, events: [], imageCache: {}, controlPlane: { apiServerAvailable: true, schedulerAvailable: true, controllerManagerAvailable: true, etcdAvailable: true }, nodeController: { heartbeatTimeoutTicks: 5, podEvictionTimeoutTicks: 10 } };
  for (const resource of resources) {
    const copy = structuredClone(resource);
    if (copy.kind === "Node") { copy.status.lastHeartbeatTick ??= 0; copy.status.heartbeatEnabled ??= true; }
    state.resources[resourceKey(copy)] = copy;
    state.nextResourceVersion = Math.max(state.nextResourceVersion, resource.metadata.resourceVersion + 1);
  }
  state.imageCache = createInitialImageCache(resources);
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

  const apiAvailable = next.controlPlane?.apiServerAvailable !== false && next.controlPlane?.etcdAvailable !== false;
  if (apiAvailable && next.controlPlane?.controllerManagerAvailable !== false) reconcileNodeHeartbeats(next);
  if (apiAvailable && next.controlPlane?.controllerManagerAvailable !== false) { evictNotReadyPods(next); reconcileControllers(next); }

  if (apiAvailable && next.controlPlane?.schedulerAvailable !== false) schedulePendingPodsInPlace(next);
  else for (const pod of getPods(next)) if (pod.status.phase === "Pending" && !pod.spec.nodeName) {
    pod.status.conditions = [...pod.status.conditions.filter(c => c.type !== "PodScheduled"), { type: "PodScheduled", status: false, reason: "SchedulerUnavailable", message: "kube-scheduler or API persistence is unavailable" }];
    if (next.tick % 4 === 0) appendEvent(next, "Warning", "SchedulerUnavailable", "Pod remains Pending because scheduler/API persistence is unavailable", pod.metadata.name);
  }

  for (const pod of getPods(next)) advancePodLifecycle(next, pod, rng);
  injectChaosFailure(next, rng);
  reconcileNodeResources(next);
  // Reconcile status-dependent controllers after kubelet updates, without
  // advancing Deployment rollout decisions twice in one simulation tick.
  if (apiAvailable && next.controlPlane?.controllerManagerAvailable !== false) reconcilePostKubeletControllers(next);

  return next;
}

export function addResource(state: EngineState, resource: KubernetesResource): EngineState {
  const next = structuredClone(state);
  putResource(next, structuredClone(resource));
  return next;
}
