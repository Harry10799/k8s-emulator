'use client'
import { useSyncExternalStore } from 'react'
import { createInitialState, step } from '../../engine/engine'
import { createSeededRng } from '../../engine/rng'
import { createResource, deleteResource, getResource, listResources, scaleResource, updateResource } from '../../engine/api'
import { cordonNode, drainNode, setNodeHeartbeat } from '../../engine/node-lifecycle'
import { applyManifests, runKubectl } from '../../engine/manifest'
import type { EngineState, KubernetesResource, RandomSource } from '../../engine/types'
let snapshot:EngineState=createInitialState()
let rng:RandomSource=createSeededRng(0x5eed1234)
const listeners=new Set<()=>void>()
function publish(next:EngineState){if(next===snapshot)return;snapshot=next;listeners.forEach(fn=>fn())}
export const engineStore={
 getSnapshot:()=>snapshot,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>listeners.delete(fn)},
 reset:(resources:KubernetesResource[]=[])=>{rng=createSeededRng(0x5eed1234);publish(createInitialState(resources))},
 tick:()=>publish(step(snapshot,rng)),
 create:(r:KubernetesResource)=>{const x=createResource(snapshot,r);if(x.ok&&x.state)publish(x.state);return x},
 get:getResource,list:listResources,
 update:(r:KubernetesResource,v?:number)=>{const x=updateResource(snapshot,r,v);if(x.ok&&x.state)publish(x.state);return x},
 delete:(k:any,n:string,ns="default",cascade=true)=>{const x=deleteResource(snapshot,k,n,ns,cascade);if(x.ok&&x.state)publish(x.state);return x},
 scale:(k:any,n:string,r:number,ns="default")=>{const x=scaleResource(snapshot,k,n,r,ns);if(x.ok&&x.state)publish(x.state);return x},
 setControlPlane:(key:'apiServerAvailable'|'schedulerAvailable'|'controllerManagerAvailable'|'etcdAvailable',available:boolean)=>{const next=structuredClone(snapshot);next.controlPlane??={apiServerAvailable:true,schedulerAvailable:true,controllerManagerAvailable:true,etcdAvailable:true};next.controlPlane[key]=available;publish(next)},
 setHeartbeat:(name:string,enabled:boolean)=>publish(setNodeHeartbeat(snapshot,name,enabled)),
 cordon:(name:string,value=true)=>publish(cordonNode(snapshot,name,value)),drain:(name:string)=>publish(drainNode(snapshot,name)),
 applyYaml:(yaml:string)=>{const x=applyManifests(snapshot,yaml);publish(x.state);return x.messages},
 kubectl:(command:string)=>{const x=runKubectl(snapshot,command);if(x.state!==snapshot)publish(x.state);return x}
}
export function useEngineSnapshot<T>(selector:(s:EngineState)=>T):T{const state=useSyncExternalStore(engineStore.subscribe,engineStore.getSnapshot,engineStore.getSnapshot);return selector(state)}
