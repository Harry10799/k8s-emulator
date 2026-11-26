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
  /** Requested CPU usage for this tick; defaults to the CPU request. */
  simulatedCpuUsageMilli?: number;
  runForTicks?: number;
  exitCode?: number;
  /** Probability of a process crash on each running tick; consumed from the injected RNG. */
  simulatedCrashRate?: number;
}

export interface Toleration {
  key?: string;
  operator?: "Equal" | "Exists";
  value?: string;
  effect?: "NoSchedule" | "PreferNoSchedule" | "NoExecute";
  tolerationSeconds?: number;
}

export interface PodSpec {
  containers: ContainerSpec[];
  initContainers?: ContainerSpec[];
  nodeName?: string;
  nodeSelector?: Labels;
  tolerations?: Toleration[];
  restartPolicy?: "Always" | "OnFailure" | "Never";
  volumeClaimName?: string;
}

export type PodPhase = "Pending" | "Running" | "Succeeded" | "Failed" | "Unknown";

export interface ContainerStatus {
  name: string;
  usage?: { cpuMilli: number; memoryMi: number; cpuThrottledMilli: number };
  ready: boolean;
  restartCount: number;
  state: "Waiting" | "Running" | "Terminated";
  waitingReason?: "ContainerCreating" | "ErrImagePull" | "ImagePullBackOff" | "CrashLoopBackOff";
  lastTerminationReason?: "Error" | "OOMKilled" | "Completed" | "LivenessProbeFailed" | "StartupProbeFailed";
  exitCode?: number;
  startedAtTick?: number;
  consecutiveProbeFailures?: { startup: number; readiness: number; liveness: number };
  lastProbeTick?: { startup: number; readiness: number; liveness: number };
  nextRestartTick?: number;
  imagePullAttempts?: number;
  nextPullTick?: number;
}

export interface PodResource {
  apiVersion: "v1";
  kind: "Pod";
  metadata: ObjectMetadata;
  spec: PodSpec;
  status: {
    phase: PodPhase;
    conditions: Array<{ type: "Ready" | "PodScheduled"; status: boolean; reason?: string; message?: string }>;
    qosClass?: "Guaranteed" | "Burstable" | "BestEffort";
    resourceUsage?: { cpuMilli: number; memoryMi: number; cpuThrottledMilli: number };
    containerStatuses: ContainerStatus[];
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
  status: {
    conditions: Array<{ type: "Ready" | "MemoryPressure"; status: boolean; reason?: string; message?: string }>;
    resourceUsage?: { cpuMilli: number; memoryMi: number };
    lastHeartbeatTick?: number;
    heartbeatEnabled?: boolean;
    notReadySinceTick?: number;
  };
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


export interface DaemonSetResource {
  apiVersion: "apps/v1";
  kind: "DaemonSet";
  metadata: ObjectMetadata;
  spec: { selector: { matchLabels: Labels }; template: { metadata: { labels: Labels }; spec: PodSpec }; nodeSelector?: Labels };
  status: { desiredNumberScheduled: number; currentNumberScheduled: number; numberReady: number; numberAvailable: number; observedGeneration: number };
  ownerReferences?: OwnerReference[];
}

export interface StatefulSetResource {
  apiVersion: "apps/v1";
  kind: "StatefulSet";
  metadata: ObjectMetadata;
  spec: { replicas: number; serviceName: string; selector: { matchLabels: Labels }; template: { metadata: { labels: Labels }; spec: PodSpec }; volumeClaimTemplate?: { storageGi: number; storageClassName: string; claimName?: string } };
  status: { replicas: number; readyReplicas: number; currentReplicas: number; observedGeneration: number };
  ownerReferences?: OwnerReference[];
}

export interface JobResource {
  apiVersion: "batch/v1";
  kind: "Job";
  metadata: ObjectMetadata;
  spec: { completions: number; parallelism: number; backoffLimit: number; template: { metadata: { labels: Labels }; spec: PodSpec }; durationTicks?: number; cronJobOwner?: string };
  status: { active: number; succeeded: number; failed: number; conditions: Array<{ type: "Complete" | "Failed"; status: boolean; reason?: string }> };
  ownerReferences?: OwnerReference[];
}

export interface CronJobResource {
  apiVersion: "batch/v1";
  kind: "CronJob";
  metadata: ObjectMetadata;
  spec: { schedule: string; suspend?: boolean; concurrencyPolicy?: "Allow" | "Forbid" | "Replace"; jobTemplate: Omit<JobResource, "metadata" | "status" | "ownerReferences">["spec"] };
  status: { lastScheduleTick?: number; active: string[]; lastSuccessfulTime?: number; successfulJobs?: number };
}

export interface PersistentVolumeClaimResource {
  apiVersion: "v1";
  kind: "PersistentVolumeClaim";
  metadata: ObjectMetadata;
  spec: { storageGi: number; storageClassName: string; accessModes?: Array<"ReadWriteOnce" | "ReadOnlyMany" | "ReadWriteMany"> };
  status: { phase: "Pending" | "Bound"; volumeName?: string; boundAtTick?: number };
}

export interface ServiceResource {
  apiVersion: "v1";
  kind: "Service";
  metadata: ObjectMetadata;
  spec: { type: "ClusterIP" | "NodePort" | "LoadBalancer"; selector: Labels; port: number; targetPort: number; protocol?: "TCP" | "UDP" };
  status: { clusterIP: string; nodePort?: number; externalIP?: string; endpoints: Array<{ podName: string; podUid: string; nodeName?: string; port: number }> };
}

export type KubernetesResource = PodResource | NodeResource | ReplicaSetResource | DeploymentResource | DaemonSetResource | StatefulSetResource | JobResource | CronJobResource | PersistentVolumeClaimResource | ServiceResource;

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
  /** Images cached per Node UID, independent from the global registry catalogue. */
  imageCache: Record<string, string[]>;
  /** Enables deterministic chaos failures for the optional failure-injection scenario. */
  chaos?: boolean;
  controlPlane?: { apiServerAvailable: boolean; schedulerAvailable: boolean; controllerManagerAvailable: boolean; etcdAvailable: boolean };
  nodeController?: { heartbeatTimeoutTicks: number; podEvictionTimeoutTicks: number };
}

export interface RandomSource {
  next(): number;
}
