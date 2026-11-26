import type { EngineState, NodeResource, PodResource } from "./types";
import { appendEvent, putResource } from "./resources";
export interface DrainOptions { gracePeriodTicks?: number; ignoreDaemonSets?: boolean; deleteEmptyDirData?: boolean }
export function reconcileNodeHeartbeats(state:EngineState):void {
 for(const node of Object.values(state.resources).filter((r):r is NodeResource=>r.kind==="Node")){
  const timeout=state.nodeController?.heartbeatTimeoutTicks??5;
  if(node.status.heartbeatEnabled!==false)node.status.lastHeartbeatTick=state.tick;
  const last=node.status.lastHeartbeatTick??state.tick,ready=state.tick-last<=timeout;
  const wasReady=node.status.conditions.find(c=>c.type==="Ready")?.status??true;
  if(ready===wasReady){if(node.status.heartbeatEnabled!==false)putResource(state,node);continue}
  node.status.conditions=[...node.status.conditions.filter(c=>c.type!=="Ready"),{type:"Ready",status:ready,reason:ready?"KubeletReady":"NodeStatusUnknown",message:ready?"Kubelet heartbeat recovered":"Kubelet stopped posting node status"}];
  node.spec.taints??=[];
  const index=node.spec.taints.findIndex(t=>t.key==="node.kubernetes.io/not-ready");
  if(!ready&&index<0)node.spec.taints.push({key:"node.kubernetes.io/not-ready",effect:"NoExecute"});
  if(ready&&index>=0)node.spec.taints.splice(index,1);
  if(ready)node.status.notReadySinceTick=undefined;
  putResource(state,node);
  appendEvent(state,ready?"Normal":"Warning",ready?"NodeReady":"NodeNotReady",ready?"Node "+node.metadata.name+" is Ready":"Node "+node.metadata.name+" stopped reporting heartbeats and is NotReady",node.metadata.name);
 }
}
export function heartbeatNode(state:EngineState,nodeName:string):EngineState {
 const next=structuredClone(state),node=Object.values(next.resources).find((r):r is NodeResource=>r.kind==="Node"&&r.metadata.name===nodeName);
 if(!node)return next;node.status.lastHeartbeatTick=next.tick;node.status.heartbeatEnabled=true;putResource(next,node);return next;
}
export function setNodeHeartbeat(state:EngineState,nodeName:string,enabled:boolean):EngineState {
 const next=structuredClone(state),node=Object.values(next.resources).find((r):r is NodeResource=>r.kind==="Node"&&r.metadata.name===nodeName);
 if(!node)return next;node.status.heartbeatEnabled=enabled;if(enabled)node.status.lastHeartbeatTick=next.tick;
 appendEvent(next,enabled?"Normal":"Warning",enabled?"KubeletHeartbeatRestored":"KubeletHeartbeatLost",enabled?"Kubelet heartbeat restored on "+nodeName:"Kubelet heartbeat disabled on "+nodeName,nodeName);return next;
}
export function cordonNode(state:EngineState,nodeName:string,cordoned=true):EngineState {
 const next=structuredClone(state),node=Object.values(next.resources).find((r):r is NodeResource=>r.kind==="Node"&&r.metadata.name===nodeName);
 if(!node)return next;node.spec.unschedulable=cordoned;node.spec.taints??=[];node.spec.taints=node.spec.taints.filter(t=>t.key!=="node.kubernetes.io/unschedulable");
 if(cordoned)node.spec.taints.push({key:"node.kubernetes.io/unschedulable",effect:"NoSchedule"});
 putResource(next,node);appendEvent(next,"Normal",cordoned?"NodeCordoned":"NodeUncordoned","Node "+nodeName+" "+(cordoned?"cordoned":"uncordoned"),nodeName);return next;
}
export function drainNode(state:EngineState,nodeName:string,options:DrainOptions={}):EngineState {
 const next=cordonNode(state,nodeName,true),node=Object.values(next.resources).find((r):r is NodeResource=>r.kind==="Node"&&r.metadata.name===nodeName);
 if(!node)return next;const grace=Math.max(0,options.gracePeriodTicks??1);
 const pods=Object.values(next.resources).filter((r):r is PodResource=>r.kind==="Pod"&&r.spec.nodeName===nodeName&&r.status.phase!=="Succeeded"&&r.status.phase!=="Failed");
 for(const pod of pods){if(pod.ownerReferences?.some(o=>o.kind==="DaemonSet")&&options.ignoreDaemonSets!==false)continue;
  pod.status.phase="Failed";pod.status.conditions=[...pod.status.conditions,{type:"Ready",status:false,reason:"NodeDrain",message:"Evicted from "+nodeName}];
  pod.status.containerStatuses=pod.status.containerStatuses.map(c=>({...c,ready:false,state:"Terminated" as const}));
  putResource(next,pod);appendEvent(next,"Warning","Evicted","Pod "+pod.metadata.name+" evicted during node drain (grace period "+grace+" ticks)",pod.metadata.name);
 }
 appendEvent(next,"Normal","NodeDrained","Node "+nodeName+" drained; workloads are eligible for controller replacement",nodeName);return next;
}
export function evictNotReadyPods(state:EngineState):void {
 const timeout=state.nodeController?.podEvictionTimeoutTicks??10;
 for(const pod of Object.values(state.resources).filter((r):r is PodResource=>r.kind==="Pod"&&!!r.spec.nodeName&&r.status.phase==="Running")){
  const node=Object.values(state.resources).find((r):r is NodeResource=>r.kind==="Node"&&r.metadata.name===pod.spec.nodeName);
  if(!node||node.status.conditions.find(c=>c.type==="Ready")?.status!==false)continue;
  const toleration=(pod.spec.tolerations??[]).find(t=>t.key==="node.kubernetes.io/not-ready"&&t.effect==="NoExecute");
  const grace=toleration?(toleration.tolerationSeconds??Number.POSITIVE_INFINITY):timeout;
  const since=node.status.notReadySinceTick??state.tick;node.status.notReadySinceTick??=state.tick;
  if(state.tick-since>=grace){pod.status.phase="Failed";pod.status.conditions=[...pod.status.conditions,{type:"Ready",status:false,reason:"NodeNotReady",message:"Pod evicted after node became NotReady"}];putResource(state,pod);appendEvent(state,"Warning","NodeNotReadyEviction","Evicted "+pod.metadata.name+" after node "+node.metadata.name+" became NotReady",pod.metadata.name)}
 }
}
