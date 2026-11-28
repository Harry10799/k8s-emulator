import type { EngineState, PodResource, ServiceResource, TrafficSample } from "./types";
import { createSeededRng } from "./rng";

export interface TrafficResult {
  ok: boolean;
  statusCode: number;
  serviceName: string;
  podName?: string;
  latencyMs: number;
  errorRate: number;
  reason?: string;
}

const MAX_TRAFFIC_HISTORY = 120;

function recordResult(state: EngineState, namespace: string, result: TrafficResult): void {
  const sample: TrafficSample = {
    tick: state.tick,
    requestNumber: state.trafficRequestCount ?? 0,
    namespace,
    serviceName: result.serviceName,
    ...(result.podName ? { podName: result.podName } : {}),
    statusCode: result.statusCode,
    ok: result.ok,
    latencyMs: result.latencyMs,
    errorRate: result.errorRate,
    ...(result.reason ? { reason: result.reason } : {}),
  };
  state.trafficHistory = [...(state.trafficHistory ?? []), sample].slice(-MAX_TRAFFIC_HISTORY);
}

/** Route only through the Service controller's published Ready endpoints. */
export function simulateServiceRequest(state: EngineState, namespace: string, serviceName: string): { state: EngineState; result: TrafficResult } {
  const next = structuredClone(state);
  next.trafficRequestCount = (next.trafficRequestCount ?? 0) + 1;
  const service = Object.values(next.resources).find(
    (resource): resource is ServiceResource => resource.kind === "Service" &&
      resource.metadata.namespace === namespace && resource.metadata.name === serviceName,
  );
  if (!service) {
    const result: TrafficResult = { ok: false, statusCode: 404, serviceName, latencyMs: 0, errorRate: 1, reason: "ServiceNotFound" };
    recordResult(next, namespace, result);
    return { state: next, result };
  }
  const endpoints = service.status.endpoints;
  if (endpoints.length === 0) {
    const result: TrafficResult = { ok: false, statusCode: 503, serviceName, latencyMs: 0, errorRate: 1, reason: "NoReadyEndpoints" };
    recordResult(next, namespace, result);
    return { state: next, result };
  }

  // Derive a request-local seed from engine time + persisted sequence; no UI RNG/state.
  const rng = createSeededRng((((next.tick + 1) * 0x9e3779b1) ^ (next.trafficRequestCount * 0x85ebca6b)) >>> 0);
  const endpoint = endpoints[Math.floor(rng.next() * endpoints.length)];
  const pod = Object.values(next.resources).find(
    (resource): resource is PodResource => resource.kind === "Pod" && resource.metadata.uid === endpoint.podUid,
  );
  if (!pod || !pod.status.conditions.some(condition => condition.type === "Ready" && condition.status)) {
    const result: TrafficResult = { ok: false, statusCode: 503, serviceName, latencyMs: 0, errorRate: 1, reason: "EndpointNotReady" };
    recordResult(next, namespace, result);
    return { state: next, result };
  }

  const requestCpu = pod.spec.containers.reduce((sum, container) => sum + container.resources.requests.cpuMilli, 0);
  const usedCpu = pod.status.resourceUsage?.cpuMilli ?? requestCpu;
  const utilization = requestCpu > 0 ? usedCpu / requestCpu : 0;
  const errorRate = Math.min(0.95, Math.max(0.01, 0.01 + Math.max(0, utilization - 1) * 0.18 + (next.chaos ? 0.12 : 0)));
  const latencyMs = Math.round(8 + utilization * 18 + rng.next() * 14);
  const failed = rng.next() < errorRate;
  const result: TrafficResult = {
    ok: !failed, statusCode: failed ? 502 : 200, serviceName, podName: pod.metadata.name,
    latencyMs, errorRate, ...(failed ? { reason: "UpstreamError" } : {}),
  };
  recordResult(next, namespace, result);
  return { state: next, result };
}
