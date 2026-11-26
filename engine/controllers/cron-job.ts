import type { CronJobResource, EngineState, JobResource, PodResource } from "../types";
import { appendEvent, createMetadata, putResource, resourceKey } from "../resources";
import { owns, values } from "./shared";

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
