import type { EngineState, KubernetesResource, NodeResource, PodResource } from "../types";
import { createMetadata } from "../resources";
export const values = <T extends KubernetesResource>(state: EngineState, kind: T["kind"]): T[] => Object.values(state.resources).filter((resource): resource is T => resource.kind === kind);
export const active = (pod: PodResource) => pod.status.phase !== "Succeeded" && pod.status.phase !== "Failed";
export const ready = (pod: PodResource) => pod.status.phase === "Running" && pod.status.conditions.some(condition => condition.type === "Ready" && condition.status);
export const owns = (pod: PodResource, uid: string) => pod.ownerReferences?.some(owner => owner.uid === uid) === true;
export const makePod = (state: EngineState, name: string, namespace: string, labels: Record<string,string>, spec: PodResource["spec"], owner: {uid:string;kind:string;name:string}): PodResource => ({
 apiVersion:"v1",kind:"Pod",metadata:createMetadata(state,name,namespace,labels),spec:structuredClone(spec),
 status:{phase:"Pending",conditions:[{type:"PodScheduled",status:false},{type:"Ready",status:false}],containerStatuses:spec.containers.map(container=>({name:container.name,ready:false,restartCount:0,state:"Waiting"}))},
 ownerReferences:[owner],
});
export const matches = (selector: Record<string,string>, labels: Record<string,string>) => Object.entries(selector).every(([key,value]) => labels[key] === value);
export const workerNodes = (state: EngineState) => values<NodeResource>(state,"Node").filter(node=>node.status.conditions.some(c=>c.type==="Ready"&&c.status)&&!node.spec.unschedulable);
