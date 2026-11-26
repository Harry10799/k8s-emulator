import type { NodeResource, PodResource, Toleration } from "./types";

export interface SchedulingResult {
  node?: NodeResource;
  reason?: string;
  candidates: Array<{ node: string; score: number }>;
}

function matchesTaint(
  taint: NonNullable<NodeResource["spec"]["taints"]>[number],
  tolerations: Toleration[],
): boolean {
  return tolerations.some((toleration) => {
    if (toleration.effect && toleration.effect !== taint.effect) return false;
    const operator = toleration.operator ?? "Equal";
    if (operator === "Exists") return !toleration.key || toleration.key === taint.key;
    return toleration.key === taint.key && (toleration.value ?? "") === (taint.value ?? "");
  });
}

function podRequests(pod: PodResource): { cpuMilli: number; memoryMi: number } {
  const regular = pod.spec.containers.reduce(
    (total, container) => ({
      cpuMilli: total.cpuMilli + container.resources.requests.cpuMilli,
      memoryMi: total.memoryMi + container.resources.requests.memoryMi,
    }),
    { cpuMilli: 0, memoryMi: 0 },
  );
  const init = (pod.spec.initContainers ?? []).reduce(
    (max, container) => ({
      cpuMilli: Math.max(max.cpuMilli, container.resources.requests.cpuMilli),
      memoryMi: Math.max(max.memoryMi, container.resources.requests.memoryMi),
    }),
    { cpuMilli: 0, memoryMi: 0 },
  );
  return {
    cpuMilli: Math.max(regular.cpuMilli, init.cpuMilli),
    memoryMi: Math.max(regular.memoryMi, init.memoryMi),
  };
}

export function schedulePod(pod: PodResource, nodes: NodeResource[], boundPods: PodResource[]): SchedulingResult {
  const requests = podRequests(pod);
  const candidates: Array<{ node: NodeResource; score: number }> = [];
  let rejected = 0;

  for (const node of nodes) {
    if (node.spec.unschedulable || !node.status.conditions.some((condition) => condition.type === "Ready" && condition.status)) {
      rejected += 1;
      continue;
    }
    const labelsMatch = Object.entries(pod.spec.nodeSelector ?? {}).every(
      ([key, value]) => node.metadata.labels[key] === value,
    );
    if (!labelsMatch) {
      rejected += 1;
      continue;
    }
    const untolerated = (node.spec.taints ?? []).some(
      (taint) => taint.effect === "NoSchedule" && !matchesTaint(taint, pod.spec.tolerations ?? []),
    );
    if (untolerated) {
      rejected += 1;
      continue;
    }

    const used = boundPods
      .filter((candidate) => candidate.spec.nodeName === node.metadata.name && candidate.status.phase !== "Succeeded" && candidate.status.phase !== "Failed")
      .reduce((total, candidate) => {
        const request = podRequests(candidate);
        return { cpuMilli: total.cpuMilli + request.cpuMilli, memoryMi: total.memoryMi + request.memoryMi };
      }, { cpuMilli: 0, memoryMi: 0 });
    const capacity = node.spec.allocatable ?? node.spec.capacity;
    if (used.cpuMilli + requests.cpuMilli > capacity.cpuMilli || used.memoryMi + requests.memoryMi > capacity.memoryMi) {
      rejected += 1;
      continue;
    }

    const cpuPressure = (used.cpuMilli + requests.cpuMilli) / Math.max(1, capacity.cpuMilli);
    const memoryPressure = (used.memoryMi + requests.memoryMi) / Math.max(1, capacity.memoryMi);
    candidates.push({ node, score: 1 - Math.max(cpuPressure, memoryPressure) });
  }

  candidates.sort((a, b) => b.score - a.score || a.node.metadata.name.localeCompare(b.node.metadata.name));
  return {
    node: candidates[0]?.node,
    reason: candidates.length ? undefined : `0/${nodes.length} nodes are available (${rejected} rejected by filters or capacity)`,
    candidates: candidates.map(({ node, score }) => ({ node: node.metadata.name, score })),
  };
}
