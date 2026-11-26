import { describe, expect, it } from "bun:test";
import { advanceCanvasRuntime, getCanvasRuntimeState, resetCanvasRuntime, setCanvasRuntimeState, subscribeCanvasRuntime, type CanvasControllers } from "../engine/canvas-runtime";
import { createInitialState, createSeededRng, injectChaosFailure, type NodeResource, type PodResource } from "../engine";

const nodes = [{ id: "worker-1", name: "worker-1", role: "worker" as const, cpuCapacity: 2000, memCapacity: 2048 }];
const emptyControllers = (): CanvasControllers => ({ daemonSets: [], statefulSets: [], cronJobs: [], jobs: [], pvcs: [], services: [] });

describe("persistent canvas runtime", () => {
  it("injects chaos failures through kubelet container restart semantics", () => {
    const node: NodeResource = {
      apiVersion: "v1", kind: "Node",
      metadata: { name: "worker", uid: "worker", resourceVersion: 1, generation: 1, labels: {}, annotations: {}, creationTimestamp: 0 },
      spec: { capacity: { cpuMilli: 2000, memoryMi: 2048 } },
      status: { conditions: [{ type: "Ready", status: true }] },
    };
    const pod: PodResource = {
      apiVersion: "v1", kind: "Pod",
      metadata: { name: "web", namespace: "default", uid: "web", resourceVersion: 1, generation: 1, labels: {}, annotations: {}, creationTimestamp: 0 },
      spec: { nodeName: "worker", containers: [{ name: "main", image: "nginx:1.27", resources: { requests: { cpuMilli: 100, memoryMi: 64 } } }] },
      status: { phase: "Running", conditions: [{ type: "Ready", status: true }], containerStatuses: [{ name: "main", ready: true, restartCount: 0, state: "Running", startedAtTick: 1 }] },
    };
    const state = createInitialState([node, pod]);
    state.tick = 3;
    state.chaos = true;
    injectChaosFailure(state, { next: () => 0 });
    const failed = Object.values(state.resources).find((resource): resource is PodResource => resource.kind === "Pod");
    expect(failed?.status.phase).toBe("Running");
    expect(failed?.status.containerStatuses[0]).toMatchObject({ restartCount: 1, waitingReason: "CrashLoopBackOff" });
  });

  it("retains kubelet container state across canvas ticks", () => {
    resetCanvasRuntime();
    const pod = { id: "pod-1", name: "web", namespace: "default", labels: { app: "web" }, phase: "Pending" as const, image: "nginx:1.27", cpuRequest: 100, memRequest: 64, restarts: 0, crashRate: 0, phaseTicks: 0, ageTicks: 0, requiredNode: null, completionTicks: null, nodeId: null, logs: [] };
    const first = advanceCanvasRuntime(nodes, [pod], 1, createSeededRng(1));
    expect(first.pods[0].phase).toBe("Running");
    const second = advanceCanvasRuntime(nodes, first.pods, 2, createSeededRng(2));
    expect(second.pods[0].phase).toBe("Running");
    expect(second.pods[0].nodeId).toBe("worker-1");
    resetCanvasRuntime();
  });

  it("reconciles Deployment and ReplicaSet resources in the retained engine", () => {
    resetCanvasRuntime();
    const controllers = emptyControllers();
    controllers.deployments = [{
      id: "deployment-web", name: "web", namespace: "default", labels: { app: "web" }, selector: { app: "web" },
      replicas: 2, image: "nginx:1.27", cpuRequest: 100, memRequest: 64, crashRate: 0, revision: 1,
    }];
    const first = advanceCanvasRuntime(nodes, [], 1, createSeededRng(11), controllers);
    expect(first.controllers?.replicaSets).toHaveLength(1);
    expect(first.controllers?.replicaSets?.[0]).toMatchObject({ parentDeployment: "deployment-web", replicas: 2 });
    expect(first.pods).toHaveLength(2);
    const second = advanceCanvasRuntime(nodes, first.pods, 2, createSeededRng(12), first.controllers);
    expect(second.controllers?.replicaSets).toHaveLength(1);
    expect(second.pods).toHaveLength(2);
    resetCanvasRuntime();
  });

  it("runs DaemonSet controllers through the retained canvas EngineState", () => {
    resetCanvasRuntime();
    const controllers = emptyControllers();
    controllers.daemonSets.push({ id: "ds-agent", name: "agent", namespace: "default", labels: { app: "agent" }, selector: { app: "agent" }, image: "nginx:1.27", cpuRequest: 50, memRequest: 32, crashRate: 0 });
    const first = advanceCanvasRuntime(nodes, [], 1, createSeededRng(21), controllers);
    expect(first.pods).toHaveLength(1);
    expect(first.pods[0]).toMatchObject({ ownerId: "ds-agent", ownerKind: "daemonset", phase: "Running", nodeId: "worker-1" });
    const second = advanceCanvasRuntime(nodes, first.pods, 2, createSeededRng(22), first.controllers);
    expect(second.pods).toHaveLength(1);
    expect(second.pods[0].id).toBe(first.pods[0].id);
    resetCanvasRuntime();
  });

  it("retains completed Job status after the canvas removes its succeeded Pod", () => {
    resetCanvasRuntime();
    const controllers = emptyControllers();
    controllers.jobs.push({ id: "job-once", name: "once", namespace: "default", image: "busybox:1.36", duration: 1, status: "Active", cronjobOwner: null, createdTick: 0, cpuRequest: 50, memRequest: 32 });
    const first = advanceCanvasRuntime(nodes, [], 1, createSeededRng(31), controllers);
    const second = advanceCanvasRuntime(nodes, first.pods, 2, createSeededRng(32), first.controllers);
    expect(second.controllers?.jobs[0].status).toBe("Complete");
    const afterCanvasGc = advanceCanvasRuntime(nodes, [], 3, createSeededRng(33), second.controllers);
    expect(afterCanvasGc.controllers?.jobs[0].status).toBe("Complete");
    resetCanvasRuntime();
  });
  it("publishes the same retained EngineState to external-store subscribers", () => {
    resetCanvasRuntime();
    const initial = getCanvasRuntimeState();
    let notifications = 0;
    const unsubscribe = subscribeCanvasRuntime(() => { notifications += 1; });
    const next = createInitialState();
    next.tick = 42;
    setCanvasRuntimeState(next);
    expect(getCanvasRuntimeState()).toBe(next);
    expect(notifications).toBe(1);
    unsubscribe();
    resetCanvasRuntime();
    expect(notifications).toBe(1);
    expect(initial).not.toBe(next);
  });

  it("preserves node heartbeat and cordon state across canvas projection ticks", () => {
    resetCanvasRuntime();
    const first = advanceCanvasRuntime(nodes, [], 1, createSeededRng(41));
    const current = getCanvasRuntimeState();
    const node = Object.values(current.resources).find((resource): resource is NodeResource => resource.kind === "Node");
    expect(node).toBeDefined();
    node!.spec.unschedulable = true;
    node!.status.heartbeatEnabled = false;
    setCanvasRuntimeState(current);
    advanceCanvasRuntime(nodes, first.pods, 2, createSeededRng(42));
    const projected = Object.values(getCanvasRuntimeState().resources).find((resource): resource is NodeResource => resource.kind === "Node");
    expect(projected?.spec.unschedulable).toBe(true);
    expect(projected?.status.heartbeatEnabled).toBe(false);
    resetCanvasRuntime();
  });

});
