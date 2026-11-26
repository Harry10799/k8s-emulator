import { describe, expect, it } from "bun:test";
import { createInitialState, createSeededRng, step, type NodeResource, type PodResource } from "../engine";
import { imageAvailable, imagePullDurationTicks } from "../engine/image-registry";

function worker(): NodeResource {
  return {
    apiVersion: "v1",
    kind: "Node",
    metadata: { name: "worker", uid: "worker-uid", resourceVersion: 1, generation: 1, labels: {}, annotations: {}, creationTimestamp: 0 },
    spec: { capacity: { cpuMilli: 2000, memoryMi: 2048 } },
    status: { conditions: [{ type: "Ready", status: true }] },
  };
}

function pod(image: string): PodResource {
  return {
    apiVersion: "v1",
    kind: "Pod",
    metadata: { name: "image-test", namespace: "default", uid: "image-test", resourceVersion: 1, generation: 1, labels: {}, annotations: {}, creationTimestamp: 0 },
    spec: { containers: [{ name: "main", image, resources: { requests: { cpuMilli: 50, memoryMi: 64 } } }] },
    status: { phase: "Pending", conditions: [], containerStatuses: [] },
  };
}

describe("simulated image registry", () => {
  it("recognizes supported repositories and rejects unknown images", () => {
    expect(imageAvailable("docker.io/library/nginx:1.27")).toBe(true);
    expect(imageAvailable("registry.example/not-found:v1")).toBe(false);
    expect(imagePullDurationTicks("alpine:3.20")).toBe(2);
  });

  it("pulls a known uncached image before starting the container", () => {
    let state = step(createInitialState([worker(), pod("alpine:3.20")]), createSeededRng(1));
    let resource = Object.values(state.resources).find((item): item is PodResource => item.kind === "Pod");
    expect(resource?.status.containerStatuses[0].waitingReason).toBe("ContainerCreating");
    state = step(state, createSeededRng(1));
    resource = Object.values(state.resources).find((item): item is PodResource => item.kind === "Pod");
    expect(resource?.status.containerStatuses[0].state).toBe("Waiting");
    state = step(state, createSeededRng(1));
    resource = Object.values(state.resources).find((item): item is PodResource => item.kind === "Pod");
    expect(resource?.status.containerStatuses[0].state).toBe("Running");
    expect(state.imageCache["worker-uid"]).toContain("alpine:3.20");
  });

  it("reports ErrImagePull for an image absent from the catalogue", () => {
    const state = step(createInitialState([worker(), pod("registry.example/not-found:v1")]), createSeededRng(2));
    const resource = Object.values(state.resources).find((item): item is PodResource => item.kind === "Pod");
    expect(resource?.status.containerStatuses[0].waitingReason).toBe("ErrImagePull");
  });
});
