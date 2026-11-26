import { describe, expect, it } from "bun:test";
import { advanceCanvasRuntime, resetCanvasRuntime } from "../engine/canvas-runtime";
import { createSeededRng } from "../engine";
import type { CanvasControllers } from "../engine/canvas-runtime";

describe("persistent canvas runtime", () => {
  it("retains kubelet container state across canvas ticks", () => {
    resetCanvasRuntime();
    const nodes = [{ id: "worker-1", name: "worker-1", role: "worker" as const, cpuCapacity: 2000, memCapacity: 2048 }];
    const pod = { id: "pod-1", name: "web", namespace: "default", labels: { app: "web" }, phase: "Pending" as const, image: "nginx:1.27", cpuRequest: 100, memRequest: 64, restarts: 0, crashRate: 0, phaseTicks: 0, ageTicks: 0, requiredNode: null, completionTicks: null, nodeId: null, logs: [] };
    const first = advanceCanvasRuntime(nodes, [pod], 1, createSeededRng(1));
    expect(first.pods[0].phase).toBe("Running");
    const second = advanceCanvasRuntime(nodes, first.pods, 2, createSeededRng(2));
    expect(second.pods[0].phase).toBe("Running");
    expect(second.pods[0].nodeId).toBe("worker-1");
    resetCanvasRuntime();
  });

  it("runs DaemonSet controllers through the retained canvas EngineState", () => {
    resetCanvasRuntime();
    const nodes = [{ id: "worker-1", name: "worker-1", role: "worker" as const, cpuCapacity: 2000, memCapacity: 2048 }];
    const controllers: CanvasControllers = {
      daemonSets: [{ id: "ds-agent", name: "agent", namespace: "default", labels: { app: "agent" }, selector: { app: "agent" }, image: "nginx:1.27", cpuRequest: 50, memRequest: 32, crashRate: 0 }],
      statefulSets: [], cronJobs: [], jobs: [], pvcs: [], services: [],
    };
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
    const nodes = [{ id: "worker-1", name: "worker-1", role: "worker" as const, cpuCapacity: 2000, memCapacity: 2048 }];
    const controllers: CanvasControllers = {
      daemonSets: [], statefulSets: [], cronJobs: [],
      jobs: [{ id: "job-once", name: "once", namespace: "default", image: "busybox:1.36", duration: 1, status: "Active", cronjobOwner: null, createdTick: 0, cpuRequest: 50, memRequest: 32 }],
      pvcs: [], services: [],
    };
    const first = advanceCanvasRuntime(nodes, [], 1, createSeededRng(31), controllers);
    const second = advanceCanvasRuntime(nodes, first.pods, 2, createSeededRng(32), first.controllers);
    expect(second.controllers?.jobs[0].status).toBe("Complete");
    const afterCanvasGc = advanceCanvasRuntime(nodes, [], 3, createSeededRng(33), second.controllers);
    expect(afterCanvasGc.controllers?.jobs[0].status).toBe("Complete");
    resetCanvasRuntime();
  });

});
