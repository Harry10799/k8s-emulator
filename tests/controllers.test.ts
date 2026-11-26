import { describe, expect, it } from "bun:test";
import { createInitialState, createSeededRng, step, type CronJobResource, type DaemonSetResource, type JobResource, type NodeResource, type PersistentVolumeClaimResource, type PodResource, type ServiceResource, type StatefulSetResource, type DeploymentResource } from "../engine";

function node(name: string): NodeResource {
  return {
    apiVersion: "v1", kind: "Node",
    metadata: { name, uid: `node-${name}`, resourceVersion: 1, generation: 1, labels: { "kubernetes.io/hostname": name }, annotations: {}, creationTimestamp: 0 },
    spec: { capacity: { cpuMilli: 4000, memoryMi: 4096 } },
    status: { conditions: [{ type: "Ready", status: true }] },
  };
}
function podTemplate(labels: Record<string,string> = { app: "worker" }): PodResource["spec"] {
  return { containers: [{ name: "main", image: "nginx:1.27", resources: { requests: { cpuMilli: 100, memoryMi: 64 } } }] };
}
function daemonSet(): DaemonSetResource {
  return { apiVersion: "apps/v1", kind: "DaemonSet", metadata: { name: "agent", namespace: "default", uid: "ds-agent", resourceVersion: 1, generation: 1, labels: { app: "agent" }, annotations: {}, creationTimestamp: 0 }, spec: { selector: { matchLabels: { app: "agent" } }, template: { metadata: { labels: { app: "agent" } }, spec: podTemplate({ app: "agent" }) } }, status: { desiredNumberScheduled: 0, currentNumberScheduled: 0, numberReady: 0, numberAvailable: 0, observedGeneration: 0 } };
}
function statefulSet(storage = false): StatefulSetResource {
  return { apiVersion: "apps/v1", kind: "StatefulSet", metadata: { name: "db", namespace: "default", uid: "sts-db", resourceVersion: 1, generation: 1, labels: { app: "db" }, annotations: {}, creationTimestamp: 0 }, spec: { replicas: 2, serviceName: "db-headless", selector: { matchLabels: { app: "db" } }, template: { metadata: { labels: { app: "db" } }, spec: podTemplate({ app: "db" }) }, ...(storage ? { volumeClaimTemplate: { storageGi: 5, storageClassName: "fast" } } : {}) }, status: { replicas: 0, readyReplicas: 0, currentReplicas: 0, observedGeneration: 0 } };
}
function pods(state: ReturnType<typeof createInitialState>) { return Object.values(state.resources).filter((r): r is PodResource => r.kind === "Pod"); }

