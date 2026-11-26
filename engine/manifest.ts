import type { EngineState, KubernetesResource } from "./types";
import { createResource, deleteResource, listResources, scaleResource, updateResource } from "./api";
import { resourceKey } from "./resources";

function scalar(raw:string):unknown {
 const v=raw.trim(); if(!v)return "";
 if(v==="null"||v==="~")return null;if(v==="true")return true;if(v==="false")return false;
 if(/^[-+]?(?:\\d+\\.?\\d*|\\.\\d+)$/.test(v))return Number(v);
 if((v[0]==='"'&&v.at(-1)==='"')||(v[0]==="'"&&v.at(-1)==="'"))return v.slice(1,-1);
 if(v.startsWith("[")||v.startsWith("{")){try{return JSON.parse(v.replace(/'/g,'"'))}catch{}}
 return v.replace(/\\s+#.*$/,"");
}
/** Parses a deliberately safe YAML subset: mappings, sequences, scalar values and inline JSON. */
export function parseYamlDocuments(source:string):unknown[]{
 const text=source.trim();if(!text)return [];
 try{const value=JSON.parse(text);return Array.isArray(value)?value:[value]}catch{}
 return text.split(/^---\\s*$/m).map(x=>x.trim()).filter(Boolean).map(doc=>{
  const lines=doc.split(/\\r?\\n/).filter(x=>x.trim()&&!x.trim().startsWith("#"));
  function block(start:number,indent:number):[any,number]{
   const array=lines[start]?.trimStart().startsWith("-"),out:any=array?[]:{};
   let i=start;
   while(i<lines.length){
    const raw=lines[i],pad=raw.match(/^\\s*/)?.[0].length??0,body=raw.trim();
    if(pad<indent)break;if(pad>indent)throw new Error("Invalid YAML indentation near: "+body);
    if(array){
     if(!body.startsWith("-"))break;
     const rest=body.slice(1).trim();i++;
     if(!rest){if(i<lines.length&&(lines[i].match(/^\\s*/)?.[0].length??0)>indent){const [v,n]=block(i,lines[i].match(/^\\s*/)?.[0].length??0);out.push(v);i=n}else out.push(null);continue}
     const pair=rest.match(/^([^:]+):(?:\\s*(.*))?$/);
     if(pair){const item:any={};const key=pair[1].trim();item[key]=pair[2]?scalar(pair[2]):{};if(i<lines.length&&(lines[i].match(/^\\s*/)?.[0].length??0)>indent){const [nested,n]=block(i,lines[i].match(/^\\s*/)?.[0].length??0);if(nested&&typeof nested==="object"&&!Array.isArray(nested))Object.assign(item,nested);i=n}out.push(item)}
     else out.push(scalar(rest));
     continue;
    }
    const pair=body.match(/^([^:]+):(?:\\s*(.*))?$/);if(!pair)throw new Error("Expected key: value near: "+body);
    const key=pair[1].trim(),value=pair[2]??"";i++;
    if(value.trim()){out[key]=scalar(value);continue}
    if(i<lines.length&&(lines[i].match(/^\\s*/)?.[0].length??0)>indent){const [nested,n]=block(i,lines[i].match(/^\\s*/)?.[0].length??0);out[key]=nested;i=n}else out[key]={};
   }
   return [out,i];
  }
  return block(0,lines[0].match(/^\\s*/)?.[0].length??0)[0];
 });
}
const versions:Record<string,string>={Pod:"v1",Node:"v1",Service:"v1",PersistentVolumeClaim:"v1",Deployment:"apps/v1",ReplicaSet:"apps/v1",DaemonSet:"apps/v1",StatefulSet:"apps/v1",Job:"batch/v1",CronJob:"batch/v1"};
function defaultStatus(kind:string):any{
 switch(kind){case"Pod":return{phase:"Pending",conditions:[],containerStatuses:[]};case"Node":return{conditions:[{type:"Ready",status:true}]};case"Deployment":return{observedGeneration:0,replicas:0,updatedReplicas:0,readyReplicas:0,availableReplicas:0,conditions:[]};case"ReplicaSet":return{observedGeneration:0,replicas:0,readyReplicas:0,availableReplicas:0};case"DaemonSet":return{desiredNumberScheduled:0,currentNumberScheduled:0,numberReady:0,numberAvailable:0,observedGeneration:0};case"StatefulSet":return{replicas:0,readyReplicas:0,currentReplicas:0,observedGeneration:0};case"Job":return{active:0,succeeded:0,failed:0,conditions:[]};case"CronJob":return{active:[]};case"PersistentVolumeClaim":return{phase:"Pending"};case"Service":return{clusterIP:"10.96.0.10",endpoints:[]};default:return{}}}
export function normalizeManifest(value:unknown):KubernetesResource{
 if(!value||typeof value!=="object")throw new Error("Manifest must be an object");
 const raw=value as any,kind=String(raw.kind??"");if(!versions[kind])throw new Error("Unsupported resource kind: "+kind);
 if(raw.apiVersion!==versions[kind])throw new Error(kind+" requires apiVersion "+versions[kind]);
 if(!raw.metadata?.name)throw new Error("metadata.name is required");
 return {...raw,apiVersion:versions[kind],kind,metadata:{name:String(raw.metadata.name),...(kind==="Node"?{}:{namespace:String(raw.metadata.namespace??"default")}),uid:String(raw.metadata.uid??"manifest-"+kind.toLowerCase()+"-"+raw.metadata.name),resourceVersion:Number(raw.metadata.resourceVersion??0),generation:Number(raw.metadata.generation??1),labels:raw.metadata.labels??{},annotations:raw.metadata.annotations??{},creationTimestamp:0},spec:raw.spec??{},status:raw.status??defaultStatus(kind)} as KubernetesResource;
}
export function applyManifests(state:EngineState,source:string):{state:EngineState;messages:string[]}{
 let current=structuredClone(state);const messages:string[]=[];
 for(const doc of parseYamlDocuments(source)){
  const resource=normalizeManifest(doc),existing=listResources(current,resource.kind,resource.metadata.namespace).find(r=>r.metadata.name===resource.metadata.name);
  if(existing){resource.metadata.uid=existing.metadata.uid;resource.metadata.resourceVersion=existing.metadata.resourceVersion;const result=updateResource(current,resource,existing.metadata.resourceVersion);if(!result.ok||!result.state)throw new Error(result.error??"Update failed");current=result.state;messages.push("configured "+resource.kind.toLowerCase()+"/"+resource.metadata.name)}
  else{const result=createResource(current,resource);if(!result.ok||!result.state)throw new Error(result.error??"Create failed");current=result.state;messages.push("created "+resource.kind.toLowerCase()+"/"+resource.metadata.name)}
 }
 return{state:current,messages};
}
export interface KubectlResult{state:EngineState;output:string;error?:boolean}
function kindName(input:string):any{const map:Record<string,string>={pods:"Pod",pod:"Pod",nodes:"Node",node:"Node",deployments:"Deployment",deployment:"Deployment",replicasets:"ReplicaSet",replicaset:"ReplicaSet",daemonsets:"DaemonSet",daemonset:"DaemonSet",statefulsets:"StatefulSet",statefulset:"StatefulSet",services:"Service",service:"Service",jobs:"Job",job:"Job",cronjobs:"CronJob",cronjob:"CronJob",pvcs:"PersistentVolumeClaim",pvc:"PersistentVolumeClaim",persistentvolumeclaims:"PersistentVolumeClaim"};return map[input.toLowerCase()]}
export function runKubectl(state:EngineState,command:string):KubectlResult{
 const args=command.trim().split(/\\s+/);if(!args[0])return{state,output:""};if(args[0]!=="kubectl")return{state,output:"command not found: use kubectl",error:true};
 const verb=args[1],ns=args.includes("-n")?args[args.indexOf("-n")+1]:"default";
 if(verb==="get"&&args[2]==="events")return{state,output:state.events.map(e=>e.type+"\\t"+e.reason+"\\t"+e.message).join("\\n")||"No events"};
 if(verb==="get"){const kind=args[2]==="all"?undefined:kindName(args[2]??"");if(args[2]!=="all"&&!kind)return{state,output:"unsupported resource type: "+args[2],error:true};const rows=listResources(state,kind,ns).map(r=>r.kind+"\\t"+r.metadata.name+"\\t"+(r.kind==="Pod"?(r as any).status.phase:""));return{state,output:rows.join("\\n")||"No resources found"}}
 if(verb==="describe"||verb==="logs"||verb==="delete"||verb==="scale"){
  let kindToken=args[2]??"",name=args[3]??"";if(kindToken.includes("/"))[kindToken,name]=kindToken.split("/");
  const kind=kindName(kindToken);if(!kind||!name)return{state,output:"usage: kubectl "+verb+" <resource> <name>",error:true};
  if(verb==="describe"||verb==="logs"){const r=listResources(state,kind,ns).find(x=>x.metadata.name===name);if(!r)return{state,output:"Error: resource not found",error:true};return{state,output:verb==="logs"?(r.kind==="Pod"?r.status.containerStatuses.map(c=>c.name+": "+c.state+(c.waitingReason?" ("+c.waitingReason+")":"")).join("\\n"):"logs are only available for Pods"):JSON.stringify(r,null,2)}}
  if(verb==="delete"){const x=deleteResource(state,kind,name,ns);return x.ok&&x.state?{state:x.state,output:"deleted "+kind.toLowerCase()+"/"+name}:{state,output:x.error??"delete failed",error:true}}
  if(verb==="scale"){const replicas=Number(args.find(x=>x.startsWith("--replicas="))?.split("=")[1]);if(!Number.isFinite(replicas))return{state,output:"missing --replicas=N",error:true};if(!["Deployment","ReplicaSet","StatefulSet"].includes(kind))return{state,output:"scale supports Deployment, ReplicaSet and StatefulSet",error:true};const x=scaleResource(state,kind,name,replicas,ns);return x.ok&&x.state?{state:x.state,output:"scaled "+kind.toLowerCase()+"/"+name+" to "+replicas}:{state,output:x.error??"scale failed",error:true}
 }
 if(verb==="apply"){return{state,output:"Use the YAML tab's Apply button to submit manifest contents (kubectl apply -f - is not an interactive shell).",error:true}}
 return{state,output:"unsupported command: "+command,error:true};
}
