import { describe, expect, it } from "bun:test";
import { calculatePodResourceUsage, classifyPodQoS } from "../engine";
import { createInitialState, createSeededRng, schedulePendingPods, step, type DeploymentResource, type NodeResource, type PodResource, type ReplicaSetResource } from "../engine";

function node(name: string): NodeResource {
  return {
    apiVersion: "v1",
    kind: "Node",
    metadata: { name, uid: `node-${name}`, namespace: undefined, resourceVersion: 1, generation: 1, labels: { zone: "test" }, annotations: {}, creationTimestamp: 0 },
    spec: { capacity: { cpuMilli: 2000, memoryMi: 2048 } },
    status: { conditions: [{ type: "Ready", status: true }] },
  };
}

function deployment(replicas: number): DeploymentResource {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name: "web", namespace: "default", uid: "deployment-web", resourceVersion: 1, generation: 1, labels: { app: "web" }, annotations: {}, creationTimestamp: 0 },
    spec: {
      replicas,
      selector: { matchLabels: { app: "web" } },
      template: {
        metadata: { labels: { app: "web" } },
        spec: {
          containers: [{ name: "web", image: "nginx:1.27", resources: { requests: { cpuMilli: 100, memoryMi: 64 } } }],
        },
      },
      strategy: { type: "RollingUpdate" },
    },
    status: { observedGeneration: 0, replicas: 0, updatedReplicas: 0, readyReplicas: 0, availableReplicas: 0, conditions: [] },
  };
}

function resourcesOfKind<T extends { kind: string }>(state: ReturnType<typeof createInitialState>, kind: string): T[] {
  return Object.values(state.resources).filter((resource) => resource.kind === kind) as T[];
}

