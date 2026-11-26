import { createInitialState, step } from "./engine";
import { resourceKey } from "./resources";
import type {
  CronJobResource, DaemonSetResource, DeploymentResource, EngineEvent, EngineState, JobResource,
  NodeResource, PersistentVolumeClaimResource, PodResource, RandomSource, ReplicaSetResource,
  ServiceResource, StatefulSetResource,
} from "./types";

export interface CanvasNode {
  id: string; name: string; role: "control-plane" | "worker"; cpuCapacity: number; memCapacity: number;
}
export interface CanvasPod {
  id: string; name: string; namespace: string; labels: Record<string, string>;
  phase: "Pending" | "ContainerCreating" | "Running" | "CrashLoopBackOff" | "Terminating" | "Succeeded";
  image: string; cpuRequest: number; memRequest: number; restarts: number; crashRate: number;
  phaseTicks: number; ageTicks: number; requiredNode: string | null; completionTicks: number | null;
  nodeId: string | null; logs: string[];
  ownerId?: string | null; ownerKind?: "replicaset" | "daemonset" | "statefulset" | "job" | "deployment" | "none";
  envConfigMap?: string | null; envSecret?: string | null; ports?: number[]; mountedPvc?: string | null;
}
export interface CanvasDeployment {
  id: string; name: string; namespace: string; labels: Record<string,string>; selector: Record<string,string>;
  replicas: number; image: string; cpuRequest: number; memRequest: number; crashRate: number; revision: number;
}
export interface CanvasReplicaSet {
  id: string; name: string; namespace: string; labels: Record<string,string>; selector: Record<string,string>;
  replicas: number; image: string; cpuRequest: number; memRequest: number; crashRate: number;
  revision: number; parentDeployment: string | null; superseded: boolean;
}
export interface CanvasDaemonSet {
  id: string; name: string; namespace: string; labels: Record<string,string>; selector: Record<string,string>;
  image: string; cpuRequest: number; memRequest: number; crashRate: number;
}
export interface CanvasStatefulSet {
  id: string; name: string; namespace: string; labels: Record<string,string>; serviceName: string;
  replicas: number; image: string; cpuRequest: number; memRequest: number; crashRate: number; storageGi: number;
}
export interface CanvasCronJob {
  id: string; name: string; namespace: string; schedule: string; image: string;
  cpuRequest: number; memRequest: number; duration: number; lastRun: number; active: number; completions: number;
}
export interface CanvasJob {
  id: string; name: string; namespace: string; image: string; duration: number;
  status: "Active" | "Complete"; cronjobOwner: string | null; createdTick: number;
  cpuRequest?: number; memRequest?: number;
}
export interface CanvasPvc {
  id: string; name: string; namespace: string; sizeGi: number; storageClass: string;
  status: "Pending" | "Bound"; createdTick: number;
}
export interface CanvasService {
  id: string; name: string; namespace: string; type: "ClusterIP" | "NodePort" | "LoadBalancer";
  selector: Record<string,string>; port: number; targetPort: number; protocol: "TCP" | "UDP";
  clusterIP: string; nodePort: number | null; externalIP: string | null; lbTicks: number;
}
export interface CanvasControllers {
  daemonSets: CanvasDaemonSet[];
  statefulSets: CanvasStatefulSet[];
  cronJobs: CanvasCronJob[];
  jobs: CanvasJob[];
  pvcs: CanvasPvc[];
  services: CanvasService[];
}
export interface CanvasRuntimeResult<T extends CanvasPod = CanvasPod> {
  pods: T[];
  events: EngineEvent[];
  controllers?: CanvasControllers;
}

let engineState: EngineState | null = null;

