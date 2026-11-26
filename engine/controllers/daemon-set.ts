import type { DaemonSetResource, EngineState, PodResource } from "../types";
import { appendEvent, putResource, resourceKey } from "../resources";
import { active, makePod, matches, owns, ready, values, workerNodes } from "./shared";

export function reconcileDaemonSets(state: EngineState): void {
  for (const daemonSet of values<DaemonSetResource>(state, "DaemonSet")) {
    const nodes = workerNodes(state).filter(node => matches(daemonSet.spec.nodeSelector ?? {}, node.metadata.labels));
    const pods = values<PodResource>(state, "Pod").filter(pod => owns(pod, daemonSet.metadata.uid));
    for (const pod of pods) {
      const nodeName = pod.spec.nodeName;
      if (!nodeName || !nodes.some(node => node.metadata.name === nodeName)) {
        delete state.resources[resourceKey(pod)];
        appendEvent(state, "Normal", "SuccessfulDelete", `DaemonSet removed pod ${pod.metadata.name} from an unavailable node`, daemonSet.metadata.name);
      }
    }
    for (const node of nodes) {
      const existing = pods.find(pod => pod.spec.nodeName === node.metadata.name && active(pod));
      if (existing) continue;
      const name = `${daemonSet.metadata.name}-${node.metadata.name}`;
      const pod = makePod(state, name, daemonSet.metadata.namespace ?? "default", daemonSet.spec.template.metadata.labels, { ...daemonSet.spec.template.spec, nodeName: node.metadata.name }, { uid: daemonSet.metadata.uid, kind: "DaemonSet", name: daemonSet.metadata.name });
      putResource(state, pod);
      appendEvent(state, "Normal", "SuccessfulCreate", `DaemonSet ${daemonSet.metadata.name} created pod ${name} on ${node.metadata.name}`, daemonSet.metadata.name);
    }
    const current = values<PodResource>(state, "Pod").filter(pod => owns(pod, daemonSet.metadata.uid));
    daemonSet.status = { desiredNumberScheduled: nodes.length, currentNumberScheduled: current.length, numberReady: current.filter(ready).length, numberAvailable: current.filter(ready).length, observedGeneration: daemonSet.metadata.generation };
    putResource(state, daemonSet);
  }
}
