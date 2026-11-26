import type { EngineState, PersistentVolumeClaimResource, PodResource, StatefulSetResource } from "../types";
import { appendEvent, createMetadata, putResource, resourceKey } from "../resources";
import { active, makePod, owns, ready, values } from "./shared";

export function reconcileStatefulSets(state: EngineState): void {
  for (const statefulSet of values<StatefulSetResource>(state, "StatefulSet")) {
    const desired = Math.max(0, Math.floor(statefulSet.spec.replicas));
    const pods = values<PodResource>(state, "Pod").filter(pod => owns(pod, statefulSet.metadata.uid));
    const ordinalOf = (pod: PodResource) => Number(pod.metadata.name.slice(statefulSet.metadata.name.length + 1));
    for (const pod of pods.filter(p => active(p))) {
      if (ordinalOf(pod) >= desired) {
        delete state.resources[resourceKey(pod)];
        appendEvent(state, "Normal", "SuccessfulDelete", `StatefulSet scaled down and removed ${pod.metadata.name}`, statefulSet.metadata.name);
      }
    }
    for (let ordinal = 0; ordinal < desired; ordinal++) {
      const name = `${statefulSet.metadata.name}-${ordinal}`;
      const existing = pods.find(pod => pod.metadata.name === name && active(pod));
      if (existing) {
        if (!ready(existing)) break;
        continue;
      }
      const lowerOrdinalsReady = pods.filter(pod => ordinalOf(pod) < ordinal).every(ready);
      if (!lowerOrdinalsReady) break;
      let volumeClaimName: string | undefined;
      const claimTemplate = statefulSet.spec.volumeClaimTemplate;
      if (claimTemplate && claimTemplate.storageGi > 0) {
        volumeClaimName = `data-${name}`;
        const claimKey = `PersistentVolumeClaim:${statefulSet.metadata.namespace ?? "default"}/${volumeClaimName}`;
        let claim = state.resources[claimKey] as PersistentVolumeClaimResource | undefined;
        if (!claim) {
          claim = { apiVersion: "v1", kind: "PersistentVolumeClaim", metadata: createMetadata(state, volumeClaimName, statefulSet.metadata.namespace ?? "default"), spec: { storageGi: claimTemplate.storageGi, storageClassName: claimTemplate.storageClassName }, status: { phase: "Pending" } };
          putResource(state, claim);
          appendEvent(state, "Normal", "Provisioning", `Created claim ${volumeClaimName} for ${name}`, volumeClaimName);
          break;
        }
        if (claim.status.phase !== "Bound") break;
      }
      const labels = { ...statefulSet.spec.template.metadata.labels, "apps.kubernetes.io/pod-index": String(ordinal) };
      const spec = structuredClone(statefulSet.spec.template.spec);
      if (volumeClaimName) spec.volumeClaimName = volumeClaimName;
      const pod = makePod(state, name, statefulSet.metadata.namespace ?? "default", labels, spec, { uid: statefulSet.metadata.uid, kind: "StatefulSet", name: statefulSet.metadata.name });
      putResource(state, pod);
      appendEvent(state, "Normal", "SuccessfulCreate", `StatefulSet created ordinal pod ${name}`, statefulSet.metadata.name);
      break; // ordered startup: one new ordinal per reconciliation
    }
    const current = values<PodResource>(state, "Pod").filter(pod => owns(pod, statefulSet.metadata.uid));
    statefulSet.status = { replicas: current.length, readyReplicas: current.filter(ready).length, currentReplicas: current.length, observedGeneration: statefulSet.metadata.generation };
    putResource(state, statefulSet);
  }
}
