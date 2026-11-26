import { describe, expect, it } from "bun:test";
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
});