function toNode(node: CanvasNode): NodeResource {
  return {
    apiVersion: "v1", kind: "Node",
    metadata: { name: node.name, uid: node.id, resourceVersion: 1, generation: 1, labels: { "kubernetes.io/hostname": node.name }, annotations: {}, creationTimestamp: 0 },
    spec: { capacity: { cpuMilli: node.cpuCapacity, memoryMi: node.memCapacity } },
    status: { conditions: [{ type: "Ready", status: true }] },
  };
}
function metadata(name: string, namespace: string, uid: string, labels: Record<string,string>, previous?: { metadata: { resourceVersion: number; generation: number; creationTimestamp: number; annotations: Record<string,string> } }, createdAt = 0) {
  return {
    name, namespace, uid, resourceVersion: previous?.metadata.resourceVersion ?? 1,
    generation: previous?.metadata.generation ?? 1, labels: { ...labels },
    annotations: { ...(previous?.metadata.annotations ?? {}) },
    creationTimestamp: previous?.metadata.creationTimestamp ?? createdAt,
  };
}
function ownerKind(kind: CanvasPod["ownerKind"]): string | undefined {
  if (!kind || kind === "none") return undefined;
  return ({ replicaset: "ReplicaSet", daemonset: "DaemonSet", statefulset: "StatefulSet", job: "Job", deployment: "Deployment" })[kind];
}
function toPod(pod: CanvasPod, nodes: CanvasNode[], previous?: PodResource): PodResource {
  const targetId = pod.nodeId ?? pod.requiredNode;
  const targetName = nodes.find(node => node.id === targetId)?.name;
  const imageChanged = previous?.spec.containers[0]?.image !== pod.image;
  const status = previous && !imageChanged ? structuredClone(previous.status) : {
    phase: "Pending" as const, conditions: [], containerStatuses: [],
  };
  if (pod.phase === "CrashLoopBackOff" && status.phase === "Running") {
    const container = status.containerStatuses[0];
    if (container && container.waitingReason !== "CrashLoopBackOff") {
      container.state = "Terminated"; container.ready = false; container.waitingReason = "CrashLoopBackOff";
      container.restartCount = Math.max(container.restartCount, pod.restarts);
      container.lastTerminationReason = "Error";
      container.nextRestartTick = (engineState?.tick ?? 0) + Math.min(2 ** Math.max(0, pod.restarts - 1), 16);
    }
  } else if (pod.phase === "ContainerCreating" && status.phase === "Running") {
    for (const container of status.containerStatuses) {
      container.state = "Waiting"; container.ready = false; container.waitingReason = "ContainerCreating"; container.nextRestartTick = undefined;
    }
    status.phase = "Pending";
  }
  const kind = ownerKind(pod.ownerKind);
  return {
    apiVersion: "v1", kind: "Pod",
    metadata: metadata(pod.name, pod.namespace, pod.id, pod.labels, previous),
    spec: {
      containers: [{
        name: "main", image: pod.image,
        resources: { requests: { cpuMilli: pod.cpuRequest, memoryMi: pod.memRequest } },
        simulatedCrashRate: pod.crashRate,
        ...(pod.completionTicks !== null ? { runForTicks: pod.completionTicks, exitCode: 0 } : {}),
      }],
      restartPolicy: pod.completionTicks !== null ? "Never" : "Always",
      ...(targetName ? { nodeName: targetName } : {}),
      ...(pod.mountedPvc ? { volumeClaimName: pod.mountedPvc } : {}),
    },
    status,
    ownerReferences: previous?.ownerReferences ?? (kind && pod.ownerId ? [{ uid: pod.ownerId, kind, name: pod.ownerId }] : undefined),
  };
}
function phaseOf(resource: PodResource): CanvasPod["phase"] {
  const waiting = resource.status.containerStatuses[0]?.waitingReason;
  if (resource.status.phase === "Succeeded") return "Succeeded";
  if (resource.status.phase === "Failed") return "Terminating";
  if (waiting === "CrashLoopBackOff") return "CrashLoopBackOff";
  if (resource.status.phase === "Running") return "Running";
  if (resource.spec.nodeName) return "ContainerCreating";
  return "Pending";
}
function projectPod<T extends CanvasPod>(resource: PodResource, original: T | undefined, nodes: CanvasNode[], tick: number): T {
  const container = resource.spec.containers[0];
  const owner = resource.ownerReferences?.[0];
  const kind = ({ ReplicaSet: "replicaset", DaemonSet: "daemonset", StatefulSet: "statefulset", Job: "job", Deployment: "deployment" } as Record<string, CanvasPod["ownerKind"]>)[owner?.kind ?? ""] ?? "none";
  const node = nodes.find(item => item.name === resource.spec.nodeName);
  const restarts = Math.max(original?.restarts ?? 0, ...resource.status.containerStatuses.map(item => item.restartCount), 0);
  const phase = phaseOf(resource);
  const base: CanvasPod = original ?? {
    id: resource.metadata.uid, name: resource.metadata.name, namespace: resource.metadata.namespace ?? "default",
    labels: { ...resource.metadata.labels }, phase: "Pending", image: container?.image ?? "nginx:latest",
    cpuRequest: container?.resources.requests.cpuMilli ?? 0, memRequest: container?.resources.requests.memoryMi ?? 0,
    restarts: 0, crashRate: container?.simulatedCrashRate ?? 0, phaseTicks: 0,
    ageTicks: Math.max(0, tick - resource.metadata.creationTimestamp), requiredNode: node?.id ?? null,
    completionTicks: container?.runForTicks ?? null, nodeId: node?.id ?? null, logs: [],
    ownerId: owner?.uid ?? null, ownerKind: kind,
    envConfigMap: null, envSecret: null, ports: [], mountedPvc: resource.spec.volumeClaimName ?? null,
  };
  return {
    ...base, id: resource.metadata.uid, name: resource.metadata.name,
    namespace: resource.metadata.namespace ?? "default", labels: { ...resource.metadata.labels },
    phase, image: container?.image ?? base.image,
    cpuRequest: container?.resources.requests.cpuMilli ?? base.cpuRequest,
    memRequest: container?.resources.requests.memoryMi ?? base.memRequest,
    restarts, crashRate: container?.simulatedCrashRate ?? base.crashRate,
    ageTicks: original ? original.ageTicks + 1 : Math.max(0, tick - resource.metadata.creationTimestamp),
    phaseTicks: phase === base.phase ? base.phaseTicks + 1 : 0,
    requiredNode: kind === "daemonset" ? node?.id ?? base.requiredNode : base.requiredNode, nodeId: node?.id ?? base.nodeId,
    completionTicks: container?.runForTicks ?? base.completionTicks,
    ownerId: owner?.uid ?? null, ownerKind: kind,
    mountedPvc: resource.spec.volumeClaimName ?? base.mountedPvc,
  } as T;
}
function makeMeta(previous: { metadata: { resourceVersion: number; generation: number; creationTimestamp: number; annotations: Record<string,string> } } | undefined, name: string, namespace: string, id: string, labels: Record<string,string>, createdAt = 0) {
  return metadata(name, namespace, id, labels, previous, createdAt);
}
function controllerOwner(uid: string, kind: string, name: string) { return [{ uid, kind, name }]; }

