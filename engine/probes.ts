import type { ContainerStatus, ProbeSpec } from "./types";

export type ProbeKind = "startup" | "readiness" | "liveness";

export interface ProbeEvaluation {
  checked: boolean;
  consecutiveFailures: number;
  thresholdReached: boolean;
}

/** Evaluate one probe cadence and update only that probe's independent state. */
export function evaluateProbe(
  status: ContainerStatus,
  kind: ProbeKind,
  probe: ProbeSpec,
  tick: number,
  startedAtTick: number,
  defaultFailureThreshold: number,
): ProbeEvaluation {
  const failures = status.consecutiveProbeFailures ??= { startup: 0, readiness: 0, liveness: 0 };
  const lastProbeTick = status.lastProbeTick ??= { startup: -1, readiness: -1, liveness: -1 };
  const delay = Math.max(0, probe.initialDelayTicks ?? 0);
  const period = Math.max(1, probe.periodTicks ?? 1);
  if (tick - startedAtTick < delay || (lastProbeTick[kind] >= 0 && tick - lastProbeTick[kind] < period)) {
    return { checked: false, consecutiveFailures: failures[kind], thresholdReached: failures[kind] >= Math.max(1, probe.failureThreshold ?? defaultFailureThreshold) };
  }
  lastProbeTick[kind] = tick;
  if (probe.failureTicks?.includes(tick)) failures[kind] += 1;
  else failures[kind] = 0;
  const threshold = Math.max(1, probe.failureThreshold ?? defaultFailureThreshold);
  return { checked: true, consecutiveFailures: failures[kind], thresholdReached: failures[kind] >= threshold };
}
