import type { EngineState, PodResource } from "./types";
import { appendEvent, putResource } from "./resources";

function setPodReady(pod: PodResource, ready: boolean, reason: string): void {
  const condition = pod.status.conditions.find((item) => item.type === "Ready");
  if (condition) { condition.status = ready; condition.reason = reason; }
  else pod.status.conditions.push({ type: "Ready", status: ready, reason });
}

function probeFails(probe: NonNullable<PodResource["spec"]["containers"][number]["readinessProbe"]>, tick: number, startedAt: number): boolean {
  const delay = Math.max(0, probe.initialDelayTicks ?? 0);
  const period = Math.max(1, probe.periodTicks ?? 1);
  if (tick - startedAt < delay) return false;
  if ((tick - startedAt - delay) % period !== 0) return false;
  return probe.failureTicks?.includes(tick) ?? false;
}

function restartContainer(pod: PodResource, status: PodResource["status"]["containerStatuses"][number], reason: NonNullable<typeof status.lastTerminationReason>, exitCode: number, state: EngineState): void {
  status.ready = false;
  status.state = "Terminated";
  status.lastTerminationReason = reason;
  status.exitCode = exitCode;
  status.restartCount += 1;
  const policy = pod.spec.restartPolicy ?? "Always";
  const shouldRestart = policy === "Always" || (policy === "OnFailure" && exitCode !== 0);
  if (!shouldRestart) {
    pod.status.phase = exitCode === 0 ? "Succeeded" : "Failed";
    appendEvent(state, exitCode === 0 ? "Normal" : "Warning", exitCode === 0 ? "Completed" : "Failed",
      `Container ${status.name} terminated with exit code ${exitCode}; restartPolicy=${policy}`, pod.metadata.name);
    return;
  }
  const backoff = Math.min(2 ** Math.max(0, status.restartCount - 1), 16);
  status.nextRestartTick = state.tick + backoff;
  status.waitingReason = "CrashLoopBackOff";
  // Once a container has started, a restart backoff does not revert Pod phase to Pending.
  pod.status.phase = status.startedAtTick !== undefined ? "Running" : "Pending";
  setPodReady(pod, false, reason);
  appendEvent(state, "Warning", reason === "OOMKilled" ? "OOMKilled" : "BackOff",
    `Container ${status.name} in pod ${pod.metadata.name} terminated (${reason}, exit ${exitCode}); restart in ${backoff} tick(s)`, pod.metadata.name);
}