function toDeployment(item: CanvasDeployment, previous?: DeploymentResource): DeploymentResource {
  const meta = makeMeta(previous,item.name,item.namespace,item.id,item.labels);
  meta.generation = Math.max(1,item.revision);
  return {
    apiVersion:"apps/v1",kind:"Deployment",metadata:meta,
    spec:{replicas:item.replicas,selector:{matchLabels:{...item.selector}},template:{metadata:{labels:{...item.labels}},spec:{containers:[{name:"main",image:item.image,resources:{requests:{cpuMilli:item.cpuRequest,memoryMi:item.memRequest}},simulatedCrashRate:item.crashRate}]}},strategy:{type:"RollingUpdate",maxSurge:1,maxUnavailable:0}},
    status:previous?.status ?? {observedGeneration:0,replicas:0,updatedReplicas:0,readyReplicas:0,availableReplicas:0,conditions:[]},
  };
}
function toReplicaSet(item: CanvasReplicaSet, previous?: ReplicaSetResource, parentName?: string): ReplicaSetResource {
  const meta = makeMeta(previous,item.name,item.namespace,item.id,item.labels);
  meta.annotations["deployment.kubernetes.io/revision"] = String(item.revision);
  return {
    apiVersion:"apps/v1",kind:"ReplicaSet",metadata:meta,
    spec:{replicas:item.replicas,selector:{matchLabels:{...item.selector}},template:{metadata:{labels:{...item.labels}},spec:{containers:[{name:"main",image:item.image,resources:{requests:{cpuMilli:item.cpuRequest,memoryMi:item.memRequest}},simulatedCrashRate:item.crashRate}]}}},
    status:previous?.status ?? {observedGeneration:1,replicas:0,readyReplicas:0,availableReplicas:0},
    ownerReferences:item.parentDeployment ? controllerOwner(item.parentDeployment,"Deployment",parentName ?? item.parentDeployment) : undefined,
  };
}
function toDaemonSet(item: CanvasDaemonSet, previous?: DaemonSetResource): DaemonSetResource {
  return { apiVersion: "apps/v1", kind: "DaemonSet", metadata: makeMeta(previous,item.name,item.namespace,item.id,item.labels), spec: { selector: { matchLabels: { ...item.selector } }, template: { metadata: { labels: { ...item.labels } }, spec: { containers: [{ name: "main", image: item.image, resources: { requests: { cpuMilli: item.cpuRequest, memoryMi: item.memRequest } }, simulatedCrashRate: item.crashRate }] } } }, status: previous?.status ?? { desiredNumberScheduled: 0, currentNumberScheduled: 0, numberReady: 0, numberAvailable: 0, observedGeneration: 0 } };
}
function toStatefulSet(item: CanvasStatefulSet, previous?: StatefulSetResource): StatefulSetResource {
  return { apiVersion: "apps/v1", kind: "StatefulSet", metadata: makeMeta(previous,item.name,item.namespace,item.id,item.labels), spec: { replicas: item.replicas, serviceName: item.serviceName, selector: { matchLabels: { app: item.labels.app ?? item.name } }, template: { metadata: { labels: { ...item.labels } }, spec: { containers: [{ name: "main", image: item.image, resources: { requests: { cpuMilli: item.cpuRequest, memoryMi: item.memRequest } }, simulatedCrashRate: item.crashRate }] } }, ...(item.storageGi > 0 ? { volumeClaimTemplate: { storageGi: item.storageGi, storageClassName: "standard" } } : {}) }, status: previous?.status ?? { replicas: 0, readyReplicas: 0, currentReplicas: 0, observedGeneration: 0 } };
}
function toJob(item: CanvasJob, previous?: JobResource): JobResource {
  const cronOwner = item.cronjobOwner ? controllerOwner(item.cronjobOwner,"CronJob",item.cronjobOwner) : undefined;
  return { apiVersion: "batch/v1", kind: "Job", metadata: makeMeta(previous,item.name,item.namespace,item.id,{},item.createdTick), spec: { completions: 1, parallelism: 1, backoffLimit: 1, durationTicks: item.duration, cronJobOwner: item.cronjobOwner ?? undefined, template: { metadata: { labels: { job: item.name } }, spec: { containers: [{ name: "task", image: item.image, resources: { requests: { cpuMilli: item.cpuRequest ?? 100, memoryMi: item.memRequest ?? 128 } } }], restartPolicy: "Never" } } }, status: previous?.status ?? { active: item.status === "Active" ? 1 : 0, succeeded: item.status === "Complete" ? 1 : 0, failed: 0, conditions: item.status === "Complete" ? [{ type: "Complete", status: true }] : [] }, ownerReferences: cronOwner };
}
function toCronJob(item: CanvasCronJob, previous?: CronJobResource): CronJobResource {
  return { apiVersion: "batch/v1", kind: "CronJob", metadata: makeMeta(previous,item.name,item.namespace,item.id,{}), spec: { schedule: item.schedule, concurrencyPolicy: "Forbid", jobTemplate: { completions: 1, parallelism: 1, backoffLimit: 1, durationTicks: item.duration, cronJobOwner: item.id, template: { metadata: { labels: { cronjob: item.name } }, spec: { containers: [{ name: "task", image: item.image, resources: { requests: { cpuMilli: item.cpuRequest, memoryMi: item.memRequest } } }], restartPolicy: "Never" } } } }, status: previous?.status ?? { lastScheduleTick: item.lastRun, active: [], successfulJobs: item.completions } };
}
function toPvc(item: CanvasPvc, previous?: PersistentVolumeClaimResource): PersistentVolumeClaimResource {
  return { apiVersion: "v1", kind: "PersistentVolumeClaim", metadata: makeMeta(previous,item.name,item.namespace,item.id,{},item.createdTick), spec: { storageGi: item.sizeGi, storageClassName: item.storageClass }, status: previous?.status ?? (item.status === "Bound" ? { phase: "Bound", volumeName: `pv-${item.id}`, boundAtTick: item.createdTick } : { phase: "Pending" }) };
}
function toService(item: CanvasService, previous?: ServiceResource, tick = 0): ServiceResource {
  const typeChanged = Boolean(previous && previous.spec.type !== item.type);
  const createdAt = typeChanged ? tick - 1 : previous?.metadata.creationTimestamp ?? tick - 1 - (item.type === "LoadBalancer" ? 5 - item.lbTicks : 0);
  const serviceMetadata = makeMeta(previous,item.name,item.namespace,item.id,{},createdAt);
  if (typeChanged) serviceMetadata.creationTimestamp = createdAt;
  const status = previous && !typeChanged ? previous.status : {
    clusterIP: previous?.status.clusterIP ?? item.clusterIP,
    ...(item.type !== "ClusterIP" && item.nodePort ? { nodePort: item.nodePort } : {}),
    ...(item.type === "LoadBalancer" && item.externalIP ? { externalIP: item.externalIP } : {}),
    endpoints: [],
  };
  return { apiVersion: "v1", kind: "Service", metadata: serviceMetadata, spec: { type: item.type, selector: { ...item.selector }, port: item.port, targetPort: item.targetPort, protocol: item.protocol }, status };
}

