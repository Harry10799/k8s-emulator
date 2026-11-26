import { describe, expect, it } from "bun:test";
import { createInitialState, simulateServiceRequest, type PodResource, type ServiceResource } from "../engine";

const service: ServiceResource = {
  apiVersion: "v1", kind: "Service",
  metadata: { name: "web", namespace: "default", uid: "svc-web", resourceVersion: 1, generation: 1, labels: {}, annotations: {}, creationTimestamp: 0 },
  spec: { type: "ClusterIP", selector: { app: "web" }, port: 80, targetPort: 8080 },
  status: { clusterIP: "10.96.0.10", endpoints: [] },
};
const pod: PodResource = {
  apiVersion: "v1", kind: "Pod",
  metadata: { name: "web-0", namespace: "default", uid: "pod-web-0", resourceVersion: 1, generation: 1, labels: { app: "web" }, annotations: {}, creationTimestamp: 0 },
  spec: { containers: [{ name: "main", image: "nginx:1.27", resources: { requests: { cpuMilli: 100, memoryMi: 64 } } }] },
  status: { phase: "Running", conditions: [{ type: "Ready", status: true }], containerStatuses: [], resourceUsage: { cpuMilli: 100, memoryMi: 32, cpuThrottledMilli: 0 } },
};

describe("engine traffic routing", () => {
  it("returns 503 when the Service controller has no Ready endpoints", () => {
    const initial = createInitialState([service]);
    const { state, result } = simulateServiceRequest(initial, "default", "web");
    expect(result.statusCode).toBe(503);
    expect(result.reason).toBe("NoReadyEndpoints");
    expect(initial.trafficRequestCount).toBeUndefined();
    expect(state.trafficRequestCount).toBe(1);
  });

  it("routes only through a published Ready endpoint", () => {
    const withEndpoint = structuredClone(service);
    withEndpoint.status.endpoints = [{ podName: "web-0", podUid: pod.metadata.uid, port: 8080 }];
    const initial = createInitialState([withEndpoint, pod]);
    const { result } = simulateServiceRequest(initial, "default", "web");
    expect(result.podName).toBe("web-0");
    expect([200, 502]).toContain(result.statusCode);
  });

  it("rejects a stale endpoint if its Pod is no longer Ready", () => {
    const stale = structuredClone(pod);
    stale.status.conditions[0].status = false;
    const withEndpoint = structuredClone(service);
    withEndpoint.status.endpoints = [{ podName: "web-0", podUid: pod.metadata.uid, port: 8080 }];
    const { result } = simulateServiceRequest(createInitialState([withEndpoint, stale]), "default", "web");
    expect(result.statusCode).toBe(503);
    expect(result.reason).toBe("EndpointNotReady");
  });
});
