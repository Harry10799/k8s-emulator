import { describe, expect, it } from "bun:test";
import { createInitialState, step } from "../engine/engine";
import { createSeededRng } from "../engine/rng";
import type { DeploymentResource, HorizontalPodAutoscalerResource, NodeResource } from "../engine/types";

const node: NodeResource = { apiVersion:"v1",kind:"Node",metadata:{name:"worker-a",uid:"worker-a",resourceVersion:1,generation:1,labels:{"kubernetes.io/hostname":"worker-a"},annotations:{},creationTimestamp:0},spec:{capacity:{cpuMilli:4000,memoryMi:8192}},status:{conditions:[{type:"Ready",status:true}],heartbeatEnabled:true,lastHeartbeatTick:0} };
const deployment: DeploymentResource = { apiVersion:"apps/v1",kind:"Deployment",metadata:{name:"web",namespace:"default",uid:"web",resourceVersion:1,generation:1,labels:{app:"web"},annotations:{},creationTimestamp:0},spec:{replicas:1,selector:{matchLabels:{app:"web"}},template:{metadata:{labels:{app:"web"}},spec:{containers:[{name:"web",image:"nginx:1.28",resources:{requests:{cpuMilli:100,memoryMi:64}}}]}},strategy:{type:"RollingUpdate",maxSurge:1,maxUnavailable:0}},status:{observedGeneration:1,replicas:0,updatedReplicas:0,readyReplicas:0,availableReplicas:0,conditions:[]} };
const hpa: HorizontalPodAutoscalerResource = { apiVersion:"autoscaling/v2",kind:"HorizontalPodAutoscaler",metadata:{name:"web-hpa",namespace:"default",uid:"web-hpa",resourceVersion:1,generation:1,labels:{},annotations:{},creationTimestamp:0},spec:{scaleTargetRef:{apiVersion:"apps/v1",kind:"Deployment",name:"web"},minReplicas:1,maxReplicas:6,metrics:[{type:"Resource",resource:{name:"cpu",target:{type:"Utilization",averageUtilization:50}}}]},status:{currentReplicas:1,desiredReplicas:1,conditions:[]} };

describe("HorizontalPodAutoscaler", () => {
  it("scales a Deployment up when simulated CPU exceeds its target", () => {
    let state = createInitialState([node,deployment,hpa]); state.simulatedLoadPercent = 200;
    state = step(state,createSeededRng(5)); state = step(state,createSeededRng(5));
    const actual = Object.values(state.resources).find(resource => resource.kind === "HorizontalPodAutoscaler") as HorizontalPodAutoscalerResource;
    const target = Object.values(state.resources).find(resource => resource.kind === "Deployment") as DeploymentResource;
    expect(target.spec.replicas).toBeGreaterThan(1); expect(actual.status.currentCPUUtilizationPercentage).toBe(200); expect(actual.status.desiredReplicas).toBeGreaterThan(1);
  });
  it("respects the configured maximum replica count", () => {
    let state = createInitialState([node,deployment,hpa]); state.simulatedLoadPercent = 300;
    state = step(state,createSeededRng(6)); state = step(state,createSeededRng(6));
    const target = Object.values(state.resources).find(resource => resource.kind === "Deployment") as DeploymentResource;
    expect(target.spec.replicas).toBeLessThanOrEqual(6);
  });
});