function projectControllers(input: CanvasControllers, state: EngineState): CanvasControllers {
  const resources = Object.values(state.resources);
  const byUid = <T extends { metadata: { uid: string } }>(uid: string, kind: string) => resources.find((resource) => resource.kind === kind && resource.metadata.uid === uid) as T | undefined;
  const replicaSets: CanvasReplicaSet[] = resources.filter((r): r is ReplicaSetResource => r.kind === "ReplicaSet").map(resource => {
    const container = resource.spec.template.spec.containers[0];
    const parent = resource.ownerReferences?.find(owner => owner.kind === "Deployment")?.uid ?? null;
    const deployment = (input.deployments ?? []).find(item => item.id === parent);
    const revision = Number(resource.metadata.annotations["deployment.kubernetes.io/revision"] ?? 1);
    return {
      id:resource.metadata.uid,name:resource.metadata.name,namespace:resource.metadata.namespace ?? "default",
      labels:{...resource.metadata.labels},selector:{...resource.spec.selector.matchLabels},replicas:resource.spec.replicas,
      image:container?.image ?? "nginx:latest",cpuRequest:container?.resources.requests.cpuMilli ?? 500,
      memRequest:container?.resources.requests.memoryMi ?? 512,crashRate:container?.simulatedCrashRate ?? 0,
      revision,parentDeployment:parent,superseded:Boolean(deployment && (container?.image !== deployment.image || revision < deployment.revision)),
    };
  });
  const jobs: CanvasJob[] = resources.filter((r): r is JobResource => r.kind === "Job").map(resource => ({
    id: resource.metadata.uid, name: resource.metadata.name, namespace: resource.metadata.namespace ?? "default",
    image: resource.spec.template.spec.containers[0]?.image ?? "busybox:1.36",
    duration: resource.spec.durationTicks ?? 1,
    status: resource.status.conditions.some(condition => condition.type === "Complete" && condition.status) ? "Complete" : "Active",
    cronjobOwner: resource.ownerReferences?.find(owner => owner.kind === "CronJob")?.uid ?? resource.spec.cronJobOwner ?? null,
    createdTick: resource.metadata.creationTimestamp,
    cpuRequest: resource.spec.template.spec.containers[0]?.resources.requests.cpuMilli ?? 100,
    memRequest: resource.spec.template.spec.containers[0]?.resources.requests.memoryMi ?? 128,
  }));
  const cronJobs = input.cronJobs.map(item => {
    const resource = byUid<CronJobResource>(item.id,"CronJob");
    const ownedJobs = jobs.filter(job => job.cronjobOwner === item.id);
    return resource ? { ...item, lastRun: resource.status.lastScheduleTick ?? item.lastRun, active: ownedJobs.filter(job => job.status === "Active").length, completions: resource.status.successfulJobs ?? ownedJobs.filter(job => job.status === "Complete").length } : item;
  });
  const pvcs: CanvasPvc[] = resources.filter((r): r is PersistentVolumeClaimResource => r.kind === "PersistentVolumeClaim").map(resource => ({
    id: resource.metadata.uid, name: resource.metadata.name, namespace: resource.metadata.namespace ?? "default",
    sizeGi: resource.spec.storageGi, storageClass: resource.spec.storageClassName,
    status: resource.status.phase, createdTick: resource.metadata.creationTimestamp,
  }));
  const services = input.services.map(item => {
    const resource = byUid<ServiceResource>(item.id,"Service");
    if (!resource) return item;
    const elapsed = state.tick - resource.metadata.creationTimestamp;
    return { ...item, clusterIP: resource.status.clusterIP, nodePort: resource.status.nodePort ?? null, externalIP: resource.status.externalIP ?? null, lbTicks: Math.max(0, 5 - elapsed) };
  });
  return { ...input, deployments: input.deployments ?? [], replicaSets, cronJobs, jobs, pvcs, services };
}

