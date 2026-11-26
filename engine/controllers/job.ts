import type { CronJobResource, EngineState, JobResource, PodResource } from "../types";
import { appendEvent, putResource, resourceKey } from "../resources";
import { active, owns, values } from "./shared";

export function reconcileJobs(state: EngineState): void {
  for (const job of values<JobResource>(state, "Job")) {
    const alreadyComplete = job.status.conditions.some(condition => condition.type === "Complete" && condition.status);
    if (alreadyComplete) {
      if (state.tick - job.metadata.creationTimestamp > 30) {
        for (const pod of values<PodResource>(state, "Pod").filter(item => owns(item, job.metadata.uid))) delete state.resources[resourceKey(pod)];
        delete state.resources[resourceKey(job)];
      }
      continue;
    }
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
        if (!wasComplete && job.status.conditions.some(condition => condition.type === "Complete")) {
          cron.status.lastSuccessfulTime = state.tick;
          cron.status.successfulJobs = (cron.status.successfulJobs ?? 0) + 1;
        }
        putResource(state, cron);
      }
    }
  }
}
