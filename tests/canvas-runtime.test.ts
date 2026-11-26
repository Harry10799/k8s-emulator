import { describe, expect, it } from "bun:test";
import { advanceCanvasRuntime, resetCanvasRuntime } from "../engine/canvas-runtime";
import { createSeededRng } from "../engine";

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
});