export function advancePodLifecycle(state: EngineState, pod: PodResource): void {
  if (!pod.spec.nodeName || pod.status.phase === "Succeeded" || pod.status.phase === "Failed") return;
  const containers = pod.spec.containers;
  if (!containers.length) return;
  for (const spec of containers) {
    let status = pod.status.containerStatuses.find((item) => item.name === spec.name);
    if (!status) {
      status = { name: spec.name, ready: false, restartCount: 0, state: "Waiting", waitingReason: "ContainerCreating",
        consecutiveProbeFailures: { startup: 0, readiness: 0, liveness: 0 }, lastProbeTick: { startup: -1, readiness: -1, liveness: -1 } };
      pod.status.containerStatuses.push(status);
    }
    status.consecutiveProbeFailures ??= { startup: 0, readiness: 0, liveness: 0 };
    status.lastProbeTick ??= { startup: -1, readiness: -1, liveness: -1 };

    if (status.state === "Terminated" || status.state === "Waiting") {
      if (status.waitingReason === "CrashLoopBackOff" && state.tick < (status.nextRestartTick ?? state.tick + 1)) continue;
      if (/(^|[/:])(?:not-found|does-not-exist|invalid-image)(?=[:@/]|$)/i.test(spec.image)) {
        if (state.tick < (status.nextPullTick ?? state.tick)) continue;
        status.imagePullAttempts = (status.imagePullAttempts ?? 0) + 1;
        status.state = "Waiting";
        status.ready = false;
        status.waitingReason = status.imagePullAttempts === 1 ? "ErrImagePull" : "ImagePullBackOff";
        const backoff = Math.min(2 ** Math.max(0, status.imagePullAttempts - 1), 16);
        status.nextPullTick = state.tick + backoff;
        appendEvent(state, "Warning", status.waitingReason,
          `Failed to pull image "${spec.image}" for container ${spec.name}; retry in ${backoff} tick(s)`, pod.metadata.name);
        continue;
      }
      status.state = "Running";
      status.ready = false;
      status.waitingReason = undefined;
      status.startedAtTick = state.tick;
      status.nextRestartTick = undefined;
      status.consecutiveProbeFailures = { startup: 0, readiness: 0, liveness: 0 };
      status.lastProbeTick = { startup: -1, readiness: -1, liveness: -1 };
      appendEvent(state, "Normal", status.restartCount ? "Started" : "Pulled",
        `Container ${spec.name} started using image ${spec.image}`, pod.metadata.name);
    }

    if (status.state !== "Running") continue;
    const started = status.startedAtTick ?? state.tick;
    const limits = spec.resources.limits;
    if (limits?.memoryMi !== undefined && spec.simulatedMemoryUsageMi !== undefined && spec.simulatedMemoryUsageMi > limits.memoryMi) {
      restartContainer(pod, status, "OOMKilled", 137, state);
      continue;
    }
    if (spec.runForTicks !== undefined && state.tick - started >= spec.runForTicks) {
      restartContainer(pod, status, "Completed", spec.exitCode ?? 0, state);
      continue;
    }

    const startup = spec.startupProbe;
    const startupSucceeded = !startup || !startup.failureTicks?.includes(state.tick);
    if (startup && state.tick - started >= (startup.initialDelayTicks ?? 0)) {
      const last = status.lastProbeTick!.startup;
      const period = Math.max(1, startup.periodTicks ?? 1);
      if (last < 0 || state.tick - last >= period) {
        status.lastProbeTick!.startup = state.tick;
        if (!startupSucceeded) status.consecutiveProbeFailures!.startup += 1;
        else status.consecutiveProbeFailures!.startup = 0;
        if (status.consecutiveProbeFailures!.startup >= Math.max(1, startup.failureThreshold ?? 3)) {
          restartContainer(pod, status, "StartupProbeFailed", 1, state);
          continue;
        }
      }
    }
    const startupComplete = !startup || status.consecutiveProbeFailures!.startup === 0 && state.tick - started >= (startup.initialDelayTicks ?? 0);
    if (!startupComplete) { status.ready = false; continue; }

    const readiness = spec.readinessProbe;
    let ready = true;
    if (readiness) {
      const last = status.lastProbeTick!.readiness;
      const period = Math.max(1, readiness.periodTicks ?? 1);
      if (state.tick - started >= (readiness.initialDelayTicks ?? 0) && (last < 0 || state.tick - last >= period)) {
        status.lastProbeTick!.readiness = state.tick;
        if (probeFails(readiness, state.tick, started)) status.consecutiveProbeFailures!.readiness += 1;
        else status.consecutiveProbeFailures!.readiness = 0;
      }
      ready = status.consecutiveProbeFailures!.readiness < Math.max(1, readiness.failureThreshold ?? 1);
    }
    const liveness = spec.livenessProbe;
    if (liveness) {
      const last = status.lastProbeTick!.liveness;
      const period = Math.max(1, liveness.periodTicks ?? 1);
      if (state.tick - started >= (liveness.initialDelayTicks ?? 0) && (last < 0 || state.tick - last >= period)) {
        status.lastProbeTick!.liveness = state.tick;
        if (probeFails(liveness, state.tick, started)) status.consecutiveProbeFailures!.liveness += 1;
        else status.consecutiveProbeFailures!.liveness = 0;
      }
      if (status.consecutiveProbeFailures!.liveness >= Math.max(1, liveness.failureThreshold ?? 3)) {
        restartContainer(pod, status, "LivenessProbeFailed", 1, state);
        continue;
      }
    }
    status.ready = ready;
  }
  const allRunning = containers.every((spec) => pod.status.containerStatuses.find((item) => item.name === spec.name)?.state === "Running");
  const allReady = containers.every((spec) => pod.status.containerStatuses.find((item) => item.name === spec.name)?.ready);
  if (allRunning) pod.status.phase = "Running";
  else if (pod.status.phase !== "Failed" && pod.status.phase !== "Succeeded") pod.status.phase = "Pending";
  setPodReady(pod, allRunning && allReady, allReady ? "ContainersReady" : "ContainersNotReady");
  putResource(state, pod);
}