describe("simulation engine", () => {
  it("creates the Deployment -> ReplicaSet -> Pod ownership chain", () => {
    const initial = createInitialState([node("worker-a"), deployment(2)]);
    const result = step(initial, createSeededRng(42));
    const replicaSets = resourcesOfKind<ReplicaSetResource>(result, "ReplicaSet");
    const pods = resourcesOfKind<PodResource>(result, "Pod");

    expect(replicaSets).toHaveLength(1);
    expect(pods).toHaveLength(2);
    expect(replicaSets[0].ownerReferences?.[0]).toMatchObject({ uid: "deployment-web", kind: "Deployment" });
    expect(pods.every((pod) => pod.ownerReferences?.[0]?.uid === replicaSets[0].metadata.uid)).toBe(true);
    expect(pods.every((pod) => pod.spec.nodeName === "worker-a" && pod.status.phase === "Running")).toBe(true);
    expect(initial.tick).toBe(0);
    expect(result.tick).toBe(1);
  });

  it("is deterministic for the same initial state and seed", () => {
    const initial = createInitialState([node("worker-a"), deployment(1)]);
    expect(step(initial, createSeededRng(7))).toEqual(step(initial, createSeededRng(7)));
  });

  it("leaves pods Pending when there are no schedulable nodes", () => {
    const unavailable = node("worker-a");
    unavailable.spec.unschedulable = true;
    const result = step(createInitialState([unavailable, deployment(1)]), createSeededRng(1));
    const pod = resourcesOfKind<PodResource>(result, "Pod")[0];
    expect(pod.status.phase).toBe("Pending");
    expect(pod.spec.nodeName).toBeUndefined();
  });

  it("reconciles scale changes through the ReplicaSet on the next tick", () => {
    const first = step(createInitialState([node("worker-a"), deployment(3)]), createSeededRng(2));
    const dep = resourcesOfKind<DeploymentResource>(first, "Deployment")[0];
    dep.spec.replicas = 1;
    dep.metadata.generation += 1;
    const second = step(first, createSeededRng(2));
    expect(resourcesOfKind<ReplicaSetResource>(second, "ReplicaSet")).toHaveLength(1);
    expect(resourcesOfKind<PodResource>(second, "Pod")).toHaveLength(1);
    expect(resourcesOfKind<DeploymentResource>(second, "Deployment")[0].status.readyReplicas).toBe(1);
  });

  it("schedules Pending Pods together without mutating the input snapshot", () => {
    const initial = createInitialState([node("worker-a"), deployment(2)]);
    const afterStep = step(initial, createSeededRng(42));
    const pods = Object.values(afterStep.resources).filter((resource): resource is PodResource => resource.kind === "Pod");
    for (const pod of pods) {
      pod.status.phase = "Pending";
      pod.spec.nodeName = undefined;
    }
    afterStep.events = [];
    const before = structuredClone(afterStep);
    const scheduled = schedulePendingPods(afterStep);
    const scheduledPods = Object.values(scheduled.resources).filter((resource): resource is PodResource => resource.kind === "Pod");
    expect(scheduledPods.every((pod) => pod.spec.nodeName === "worker-a")).toBe(true);
    expect(afterStep).toEqual(before);
    expect(scheduled.events.filter((event) => event.reason === "Scheduled")).toHaveLength(2);
  });

  it("does not mutate the previous state snapshot", () => {
    const initial = createInitialState([node("worker-a"), deployment(1)]);
    const snapshot = structuredClone(initial);
    step(initial, createSeededRng(5));
    expect(initial).toEqual(snapshot);
  });
  it("creates a retained old revision and starts a readiness-gated rolling update", () => {
    let state = step(createInitialState([node("worker-a"), deployment(2)]), createSeededRng(11));
    const dep = resourcesOfKind<DeploymentResource>(state, "Deployment")[0];
    dep.spec.template.spec.containers[0].image = "nginx:1.28";
    dep.metadata.generation += 1;
    state = step(state, createSeededRng(12));
    const sets = resourcesOfKind<ReplicaSetResource>(state, "ReplicaSet");
    expect(sets).toHaveLength(2);
    expect(sets.some((rs) => rs.spec.template.spec.containers[0].image === "nginx:1.27")).toBe(true);
    expect(sets.some((rs) => rs.spec.template.spec.containers[0].image === "nginx:1.28")).toBe(true);
  });

  it("scales an existing revision without creating another ReplicaSet", () => {
    let state = step(createInitialState([node("worker-a"), deployment(1)]), createSeededRng(3));
    const dep = resourcesOfKind<DeploymentResource>(state, "Deployment")[0];
    dep.spec.replicas = 3; dep.metadata.generation += 1;
    state = step(state, createSeededRng(4));
    expect(resourcesOfKind<ReplicaSetResource>(state, "ReplicaSet")).toHaveLength(1);
    expect(resourcesOfKind<ReplicaSetResource>(state, "ReplicaSet")[0].spec.replicas).toBe(3);
  });

  it("reports ErrImagePull then ImagePullBackOff for an unavailable image", () => {
    const bad = deployment(1);
    bad.spec.template.spec.containers[0].image = "registry.example/not-found:v1";
    let state = step(createInitialState([node("worker-a"), bad]), createSeededRng(8));
    let pod = resourcesOfKind<PodResource>(state, "Pod")[0];
    expect(pod.status.containerStatuses[0].waitingReason).toBe("ErrImagePull");
    for (let i = 0; i < 3; i++) state = step(state, createSeededRng(8));
    pod = resourcesOfKind<PodResource>(state, "Pod")[0];
    expect(["ErrImagePull", "ImagePullBackOff"]).toContain(pod.status.containerStatuses[0].waitingReason);
  });

  it("marks a container OOMKilled when simulated memory use exceeds its limit", () => {
    const pod: PodResource = {
      apiVersion: "v1", kind: "Pod",
      metadata: { name: "memory-hog", namespace: "default", uid: "memory-hog", resourceVersion: 1, generation: 1, labels: {}, annotations: {}, creationTimestamp: 0 },
      spec: { containers: [{ name: "app", image: "busybox:1.36", resources: { requests: { cpuMilli: 50, memoryMi: 64 }, limits: { memoryMi: 128 } }, simulatedMemoryUsageMi: 256 }] },
      status: { phase: "Pending", conditions: [], containerStatuses: [] },
    };
    const result = step(createInitialState([node("worker-a"), pod]), createSeededRng(9));
    const actual = resourcesOfKind<PodResource>(result, "Pod")[0];
    expect(actual.status.containerStatuses[0].lastTerminationReason).toBe("OOMKilled");
    expect(actual.status.containerStatuses[0].exitCode).toBe(137);
  });

  it("restarts a container after liveness probe threshold and applies backoff", () => {
    const pod: PodResource = {
      apiVersion: "v1", kind: "Pod",
      metadata: { name: "unhealthy", namespace: "default", uid: "unhealthy", resourceVersion: 1, generation: 1, labels: {}, annotations: {}, creationTimestamp: 0 },
      spec: { containers: [{ name: "app", image: "busybox:1.36", resources: { requests: { cpuMilli: 50, memoryMi: 64 } }, livenessProbe: { failureTicks: [2, 3], failureThreshold: 2, periodTicks: 1 } }] },
      status: { phase: "Pending", conditions: [], containerStatuses: [] },
    };
    let state = createInitialState([node("worker-a"), pod]);
    state = step(state, createSeededRng(10));
    state = step(state, createSeededRng(10));
    state = step(state, createSeededRng(10));
    const actual = resourcesOfKind<PodResource>(state, "Pod")[0];
    expect(actual.status.containerStatuses[0].lastTerminationReason).toBe("LivenessProbeFailed");
    expect(actual.status.containerStatuses[0].restartCount).toBe(1);
    expect(actual.status.containerStatuses[0].waitingReason).toBe("CrashLoopBackOff");
    expect(actual.status.phase).toBe("Running");
  });

  it("keeps a Pod Running but NotReady while its readiness probe fails", () => {
    const pod: PodResource = {
      apiVersion: "v1", kind: "Pod",
      metadata: { name: "not-ready", namespace: "default", uid: "not-ready", resourceVersion: 1, generation: 1, labels: {}, annotations: {}, creationTimestamp: 0 },
      spec: { containers: [{ name: "app", image: "busybox:1.36", resources: { requests: { cpuMilli: 50, memoryMi: 64 } }, readinessProbe: { failureTicks: [2], failureThreshold: 1 } }] },
      status: { phase: "Pending", conditions: [], containerStatuses: [] },
    };
    let result = step(createInitialState([node("worker-a"), pod]), createSeededRng(11));
    result = step(result, createSeededRng(11));
    const actual = resourcesOfKind<PodResource>(result, "Pod")[0];
    expect(actual.status.phase).toBe("Running");
    expect(actual.status.conditions.find((c) => c.type === "Ready")?.status).toBe(false);
  });

  it("reports StartupProbeFailed separately from liveness failures", () => {
    const pod: PodResource = {
      apiVersion: "v1", kind: "Pod",
      metadata: { name: "startup-fail", namespace: "default", uid: "startup-fail", resourceVersion: 1, generation: 1, labels: {}, annotations: {}, creationTimestamp: 0 },
      spec: { containers: [{ name: "app", image: "busybox:1.36", resources: { requests: { cpuMilli: 50, memoryMi: 64 } }, startupProbe: { failureTicks: [1], failureThreshold: 1 } }] },
      status: { phase: "Pending", conditions: [], containerStatuses: [] },
    };
    const result = step(createInitialState([node("worker-a"), pod]), createSeededRng(12));
    const actual = resourcesOfKind<PodResource>(result, "Pod")[0];
    expect(actual.status.containerStatuses[0].lastTerminationReason).toBe("StartupProbeFailed");
    expect(actual.status.containerStatuses[0].waitingReason).toBe("CrashLoopBackOff");
    expect(actual.status.phase).toBe("Running");
  });

  it("classifies BestEffort, Burstable, and Guaranteed QoS", () => {
    const makePod = (resources: PodResource["spec"]["containers"][number]["resources"]): PodResource => ({
      apiVersion: "v1", kind: "Pod",
      metadata: { name: "qos", namespace: "default", uid: "qos", resourceVersion: 1, generation: 1, labels: {}, annotations: {}, creationTimestamp: 0 },
      spec: { containers: [{ name: "app", image: "busybox", resources }] },
      status: { phase: "Pending", conditions: [], containerStatuses: [] },
    });
    expect(classifyPodQoS(makePod({ requests: { cpuMilli: 0, memoryMi: 0 } }))).toBe("BestEffort");
    expect(classifyPodQoS(makePod({ requests: { cpuMilli: 100, memoryMi: 64 } }))).toBe("Burstable");
    expect(classifyPodQoS(makePod({ requests: { cpuMilli: 100, memoryMi: 64 }, limits: { cpuMilli: 100, memoryMi: 64 } }))).toBe("Guaranteed");
  });

  it("calculates CPU throttling when usage exceeds a CPU limit", () => {
    const pod: PodResource = {
      apiVersion: "v1", kind: "Pod",
      metadata: { name: "cpu-hog", namespace: "default", uid: "cpu-hog", resourceVersion: 1, generation: 1, labels: {}, annotations: {}, creationTimestamp: 0 },
      spec: { containers: [{ name: "app", image: "busybox", resources: { requests: { cpuMilli: 100, memoryMi: 64 }, limits: { cpuMilli: 200, memoryMi: 256 } }, simulatedCpuUsageMilli: 500 }] },
      status: { phase: "Pending", conditions: [], containerStatuses: [] },
    };
    const usage = calculatePodResourceUsage(pod);
    expect(usage.cpuMilli).toBe(200);
    expect(usage.cpuThrottledMilli).toBe(300);
  });

  it("evicts BestEffort Pods first under node memory pressure", () => {
    const bestEffort: PodResource = {
      apiVersion: "v1", kind: "Pod",
      metadata: { name: "be", namespace: "default", uid: "be", resourceVersion: 1, generation: 1, labels: {}, annotations: {}, creationTimestamp: 0 },
      spec: { nodeName: "worker-a", containers: [{ name: "app", image: "busybox", resources: { requests: { cpuMilli: 0, memoryMi: 0 } }, simulatedMemoryUsageMi: 950 }] },
      status: { phase: "Running", conditions: [{ type: "Ready", status: true }], containerStatuses: [{ name: "app", ready: true, restartCount: 0, state: "Running" }] },
    };
    const guaranteed: PodResource = {
      apiVersion: "v1", kind: "Pod",
      metadata: { name: "guaranteed", namespace: "default", uid: "guaranteed", resourceVersion: 1, generation: 1, labels: {}, annotations: {}, creationTimestamp: 0 },
      spec: { nodeName: "worker-a", containers: [{ name: "app", image: "busybox", resources: { requests: { cpuMilli: 100, memoryMi: 100 }, limits: { cpuMilli: 100, memoryMi: 100 } } }] },
      status: { phase: "Running", conditions: [{ type: "Ready", status: true }], containerStatuses: [{ name: "app", ready: true, restartCount: 0, state: "Running" }] },
    };
    const pressureNode = node("worker-a");
    pressureNode.spec.capacity.memoryMi = 1024;
    const result = step(createInitialState([pressureNode, bestEffort, guaranteed]), createSeededRng(99));
    const actual = resourcesOfKind<PodResource>(result, "Pod");
    expect(actual.find((pod) => pod.metadata.name === "be")?.status.conditions.some((condition) => condition.reason === "Evicted")).toBe(true);
    expect(actual.find((pod) => pod.metadata.name === "guaranteed")?.status.phase).toBe("Running");
    expect(resourcesOfKind<NodeResource>(result, "Node")[0].status.conditions.some((condition) => condition.type === "MemoryPressure" && condition.status)).toBe(false);
  });

});
