import type { CronJobResource, DaemonSetResource, EngineState, JobResource, KubernetesResource, NodeResource, PersistentVolumeClaimResource, PodResource, ServiceResource, StatefulSetResource } from "./types";
import { appendEvent, createMetadata, putResource, resourceKey } from "./resources";

const values = <T extends KubernetesResource>(state: EngineState, kind: T["kind"]): T[] =>
  Object.values(state.resources).filter((resource): resource is T => resource.kind === kind);
const active = (pod: PodResource) => pod.status.phase !== "Succeeded" && pod.status.phase !== "Failed";
const ready = (pod: PodResource) => pod.status.phase === "Running" && pod.status.conditions.some(condition => condition.type === "Ready" && condition.status);
const owns = (pod: PodResource, uid: string) => pod.ownerReferences?.some(owner => owner.uid === uid) === true;
const makePod = (state: EngineState, name: string, namespace: string, labels: Record<string,string>, spec: PodResource["spec"], owner: {uid:string;kind:string;name:string}): PodResource => ({
  apiVersion: "v1", kind: "Pod",
  metadata: createMetadata(state, name, namespace, labels),
  spec: structuredClone(spec),
  status: { phase: "Pending", conditions: [{ type: "PodScheduled", status: false }, { type: "Ready", status: false }], containerStatuses: spec.containers.map(container => ({ name: container.name, ready: false, restartCount: 0, state: "Waiting" })) },
  ownerReferences: [owner],
});
const matches = (selector: Record<string,string>, labels: Record<string,string>) => Object.entries(selector).every(([key,value]) => labels[key] === value);
const workerNodes = (state: EngineState) => values<NodeResource>(state, "Node").filter(node => node.status.conditions.some(c => c.type === "Ready" && c.status) && !node.spec.unschedulable);

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
        volumeClaimName = `${claimTemplate.storageClassName}-${name}`;
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

function scheduleInterval(schedule: string): number {
  const trimmed = schedule.trim();
  const every = trimmed.match(/^\*\/(\d+)/);
  if (every) return Math.max(1, Number(every[1]));
  if (trimmed === "* * * * *") return 60;
  const number = trimmed.match(/^(\d+)$/);
  return number ? Math.max(1, Number(number[1])) : 0;
}

export function reconcileCronJobs(state: EngineState): void {
  for (const cronJob of values<CronJobResource>(state, "CronJob")) {
    if (cronJob.spec.suspend) continue;
    const interval = scheduleInterval(cronJob.spec.schedule);
    if (!interval || state.tick - (cronJob.status.lastScheduleTick ?? 0) < interval) continue;
    const activeJobs = cronJob.status.active.map(key => state.resources[key]).filter((resource): resource is JobResource => resource?.kind === "Job" && resource.status.active > 0);
    if ((cronJob.spec.concurrencyPolicy ?? "Allow") === "Forbid" && activeJobs.length > 0) continue;
    if ((cronJob.spec.concurrencyPolicy ?? "Allow") === "Replace") {
      for (const job of activeJobs) {
        for (const pod of values<PodResource>(state, "Pod").filter(item => owns(item, job.metadata.uid))) delete state.resources[resourceKey(pod)];
        delete state.resources[resourceKey(job)];
      }
      cronJob.status.active = [];
    }
    const name = `${cronJob.metadata.name}-${state.tick}`;
    const job: JobResource = {
      apiVersion: "batch/v1", kind: "Job", metadata: createMetadata(state, name, cronJob.metadata.namespace ?? "default", cronJob.spec.jobTemplate.template.metadata.labels),
      spec: structuredClone(cronJob.spec.jobTemplate),
      status: { active: 0, succeeded: 0, failed: 0, conditions: [] },
      ownerReferences: [{ uid: cronJob.metadata.uid, kind: "CronJob", name: cronJob.metadata.name }],
    };
    putResource(state, job);
    cronJob.status.lastScheduleTick = state.tick;
    cronJob.status.active = [...cronJob.status.active, resourceKey(job)];
    putResource(state, cronJob);
    appendEvent(state, "Normal", "SuccessfulCreate", `CronJob ${cronJob.metadata.name} created Job ${name}`, cronJob.metadata.name);
  }
}

export function reconcileJobs(state: EngineState): void {
  for (const job of values<JobResource>(state, "Job")) {
    const pods = values<PodResource>(state, "Pod").filter(pod => owns(pod, job.metadata.uid));
    const succeeded = pods.filter(pod => pod.status.phase === "Succeeded").length;
    const failed = pods.filter(pod => pod.status.phase === "Failed").length;
    const activePods = pods.filter(active);
    const desired = Math.max(1, job.spec.completions);
    const parallelism = Math.max(1, job.spec.parallelism);
    if (succeeded < desired && failed <= Math.max(0, job.spec.backoffLimit)) {
      const need = Math.min(parallelism - activePods.length, desired - succeeded - activePods.length);
      for (let i = 0; i < need; i++) {
        const index = pods.length + i;
        const spec = structuredClone(job.spec.template.spec);
        if (job.spec.durationTicks !== undefined && spec.containers.length) {
          spec.containers[0].runForTicks = job.spec.durationTicks;
          spec.containers[0].exitCode = 0;
        }
        spec.restartPolicy = "Never";
        const pod = makePod(state, `${job.metadata.name}-${index}`, job.metadata.namespace ?? "default", job.spec.template.metadata.labels, spec, { uid: job.metadata.uid, kind: "Job", name: job.metadata.name });
        putResource(state, pod);
        appendEvent(state, "Normal", "SuccessfulCreate", `Job ${job.metadata.name} created pod ${pod.metadata.name}`, job.metadata.name);
      }
    }
    const wasComplete = job.status.conditions.some(condition => condition.type === "Complete" && condition.status);
    const updatedPods = values<PodResource>(state, "Pod").filter(pod => owns(pod, job.metadata.uid));
    const done = updatedPods.filter(pod => pod.status.phase === "Succeeded").length;
    const failedCount = updatedPods.filter(pod => pod.status.phase === "Failed").length;
    const activeCount = updatedPods.filter(active).length;
    job.status = { active: activeCount, succeeded: done, failed: failedCount, conditions: done >= desired ? [{ type: "Complete", status: true, reason: "CompletionsReached" }] : failedCount > job.spec.backoffLimit ? [{ type: "Failed", status: true, reason: "BackoffLimitExceeded" }] : [] };
    putResource(state, job);
    if (job.ownerReferences?.[0]?.kind === "CronJob") {
      const cron = values<CronJobResource>(state, "CronJob").find(item => item.metadata.uid === job.ownerReferences?.[0]?.uid);
      if (cron) {
        cron.status.active = cron.status.active.filter(key => key !== resourceKey(job) || job.status.active > 0);
        if (!wasComplete && job.status.conditions.some(condition => condition.type === "Complete")) cron.status.lastSuccessfulTime = state.tick;
        putResource(state, cron);
      }
    }
  }
}

export function reconcilePersistentVolumeClaims(state: EngineState): void {
  for (const claim of values<PersistentVolumeClaimResource>(state, "PersistentVolumeClaim")) {
    if (claim.status.phase === "Pending" && state.tick - claim.metadata.creationTimestamp >= 3) {
      claim.status = { phase: "Bound", volumeName: `pv-${claim.metadata.uid}`, boundAtTick: state.tick };
      putResource(state, claim);
      appendEvent(state, "Normal", "Bound", `PersistentVolumeClaim ${claim.metadata.name} bound to ${claim.status.volumeName}`, claim.metadata.name);
    }
  }
}

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
