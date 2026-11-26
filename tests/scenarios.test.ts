import { describe, expect, it } from "bun:test";
import { LEARNING_SCENARIOS } from "../src/lib/scenarios";
import type { ClusterState } from "../src/lib/cluster-store";

describe("Simulation Lab scenario catalog", () => {
  it("contains 50 uniquely identified learning missions", () => {
    expect(LEARNING_SCENARIOS).toHaveLength(50);
    expect(new Set(LEARNING_SCENARIOS.map(item => item.id)).size).toBe(50);
    expect(LEARNING_SCENARIOS[0].id).toBe("sc-01");
    expect(LEARNING_SCENARIOS[49].id).toBe("sc-50");
  });

  it("provides a safe boolean auto-validator for every mission", () => {
    const emptyCluster = { ingresses: [] } as unknown as ClusterState;
    for (const scenario of LEARNING_SCENARIOS) {
      expect(typeof scenario.validate([], emptyCluster)).toBe("boolean");
    }
  });

  it("covers all eight learning categories", () => {
    expect(new Set(LEARNING_SCENARIOS.map(item => item.category)).size).toBe(8);
  });
});
