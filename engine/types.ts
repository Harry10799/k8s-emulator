/**
 * Kubernetes-like API objects used by the deterministic simulation engine.
 * This is an educational model, not a Kubernetes API compatibility layer.
 */

export type Labels = Record<string, string>;

export interface ObjectMetadata {
  name: string;
  namespace?: string;
  uid: string;
  resourceVersion: number;
  generation: number;
  labels: Labels;
  annotations: Record<string, string>;
  creationTimestamp: number;
}

export interface OwnerReference {
  uid: string;
  kind: string;
  name: string;
}

export interface ResourceRequirements {
  requests: { cpuMilli: number; memoryMi: number };
  limits?: { cpuMilli?: number; memoryMi?: number };
}

export interface ProbeSpec {
  /** Simulation ticks before the first probe. */
  initialDelayTicks?: number;
  /** Probe cadence in simulation ticks. */
  periodTicks?: number;
  /** Consecutive failures before the probe fails. */
  failureThreshold?: number;
  /** Explicit ticks at which this probe fails; useful for deterministic scenarios. */
  failureTicks?: number[];
}

export interface ContainerSpec {
  name: string;
  image: string;
  resources: ResourceRequirements;
  startupProbe?: ProbeSpec;
  readinessProbe?: ProbeSpec;
  livenessProbe?: ProbeSpec;
  /** Optional deterministic workload behavior for educational scenarios. */
  simulatedMemoryUsageMi?: number;
  runForTicks?: number;
  exitCode?: number;
}

export interface Toleration {
  key?: string;
  operator?: "Equal" | "Exists";
  value?: string;
  effect?: "NoSchedule" | "PreferNoSchedule" | "NoExecute";
}

export interface PodSpec {
  containers: ContainerSpec[];
  initContainers?: ContainerSpec[];
  nodeName?: string;
  nodeSelector?: Labels;
  tolerations?: Toleration[];
  restartPolicy?: "Always" | "OnFailure" | "Never";
}

export type PodPhase = "Pending" | "Running" | "Succeeded" | "Failed" | "Unknown";

export interface PodResource {
  apiVersion: "v1";
  kind: "Pod";
  metadata: ObjectMetadata;
  spec: PodSpec;
  status: {
    phase: PodPhase;
    conditions: Array<{ type: "Ready" | "PodScheduled"; status: boolean; reason?: string; message?: string }>;
    containerStatuses: Array<{
      name: string;
      ready: boolean;
      restartCount: number;
      state: "Waiting" | "Running" | "Terminated";
      waitingReason?: "ContainerCreating" | "ErrImagePull" | "ImagePullBackOff" | "CrashLoopBackOff";
      lastTerminationReason?: "Error" | "OOMKilled" | "Completed" | "LivenessProbeFailed";
      exitCode?: number;
      startedAtTick?: number;
      consecutiveProbeFailures?: { startup: number; readiness: number; liveness: number };
      lastProbeTick?: { startup: number; readiness: number; liveness: number };
      nextRestartTick?: number;
      imagePullAttempts?: number;
      nextPullTick?: number;
    }>;
  };
  ownerReferences?: OwnerReference[];
}

export interface NodeResource {
  apiVersion: "v1";
  kind: "Node";
  metadata: ObjectMetadata;
  spec: {
    unschedulable?: boolean;
    capacity: { cpuMilli: number; memoryMi: number };
    allocatable?: { cpuMilli: number; memoryMi: number };
    taints?: Array<{ key: string; value?: string; effect: "NoSchedule" | "PreferNoSchedule" | "NoExecute" }>;
  };
  status: { conditions: Array<{ type: "Ready"; status: boolean; reason?: string }> };
}

export interface ReplicaSetResource {
  apiVersion: "apps/v1";
  kind: "ReplicaSet";
  metadata: ObjectMetadata;
  spec: {
    replicas: number;
    selector: { matchLabels: Labels };
    template: { metadata: { labels: Labels }; spec: PodSpec };
  };
  status: {
    observedGeneration: number;
    replicas: number;
    readyReplicas: number;
    availableReplicas: number;
  };
  ownerReferences?: OwnerReference[];
}

export interface DeploymentResource {
  apiVersion: "apps/v1";
  kind: "Deployment";
  metadata: ObjectMetadata;
  spec: {
    replicas: number;
    selector: { matchLabels: Labels };
    template: { metadata: { labels: Labels }; spec: PodSpec };
    strategy?: { type: "RollingUpdate" | "Recreate"; maxSurge?: number; maxUnavailable?: number };
  };
  status: {
    observedGeneration: number;
    replicas: number;
    updatedReplicas: number;
    readyReplicas: number;
    availableReplicas: number;
    conditions: Array<{ type: "Available" | "Progressing"; status: boolean; reason?: string }>;
  };
}

export type KubernetesResource = PodResource | NodeResource | ReplicaSetResource | DeploymentResource;

export interface EngineEvent {
  id: string;
  tick: number;
  type: "Normal" | "Warning";
  reason: string;
  message: string;
  object: string;
}

export interface EngineState {
  tick: number;
  nextId: number;
  nextResourceVersion: number;
  resources: Record<string, KubernetesResource>;
  events: EngineEvent[];
}

export interface RandomSource {
  next(): number;
}
