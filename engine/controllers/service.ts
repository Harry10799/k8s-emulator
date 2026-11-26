import type { EngineState, PodResource, ServiceResource } from "../types";
import { appendEvent, putResource } from "../resources";
import { active, matches, values } from "./shared";

export function reconcileServices(state: EngineState): void {
  const pods = values<PodResource>(state, "Pod");
  const services = values<ServiceResource>(state, "Service");
  for (const [index, service] of services.entries()) {
    if (!service.status.clusterIP) service.status.clusterIP = `10.96.${Math.floor(index / 250) + 1}.${(index % 250) + 1}`;
    if (service.spec.type !== "ClusterIP" && !service.status.nodePort) service.status.nodePort = 30000 + index;
    if (service.spec.type === "LoadBalancer" && !service.status.externalIP && state.tick - service.metadata.creationTimestamp >= 5) {
      service.status.externalIP = `203.0.113.${10 + (index % 240)}`;
      appendEvent(state, "Normal", "Assigned", `LoadBalancer ${service.metadata.name} assigned ${service.status.externalIP}`, service.metadata.name);
    }
    if (service.spec.type !== "LoadBalancer") service.status.externalIP = undefined;
    service.status.endpoints = pods.filter(pod => active(pod) && ready(pod) && (pod.metadata.namespace ?? "default") === (service.metadata.namespace ?? "default") && matches(service.spec.selector, pod.metadata.labels)).map(pod => ({ podName: pod.metadata.name, podUid: pod.metadata.uid, nodeName: pod.spec.nodeName, port: service.spec.targetPort }));
    putResource(state, service);
  }
}
