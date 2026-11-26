import { describe, expect, it } from "bun:test";
import { createInitialState, createSeededRng, step, type DeploymentResource, type NodeResource } from "../engine";

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

describe("simulation engine", () => {
  it("creates and schedules the desired number of deployment pods", () => {
    const initial = createInitialState([node("worker-a"), deployment(2)]);
    const result = step(initial, createSeededRng(42));
    const pods = Object.values(result.resources).filter((resource) => resource.kind === "Pod");
    expect(pods).toHaveLength(2);
    expect(pods.every((pod) => pod.kind === "Pod" && pod.spec.nodeName === "worker-a")).toBe(true);
    expect(pods.every((pod) => pod.kind === "Pod" && pod.status.phase === "Running")).toBe(true);
    expect(initial.tick).toBe(0);
    expect(result.tick).toBe(1);
  });

  it("is deterministic for the same initial state and seed", () => {
    const initial = createInitialState([node("worker-a"), deployment(1)]);
    const first = step(initial, createSeededRng(7));
    const second = step(initial, createSeededRng(7));
    expect(first).toEqual(second);
  });

  it("leaves pods Pending when there are no schedulable nodes", () => {
    const unavailable = node("worker-a");
    unavailable.spec.unschedulable = true;
    const result = step(createInitialState([unavailable, deployment(1)]), createSeededRng(1));
    const pod = Object.values(result.resources).find((resource) => resource.kind === "Pod");
    expect(pod?.kind).toBe("Pod");
    if (pod?.kind === "Pod") expect(pod.status.phase).toBe("Pending");
  });

  it("reconciles scale changes on the next tick", () => {
    const initial = createInitialState([node("worker-a"), deployment(3)]);
    const first = step(initial, createSeededRng(2));
    const dep = Object.values(first.resources).find((resource) => resource.kind === "Deployment");
    expect(dep?.kind).toBe("Deployment");
    if (dep?.kind === "Deployment") dep.spec.replicas = 1;
    const second = step(first, createSeededRng(2));
    expect(Object.values(second.resources).filter((resource) => resource.kind === "Pod")).toHaveLength(1);
  });
});
