import type { EngineState, NodeResource, PodResource, ContainerSpec } from "./types";
import { appendEvent, putResource } from "./resources";

export type QoSClass = "Guaranteed" | "Burstable" | "BestEffort";

function allContainers(pod: PodResource): ContainerSpec[] {
  return [...(pod.spec.initContainers ?? []), ...pod.spec.containers];
}

/** Kubernetes-style Pod QoS classification based on CPU and memory requests/limits. */
export function classifyPodQoS(pod: PodResource): QoSClass {
  const containers = allContainers(pod);
  if (containers.length === 0) return "BestEffort";
  const hasAnyResources = containers.some((container) =>
    container.resources.requests.cpuMilli > 0 ||
    container.resources.requests.memoryMi > 0 ||
    container.resources.limits?.cpuMilli !== undefined ||
    container.resources.limits?.memoryMi !== undefined
  );
  if (!hasAnyResources) return "BestEffort";
  const guaranteed = containers.every((container) => {
    const requests = container.resources.requests;
    const limits = container.resources.limits;
    return limits?.cpuMilli !== undefined && limits.cpuMilli === requests.cpuMilli &&
      limits.memoryMi !== undefined && limits.memoryMi === requests.memoryMi;
  });
  return guaranteed ? "Guaranteed" : "Burstable";
}

function containerUsage(container: ContainerSpec): { cpuMilli: number; memoryMi: number; cpuThrottledMilli: number } {
  const requestedCpu = Math.max(0, container.resources.requests.cpuMilli);
  const rawCpu = Math.max(0, container.simulatedCpuUsageMilli ?? requestedCpu);
  const cpuLimit = container.resources.limits?.cpuMilli;
  const cpuMilli = cpuLimit === undefined ? rawCpu : Math.min(rawCpu, Math.max(0, cpuLimit));
  const memoryMi = Math.max(0, container.simulatedMemoryUsageMi ?? container.resources.requests.memoryMi);
  return { cpuMilli, memoryMi, cpuThrottledMilli: Math.max(0, rawCpu - cpuMilli) };
}

/** Recompute usage and CPU throttling for each Pod from its container workload settings. */
export function calculatePodResourceUsage(pod: PodResource): { cpuMilli: number; memoryMi: number; cpuThrottledMilli: number } {
  return allContainers(pod).reduce((total, container) => {
    const usage = containerUsage(container);
    return {
      cpuMilli: total.cpuMilli + usage.cpuMilli,
      memoryMi: total.memoryMi + usage.memoryMi,
      cpuThrottledMilli: total.cpuThrottledMilli + usage.cpuThrottledMilli,
    };
  }, { cpuMilli: 0, memoryMi: 0, cpuThrottledMilli: 0 });
}

function activeOnNode(pod: PodResource, node: NodeResource): boolean {
  return pod.spec.nodeName === node.metadata.name && !["Succeeded", "Failed"].includes(pod.status.phase);
}

function setCondition(node: NodeResource, type: "MemoryPressure", status: boolean, reason: string, message: string): void {
  const existing = node.status.conditions.find((condition) => condition.type === type);
  if (existing) {
    existing.status = status;
    existing.reason = reason;
    existing.message = message;
  } else {
    node.status.conditions.push({ type, status, reason, message });
  }
}

/**
 * Kubelet/node-pressure approximation. Memory pressure is raised at 90% of
 * capacity and Pods are evicted until usage falls below 85%. Eviction priority
 * follows Kubernetes QoS ordering: BestEffort, Burstable, then Guaranteed.
 */
export function reconcileNodeResources(state: EngineState): void {
  const pods = Object.values(state.resources).filter((resource): resource is PodResource => resource.kind === "Pod");
  const nodes = Object.values(state.resources).filter((resource): resource is NodeResource => resource.kind === "Node");

  for (const node of nodes) {
    const nodePods = pods.filter((pod) => activeOnNode(pod, node));
    const usage = () => nodePods.reduce((total, pod) => {
      const podUsage = calculatePodResourceUsage(pod);
      return { cpuMilli: total.cpuMilli + podUsage.cpuMilli, memoryMi: total.memoryMi + podUsage.memoryMi };
    }, { cpuMilli: 0, memoryMi: 0 });
    let current = usage();
    const memoryCapacity = Math.max(1, (node.spec.allocatable ?? node.spec.capacity).memoryMi);
    const pressured = current.memoryMi / memoryCapacity >= 0.9;

    if (pressured) {
      appendEvent(state, "Warning", "MemoryPressure", `Node ${node.metadata.name} memory usage is ${current.memoryMi}Mi / ${memoryCapacity}Mi`, node.metadata.name);
      const candidates = [...nodePods].sort((a, b) => {
        const rank: Record<QoSClass, number> = { BestEffort: 0, Burstable: 1, Guaranteed: 2 };
        const qos = rank[classifyPodQoS(a)] - rank[classifyPodQoS(b)];
        if (qos !== 0) return qos;
        return calculatePodResourceUsage(b).memoryMi - calculatePodResourceUsage(a).memoryMi;
      });
      for (const pod of candidates) {
        if (current.memoryMi / memoryCapacity < 0.85) break;
        const podUsage = calculatePodResourceUsage(pod);
        pod.status.phase = "Failed";
        pod.status.resourceUsage = podUsage;
        pod.status.qosClass = classifyPodQoS(pod);
        for (const container of pod.status.containerStatuses) {
          container.ready = false;
          container.state = "Terminated";
          container.lastTerminationReason = "Error";
          container.exitCode = 137;
        }
        const ready = pod.status.conditions.find((condition) => condition.type === "Ready");
        if (ready) { ready.status = false; ready.reason = "Evicted"; }
        else pod.status.conditions.push({ type: "Ready", status: false, reason: "Evicted" });
        appendEvent(state, "Warning", "Evicted", `Pod ${pod.metadata.name} evicted from node ${node.metadata.name} due to memory pressure (QoS ${pod.status.qosClass})`, pod.metadata.name);
        current.memoryMi -= podUsage.memoryMi;
      }
    }
    setCondition(node, "MemoryPressure", current.memoryMi / memoryCapacity >= 0.9,
      current.memoryMi / memoryCapacity >= 0.9 ? "KubeletHasInsufficientMemory" : "SufficientMemory",
      `Memory usage: ${current.memoryMi}Mi / ${memoryCapacity}Mi`);
    node.status.resourceUsage = current;
    putResource(state, node);
  }

  for (const pod of pods) {
    if (pod.status.phase === "Failed" && pod.status.conditions.some((condition) => condition.reason === "Evicted")) continue;
    pod.status.qosClass = classifyPodQoS(pod);
    pod.status.resourceUsage = calculatePodResourceUsage(pod);
    for (const status of pod.status.containerStatuses) {
      const spec = allContainers(pod).find((container) => container.name === status.name);
      if (!spec) continue;
      status.usage = containerUsage(spec);
      if (status.usage.cpuThrottledMilli > 0) {
        appendEvent(state, "Warning", "CPUThrottlingHigh", `Container ${status.name} is throttled by ${status.usage.cpuThrottledMilli}m CPU due to its CPU limit`, pod.metadata.name);
      }
    }
    putResource(state, pod);
  }
}
