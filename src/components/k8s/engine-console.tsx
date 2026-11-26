'use client'
import {useState} from 'react'
import {Terminal,FileCode2} from 'lucide-react'
import {engineStore,useEngineSnapshot} from '@/lib/engine-store'
import {Button} from '@/components/ui/button'
import {Textarea} from '@/components/ui/textarea'
const sample=`apiVersion: apps/v1
kind: Deployment
metadata:
  name: demo-web
spec:
  replicas: 2
  selector:
    matchLabels:
      app: demo-web
  template:
    metadata:
      labels:
        app: demo-web
    spec:
      containers:
        - name: web
          image: nginx:1.27
          resources:
            requests:
              cpuMilli: 100
              memoryMi: 128
`
export function EngineConsole(){
 const [tab,setTab]=useState<'terminal'|'yaml'|'control'>('terminal'),[command,setCommand]=useState('kubectl get pods'),[yaml,setYaml]=useState(sample),[output,setOutput]=useState('Engine API ready.'),[failed,setFailed]=useState(false)
 const state=useEngineSnapshot(s=>s),nodes=Object.values(state.resources).filter(r=>r.kind==='Node')
 const execute=()=>{const r=engineStore.kubectl(command,yaml);setOutput(r.output);setFailed(Boolean(r.error))}
 const apply=()=>{try{setOutput(engineStore.applyYaml(yaml).join('\n'));setFailed(false)}catch(e){setOutput(e instanceof Error?e.message:String(e));setFailed(true)}}
 return <section className="absolute bottom-3 right-3 z-30 w-[min(560px,calc(100vw-24px))] rounded-xl border border-zinc-700 bg-zinc-950/95 shadow-2xl">
 <header className="flex items-center justify-between border-b border-zinc-800 px-3 py-2"><span className="flex items-center gap-2 text-xs text-zinc-200"><Terminal className="h-4 w-4 text-emerald-400"/> Engine Console</span><nav className="flex gap-1">{(['terminal','yaml','control'] as const).map(t=><button key={t} onClick={()=>setTab(t)} className={`rounded px-2 py-1 text-[10px] ${tab===t?'bg-zinc-700 text-white':'text-zinc-400'}`}>{t}</button>)}</nav></header>
 {tab==='terminal'&&<div className="space-y-2 p-3"><div className="flex gap-2"><input value={command} onChange={e=>setCommand(e.target.value)} onKeyDown={e=>e.key==='Enter'&&execute()} className="min-w-0 flex-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1.5 font-mono text-xs text-white"/><Button size="sm" onClick={execute}>Run</Button></div><pre className={`max-h-36 overflow-auto whitespace-pre-wrap rounded bg-black p-2 font-mono text-[11px] ${failed?'text-rose-400':'text-emerald-300'}`}>{output}</pre></div>}
 {tab==='yaml'&&<div className="space-y-2 p-3"><div className="flex items-center gap-2 text-[10px] text-zinc-400"><FileCode2 className="h-3 w-3"/>Safe YAML subset · multi-document</div><Textarea value={yaml} onChange={e=>setYaml(e.target.value)} className="min-h-44 font-mono text-[11px]"/><Button size="sm" onClick={apply}>Apply</Button></div>}
 {tab==='control'&&<div className="space-y-2 p-3"><div className="grid grid-cols-2 gap-2">{(['apiServerAvailable','schedulerAvailable','controllerManagerAvailable','etcdAvailable'] as const).map(k=><label key={k} className="flex items-center justify-between rounded border border-zinc-800 p-2 text-[10px] text-zinc-300">{k.replace('Available','')}<input type="checkbox" checked={state.controlPlane?.[k]??true} onChange={e=>engineStore.setControlPlane(k,e.target.checked)}/></label>)}</div>{nodes.map(n=><div key={n.metadata.uid} className="flex flex-wrap items-center justify-between gap-1 rounded border border-zinc-800 p-2 text-[10px] text-zinc-300"><span>{n.metadata.name}</span><div className="flex gap-1"><button onClick={()=>engineStore.setHeartbeat(n.metadata.name,false)} className="rounded bg-rose-950 px-2 py-1">Stop heartbeat</button><button onClick={()=>engineStore.setHeartbeat(n.metadata.name,true)} className="rounded bg-emerald-950 px-2 py-1">Restore</button><button onClick={()=>engineStore.cordon(n.metadata.name,!n.spec.unschedulable)} className="rounded bg-zinc-800 px-2 py-1">{n.spec.unschedulable?"Uncordon":"Cordon"}</button><button onClick={()=>engineStore.drain(n.metadata.name)} className="rounded bg-amber-950 px-2 py-1">Drain</button></div></div>)}</div>}
 </section>
}