describe("additional Kubernetes controllers", () => {
  it("keeps one DaemonSet Pod on each eligible node", () => {
    const state = step(createInitialState([node("worker-a"), node("worker-b"), daemonSet()]), createSeededRng(1));
    const owned = pods(state).filter(p => p.ownerReferences?.[0]?.uid === "ds-agent");
    expect(owned).toHaveLength(2);
    expect(new Set(owned.map(p => p.spec.nodeName))).toEqual(new Set(["worker-a", "worker-b"]));
    const ds = Object.values(state.resources).find((r): r is DaemonSetResource => r.kind === "DaemonSet");
    expect(ds?.status.desiredNumberScheduled).toBe(2);
  });

  it("starts StatefulSet ordinals in order and provisions a claim before mounting it", () => {
    let state = createInitialState([node("worker-a"), statefulSet(true)]);
    state = step(state, createSeededRng(2));
    expect(pods(state).filter(p => p.ownerReferences?.[0]?.uid === "sts-db")).toHaveLength(0);
    let claims = Object.values(state.resources).filter((r): r is PersistentVolumeClaimResource => r.kind === "PersistentVolumeClaim");
    expect(claims).toHaveLength(1);
    for (let i = 0; i < 9; i++) state = step(state, createSeededRng(2));
    const owned = pods(state).filter(p => p.ownerReferences?.[0]?.uid === "sts-db");
    expect(owned.map(p => p.metadata.name).sort()).toEqual(["db-0", "db-1"]);
    expect(owned[0].spec.volumeClaimName).toBe("data-db-0");
    claims = Object.values(state.resources).filter((r): r is PersistentVolumeClaimResource => r.kind === "PersistentVolumeClaim");
    expect(claims.every(c => c.status.phase === "Bound")).toBe(true);
  });

  it("runs a Job to completion and records succeeded status", () => {
    const job: JobResource = { apiVersion: "batch/v1", kind: "Job", metadata: { name: "batch", namespace: "default", uid: "job-batch", resourceVersion: 1, generation: 1, labels: {}, annotations: {}, creationTimestamp: 0 }, spec: { completions: 1, parallelism: 1, backoffLimit: 1, durationTicks: 1, template: { metadata: { labels: { job: "batch" } }, spec: { containers: [{ name: "task", image: "busybox:1.36", resources: { requests: { cpuMilli: 50, memoryMi: 32 } } }], restartPolicy: "Never" } } }, status: { active: 0, succeeded: 0, failed: 0, conditions: [] } };
    let state = createInitialState([node("worker-a"), job]);
    for (let i = 0; i < 5; i++) state = step(state, createSeededRng(3));
    const actual = Object.values(state.resources).find((r): r is JobResource => r.kind === "Job");
    expect(actual?.status.succeeded).toBe(1);
    expect(actual?.status.conditions.some(c => c.type === "Complete" && c.status)).toBe(true);
  });

  it("creates CronJob runs at the configured interval and tracks the active Job", () => {
    const cron: CronJobResource = { apiVersion: "batch/v1", kind: "CronJob", metadata: { name: "cleanup", namespace: "default", uid: "cron-cleanup", resourceVersion: 1, generation: 1, labels: {}, annotations: {}, creationTimestamp: 0 }, spec: { schedule: "*/2", concurrencyPolicy: "Forbid", jobTemplate: { completions: 1, parallelism: 1, backoffLimit: 1, durationTicks: 2, template: { metadata: { labels: { cron: "cleanup" } }, spec: { containers: [{ name: "task", image: "busybox:1.36", resources: { requests: { cpuMilli: 50, memoryMi: 32 } } }], restartPolicy: "Never" } } } }, status: { active: [] } };
    let state = createInitialState([node("worker-a"), cron]);
    for (let i = 0; i < 2; i++) state = step(state, createSeededRng(4));
    expect(Object.values(state.resources).filter(r => r.kind === "Job")).toHaveLength(1);
    for (let i = 0; i < 5; i++) state = step(state, createSeededRng(4));
    expect(Object.values(state.resources).filter(r => r.kind === "Job").length).toBeGreaterThanOrEqual(1);
    const actual = Object.values(state.resources).find((r): r is CronJobResource => r.kind === "CronJob");
    expect(actual?.status.lastScheduleTick).toBeDefined();
  });

  it("publishes only Ready matching Pods as Service endpoints and allocates a LoadBalancer IP", () => {
    const svc: ServiceResource = { apiVersion: "v1", kind: "Service", metadata: { name: "web", namespace: "default", uid: "svc-web", resourceVersion: 1, generation: 1, labels: {}, annotations: {}, creationTimestamp: 0 }, spec: { type: "LoadBalancer", selector: { app: "web" }, port: 80, targetPort: 8080 }, status: { clusterIP: "", endpoints: [] } };
    const appPod: PodResource = { apiVersion: "v1", kind: "Pod", metadata: { name: "web-0", namespace: "default", uid: "web-0", resourceVersion: 1, generation: 1, labels: { app: "web" }, annotations: {}, creationTimestamp: 0 }, spec: podTemplate({ app: "web" }), status: { phase: "Pending", conditions: [], containerStatuses: [] } };
    let state = createInitialState([node("worker-a"), svc, appPod]);
    for (let i = 0; i < 7; i++) state = step(state, createSeededRng(5));
    const actual = Object.values(state.resources).find((r): r is ServiceResource => r.kind === "Service");
    expect(actual?.status.clusterIP).toMatch(/^10\.96\./);
    expect(actual?.status.nodePort).toBeGreaterThanOrEqual(30000);
    expect(actual?.status.externalIP).toMatch(/^203\.0\.113\./);
    expect(actual?.status.endpoints).toHaveLength(1);
    expect(actual?.status.endpoints[0].port).toBe(8080);
  });

  it("copies ConfigMap and Secret envFrom references from a Deployment template to its Pods", () => {
    const deployment: DeploymentResource = {
      apiVersion: "apps/v1", kind: "Deployment",
      metadata: { name: "web", namespace: "default", uid: "dep-web", resourceVersion: 1, generation: 1, labels: { app: "web" }, annotations: {}, creationTimestamp: 0 },
      spec: {
        replicas: 1, selector: { matchLabels: { app: "web" } },
        template: { metadata: { labels: { app: "web" } }, spec: {
          containers: [{ name: "main", image: "nginx:1.27", resources: { requests: { cpuMilli: 100, memoryMi: 64 } } }],
          envFrom: [{ configMapRef: { name: "web-config" } }, { secretRef: { name: "web-secret" } }],
        } },
      },
      status: { observedGeneration: 0, replicas: 0, updatedReplicas: 0, readyReplicas: 0, availableReplicas: 0, conditions: [] },
    };
    let state = createInitialState([node("worker-a"), deployment]);
    for (let i = 0; i < 4; i++) state = step(state, createSeededRng(17));
    const created = pods(state).filter(pod => pod.ownerReferences?.some(owner => owner.kind === "ReplicaSet"));
    expect(created.length).toBeGreaterThan(0);
    expect(created.every(pod => pod.spec.envFrom?.some(ref => ref.configMapRef?.name === "web-config"))).toBe(true);
    expect(created.every(pod => pod.spec.envFrom?.some(ref => ref.secretRef?.name === "web-secret"))).toBe(true);
  });
});
