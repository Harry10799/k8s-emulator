import type { EngineState, PodResource } from "./types";
import { evaluateProbe } from "./probes";
import { appendEvent, putResource } from "./resources";
import { imageAvailable, imagePullDurationTicks, isImageCached, cacheImage } from "./image-registry";
import type { RandomSource } from "./types";

function setPodReady(pod: PodResource, ready: boolean, reason: string): void {
  const condition = pod.status.conditions.find((item) => item.type === "Ready");
  if (condition) { condition.status = ready; condition.reason = reason; }
  else pod.status.conditions.push({ type: "Ready", status: ready, reason });
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

/** Inject one seeded, realistic container failure during chaos-mode ticks. */
export function injectChaosFailure(state: EngineState, rng: RandomSource): void {
  if (!state.chaos || state.tick % 3 !== 0) return;
  const runningPods = Object.values(state.resources).filter(
    (resource): resource is PodResource => resource.kind === "Pod" && resource.status.phase === "Running",
  );
  if (!runningPods.length || rng.next() >= 0.5) return;
  const victim = runningPods[Math.floor(rng.next() * runningPods.length)];
  const container = victim.status.containerStatuses.find(status => status.state === "Running");
  if (!container) return;
  restartContainer(victim, container, "Error", 1, state);
  appendEvent(state, "Warning", "ChaosMonkey", `Random container failure injected in pod ${victim.metadata.name}`, victim.metadata.name);
}

export function advancePodLifecycle(state: EngineState, pod: PodResource, rng: RandomSource): void {
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
      if (!imageAvailable(spec.image)) {
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
      if (!isImageCached(state, pod.spec.nodeName, spec.image)) {
        if (status.nextPullTick === undefined) {
          const duration = imagePullDurationTicks(spec.image);
          status.state = "Waiting";
          status.waitingReason = "ContainerCreating";
          status.ready = false;
          status.nextPullTick = state.tick + duration;
          appendEvent(state, "Normal", "Pulling", `Pulling image "${spec.image}" for container ${spec.name} (${duration} tick(s))`, pod.metadata.name);
          if (duration > 0) continue;
        }
        if (state.tick < (status.nextPullTick ?? state.tick)) continue;
        cacheImage(state, pod.spec.nodeName, spec.image);
      }
      status.nextPullTick = undefined;
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
    const crashRate = Math.max(0, Math.min(1, spec.simulatedCrashRate ?? 0));
    if (crashRate > 0 && rng.next() < crashRate) {
      restartContainer(pod, status, "Error", 1, state);
      continue;
    }

    const startup = spec.startupProbe;
    if (startup && state.tick - started >= (startup.initialDelayTicks ?? 0)) {
      const result = evaluateProbe(status, "startup", startup, state.tick, started, 3);
      if (result.thresholdReached) {
        restartContainer(pod, status, "StartupProbeFailed", 1, state);
        continue;
      }
    }
    const startupComplete = !startup || (status.consecutiveProbeFailures?.startup ?? 0) === 0 && state.tick - started >= (startup.initialDelayTicks ?? 0);
    if (!startupComplete) { status.ready = false; continue; }

    const readiness = spec.readinessProbe;
    let ready = true;
    if (readiness) {
      const result = evaluateProbe(status, "readiness", readiness, state.tick, started, 1);
      ready = !result.thresholdReached;
    }
    const liveness = spec.livenessProbe;
    if (liveness) {
      const result = evaluateProbe(status, "liveness", liveness, state.tick, started, 3);
      if (result.thresholdReached) {
        restartContainer(pod, status, "LivenessProbeFailed", 1, state);
        continue;
      }
    }
    status.ready = ready;
  }
  const allRunning = containers.every((spec) => pod.status.containerStatuses.find((item) => item.name === spec.name)?.state === "Running");
  const allReady = containers.every((spec) => pod.status.containerStatuses.find((item) => item.name === spec.name)?.ready);
  const hasStarted = containers.some((spec) => pod.status.containerStatuses.find((item) => item.name === spec.name)?.startedAtTick !== undefined);
  if (pod.status.phase !== "Failed" && pod.status.phase !== "Succeeded") {
    pod.status.phase = allRunning || hasStarted ? "Running" : "Pending";
  }
  setPodReady(pod, allRunning && allReady, allReady ? "ContainersReady" : "ContainersNotReady");
  putResource(state, pod);
}