/** Synchronize the canvas projection into a retained EngineState, run one engine tick, and project resources back. */
export function advanceCanvasRuntime<T extends CanvasPod>(nodes: CanvasNode[], pods: T[], tick: number, rng: RandomSource, controllers?: CanvasControllers): CanvasRuntimeResult<T> {
  const workerNodes = nodes.filter(node => node.role === "worker");
  if (!engineState) engineState = createInitialState(workerNodes.map(toNode));
  const previousEvents = new Set(engineState.events.map(event => event.id));
  const oldResources = engineState.resources;
  const resources = { ...oldResources };
  const managedKinds = new Set(["Node", "Pod", "Deployment", "ReplicaSet", "DaemonSet", "StatefulSet", "Job", "CronJob", "PersistentVolumeClaim", "Service"]);
  for (const [key, resource] of Object.entries(resources)) if (managedKinds.has(resource.kind)) delete resources[key];
  for (const node of workerNodes) {
    const resource = toNode(node); resources[resourceKey(resource)] = resource;
    engineState.imageCache[node.id] ??= ["nginx:1.27", "nginx:1.28", "busybox", "busybox:1.36"];
  }
  const activePods = pods.filter(pod => pod.phase !== "Terminating");
  const previousPods = new Map<string, PodResource>(Object.values(oldResources).filter((resource): resource is PodResource => resource.kind === "Pod").map(pod => [pod.metadata.uid,pod] as const));
  for (const pod of activePods) {
    const resource = toPod(pod,workerNodes,previousPods.get(pod.id)); resources[resourceKey(resource)] = resource;
  }
  if (controllers) {
    const previousByUid = <T extends { metadata: { uid: string } }>(uid: string, kind: string) => Object.values(oldResources).find(resource => resource.kind === kind && resource.metadata.uid === uid) as T | undefined;
    for (const item of controllers.deployments ?? []) { const resource = toDeployment(item,previousByUid<DeploymentResource>(item.id,"Deployment")); resources[resourceKey(resource)] = resource; }
    for (const item of controllers.replicaSets ?? []) { const parentName = controllers.deployments?.find(deployment => deployment.id === item.parentDeployment)?.name; const resource = toReplicaSet(item,previousByUid<ReplicaSetResource>(item.id,"ReplicaSet"),parentName); resources[resourceKey(resource)] = resource; }
    for (const item of controllers.daemonSets) { const resource = toDaemonSet(item,previousByUid<DaemonSetResource>(item.id,"DaemonSet")); resources[resourceKey(resource)] = resource; }
    for (const item of controllers.statefulSets) { const resource = toStatefulSet(item,previousByUid<StatefulSetResource>(item.id,"StatefulSet")); resources[resourceKey(resource)] = resource; }
    for (const item of controllers.jobs) { const resource = toJob(item,previousByUid<JobResource>(item.id,"Job")); resources[resourceKey(resource)] = resource; }
    for (const item of controllers.cronJobs) { const resource = toCronJob(item,previousByUid<CronJobResource>(item.id,"CronJob")); resources[resourceKey(resource)] = resource; }
    for (const item of controllers.pvcs) { const resource = toPvc(item,previousByUid<PersistentVolumeClaimResource>(item.id,"PersistentVolumeClaim")); resources[resourceKey(resource)] = resource; }
    for (const item of controllers.services) { const resource = toService(item,previousByUid<ServiceResource>(item.id,"Service"),tick); resources[resourceKey(resource)] = resource; }
  }
  engineState = { ...engineState, tick: Math.max(0,tick - 1), resources, imageCache: Object.fromEntries(workerNodes.map(node => [node.id,engineState?.imageCache[node.id] ?? []])) };
  engineState = step(engineState,rng);
  const currentState = engineState;
  const originalById = new Map(pods.map(pod => [pod.id,pod]));
  const projected = Object.values(currentState.resources).filter((resource): resource is PodResource => resource.kind === "Pod").map(resource => projectPod(resource,originalById.get(resource.metadata.uid),workerNodes,tick));
  const byId = new Map(projected.map(pod => [pod.id,pod]));
  const nextPods = pods.map(pod => {
    if (pod.phase === "Terminating" || pod.phase === "Succeeded") return { ...pod, ageTicks: pod.ageTicks + 1, phaseTicks: pod.phaseTicks + 1 };
    return byId.get(pod.id) ?? pod;
  });
  // Include Pods created by DaemonSet/StatefulSet/Job controllers.
  const allPods = [...nextPods, ...projected.filter(pod => !originalById.has(pod.id))];
  const events = currentState.events.filter(event => !previousEvents.has(event.id));
  return { pods: allPods as T[], events, ...(controllers ? { controllers: projectControllers(controllers,currentState) } : {}) };
}

export function resetCanvasRuntime(): void { engineState = null; }
