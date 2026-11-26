import type { DeploymentResource, EngineState, HorizontalPodAutoscalerResource, PodResource } from "../types";
import { appendEvent, putResource } from "../resources";

/** Educational autoscaling/v2 CPU utilization controller. */
export function reconcileHorizontalPodAutoscalers(state: EngineState): void {
  const resources = Object.values(state.resources);
  const autoscalers = resources.filter((resource): resource is HorizontalPodAutoscalerResource => resource.kind === "HorizontalPodAutoscaler");
  for (const hpa of autoscalers) {
    const deployment = resources.find((resource): resource is DeploymentResource => resource.kind === "Deployment" && resource.metadata.name === hpa.spec.scaleTargetRef.name && (resource.metadata.namespace ?? "default") === (hpa.metadata.namespace ?? "default"));
    if (!deployment) {
      hpa.status = { ...hpa.status, currentReplicas: 0, desiredReplicas: 0, conditions: [{ type: "AbleToScale", status: false, reason: "TargetNotFound" }, { type: "ScalingActive", status: false, reason: "TargetNotFound" }] };
      putResource(state, hpa); continue;
    }
    const selector = deployment.spec.selector.matchLabels;
    const pods = resources.filter((resource): resource is PodResource => resource.kind === "Pod" && (resource.metadata.namespace ?? "default") === (deployment.metadata.namespace ?? "default") && Object.entries(selector).every(([key,value]) => resource.metadata.labels[key] === value) && resource.status.phase !== "Failed" && resource.status.phase !== "Succeeded");
    const target = Math.max(1, hpa.spec.metrics[0]?.resource.target.averageUtilization ?? 50);
    const utilization = pods.length ? Math.round(pods.reduce((sum,pod) => {
      const requests = pod.spec.containers.reduce((n,c) => n + c.resources.requests.cpuMilli,0);
      const usage = pod.spec.containers.reduce((n,c) => n + (c.simulatedCpuUsageMilli ?? c.resources.requests.cpuMilli),0);
      return sum + (requests > 0 ? usage / requests * 100 : 0);
    },0) / pods.length) : 0;
    const current = deployment.spec.replicas;
    let desired = pods.length ? Math.ceil(current * utilization / target) : hpa.spec.minReplicas;
    desired = Math.max(hpa.spec.minReplicas,Math.min(hpa.spec.maxReplicas,desired));
    if (hpa.status.lastScaleTick !== undefined && state.tick - hpa.status.lastScaleTick < 2) desired = current;
    if (desired !== current) {
      deployment.spec.replicas = desired; deployment.metadata.generation += 1; putResource(state,deployment);
      hpa.status.lastScaleTick = state.tick;
      appendEvent(state,"Normal","SuccessfulRescale","HPA " + hpa.metadata.name + " scaled Deployment " + deployment.metadata.name + " from " + current + " to " + desired + " replicas (CPU " + utilization + "% / target " + target + "%)",hpa.metadata.name);
    }
    hpa.status.currentReplicas = current; hpa.status.desiredReplicas = desired; hpa.status.currentCPUUtilizationPercentage = utilization;
    hpa.status.conditions = [{type:"AbleToScale",status:true,reason:"ReadyForNewScale"},{type:"ScalingActive",status:true,reason:"ValidMetricFound"}];
    putResource(state,hpa);
  }
}
