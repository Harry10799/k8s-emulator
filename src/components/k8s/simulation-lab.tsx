'use client'

import { useState } from 'react'
import { Activity, ChevronDown, ChevronUp, Pause, Play, RotateCcw, StepForward, Target, Trophy } from 'lucide-react'
import { useCluster } from '@/lib/cluster-store'
import { engineStore, useEngineSnapshot } from '@/lib/engine-store'
import type { DeploymentResource, HorizontalPodAutoscalerResource, PodResource } from '../../../engine/types'

const meta = (name: string, namespace = 'default') => ({ name, namespace, uid: '', resourceVersion: 1, generation: 1, labels: {}, annotations: {}, creationTimestamp: 0 })

export function SimulationLab() {
  const [expanded,setExpanded] = useState(true)
  const [challenge,setChallenge] = useState<'pending'|'rollout'|null>(null)
  const [challengePod,setChallengePod] = useState<string|null>(null)
  const [rolloutTarget,setRolloutTarget] = useState<string|null>(null)
  const [targetName,setTargetName] = useState('')
  const running = useCluster(state => state.running)
  const tick = useCluster(state => state.tick)
  const rewind = useCluster(state => state.rewind)
  const setRunning = useCluster(state => state.setRunning)
  const updateResource = useCluster(state => state.updateResource)
  const createResource = useCluster(state => state.createResource)
  const deployments = useCluster(state => state.deployments)
  const snapshot = useEngineSnapshot(state => state)
  const resources = Object.values(snapshot.resources)
  const hpas = resources.filter((resource): resource is HorizontalPodAutoscalerResource => resource.kind === 'HorizontalPodAutoscaler')
  const engineDeployments = resources.filter((resource): resource is DeploymentResource => resource.kind === 'Deployment')
  const pods = resources.filter((resource): resource is PodResource => resource.kind === 'Pod')
  const load = snapshot.simulatedLoadPercent ?? 100
  const activeHpa = hpas.find(item => item.spec.scaleTargetRef.name === targetName)
  const pending = challengePod ? pods.find(pod => pod.metadata.uid === challengePod) : undefined
  const pendingPassed = Boolean(pending && pending.status.phase === 'Running' && pending.status.conditions.some(condition => condition.type === 'Ready' && condition.status))
  const rollout = rolloutTarget ? engineDeployments.find(item => item.metadata.uid === rolloutTarget) : undefined
  const rolloutPassed = Boolean(rollout && rollout.spec.strategy?.type === 'RollingUpdate' && (rollout.spec.strategy.maxUnavailable ?? 0) === 0 && rollout.status.availableReplicas >= rollout.spec.replicas && rollout.status.updatedReplicas >= rollout.spec.replicas)
  const startPending = () => {
    createResource({kind:'pod',name:'pending-debug',namespace:'default',image:'nginx:1.28',nodeSelector:{'kubernetes.io/hostname':'missing-worker'}})
    const created = useCluster.getState().pods.at(-1)
    if (created) { setChallengePod(created.id); setChallenge('pending') }
  }
  const fixPending = () => { if (challengePod) updateResource('pod',challengePod,{nodeSelector:undefined}) }
  const startRollout = (deployment: DeploymentResource) => {
    const legacy = deployments.find(item => item.id === deployment.metadata.uid)
    if (!legacy) return
    updateResource('deployment',legacy.id,{image:legacy.image === 'nginx:1.28' ? 'nginx:1.27' : 'nginx:1.28'})
    setRolloutTarget(deployment.metadata.uid); setChallenge('rollout')
  }
  const enableHpa = () => {
    const deployment = engineDeployments.find(item => item.metadata.name === targetName)
    if (!deployment || hpas.some(item => item.spec.scaleTargetRef.name === targetName)) return
    engineStore.create({apiVersion:'autoscaling/v2',kind:'HorizontalPodAutoscaler',metadata:meta(targetName + '-hpa',deployment.metadata.namespace ?? 'default'),spec:{scaleTargetRef:{apiVersion:'apps/v1',kind:'Deployment',name:targetName},minReplicas:1,maxReplicas:6,metrics:[{type:'Resource',resource:{name:'cpu',target:{type:'Utilization',averageUtilization:50}}}]},status:{currentReplicas:deployment.spec.replicas,desiredReplicas:deployment.spec.replicas,conditions:[]}})
  }
  return <section className="absolute bottom-3 left-3 z-30 w-[min(390px,calc(100vw-24px))] overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950/95 shadow-xl">
    <button onClick={() => setExpanded(value => !value)} aria-expanded={expanded} className="flex w-full items-center justify-between px-3 py-2.5 text-left"><span className="flex items-center gap-2 text-xs font-semibold text-zinc-100"><Activity className="h-4 w-4 text-cyan-400"/>Simulation Lab <span className="text-[9px] font-normal text-zinc-500">tick {snapshot.tick}</span></span>{expanded?<ChevronDown className="h-4 w-4 text-zinc-500"/>:<ChevronUp className="h-4 w-4 text-zinc-500"/>}</button>
    {expanded && <div className="space-y-3 border-t border-zinc-800 p-3">
      <div className="flex items-center gap-1.5"><button onClick={() => setRunning(!running)} className="flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1.5 text-[10px] text-zinc-200">{running?<Pause className="h-3 w-3"/>:<Play className="h-3 w-3"/>}{running?'Pause':'Resume'}</button><button onClick={() => {setRunning(false);tick()}} className="flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1.5 text-[10px] text-zinc-200"><StepForward className="h-3 w-3"/>Step</button><button onClick={() => {setRunning(false);rewind()}} disabled={snapshot.tick===0} className="flex items-center gap-1 rounded-md bg-zinc-800 px-2 py-1.5 text-[10px] text-zinc-200 disabled:opacity-40"><RotateCcw className="h-3 w-3"/>Rewind</button></div>
      <div className="space-y-1"><div className="flex justify-between text-[10px] text-zinc-400"><span>Simulated CPU load</span><strong className="text-cyan-300">{load}%</strong></div><input aria-label="Simulated CPU load" type="range" min="0" max="200" step="10" value={load} onChange={event => engineStore.setLoadPercent(Number(event.target.value))} className="w-full accent-cyan-400"/></div>
      <div className="space-y-1.5 border-t border-zinc-800 pt-2"><div className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-300"><Trophy className="h-3.5 w-3.5 text-amber-400"/>Challenges</div>
        <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2"><div className="flex items-center justify-between"><span className="text-[10px] font-medium text-zinc-200">Why is my Pod Pending?</span>{challenge==='pending'&&<span className={pendingPassed?'text-[9px] text-emerald-400':'text-[9px] text-amber-400'}>{pendingPassed?'Passed':'In progress'}</span>}</div><p className="my-1 text-[9px] text-zinc-500">A Pod has a node selector that matches no worker. Remove the invalid selector to let the scheduler place it.</p>{challenge!=='pending'?<button onClick={startPending} className="rounded bg-zinc-800 px-2 py-1 text-[9px] text-cyan-300">Start challenge</button>:<button onClick={fixPending} disabled={pendingPassed||!pending} className="rounded bg-zinc-800 px-2 py-1 text-[9px] text-cyan-300 disabled:opacity-40">Remove invalid node selector</button>}</div>
        <div className="rounded-md border border-zinc-800 bg-zinc-900/60 p-2"><div className="flex items-center justify-between"><span className="text-[10px] font-medium text-zinc-200">Zero-downtime rollout</span>{challenge==='rollout'&&<span className={rolloutPassed?'text-[9px] text-emerald-400':'text-[9px] text-amber-400'}>{rolloutPassed?'Passed':'Rolling out'}</span>}</div><p className="my-1 text-[9px] text-zinc-500">Roll a new image while maintaining maxUnavailable=0 and all desired replicas available.</p><select aria-label="Deployment for rollout challenge" value={rolloutTarget??''} onChange={event=>setRolloutTarget(event.target.value||null)} className="mb-1 w-full rounded bg-zinc-800 px-2 py-1 text-[10px] text-zinc-200"><option value="">Choose Deployment</option>{engineDeployments.map(item=><option key={item.metadata.uid} value={item.metadata.uid}>{item.metadata.name}</option>)}</select><button onClick={()=>{const selected=engineDeployments.find(item=>item.metadata.uid===rolloutTarget);if(selected)startRollout(selected)}} disabled={!rolloutTarget} className="rounded bg-zinc-800 px-2 py-1 text-[9px] text-cyan-300 disabled:opacity-40">Start rollout</button></div>
      </div>
      <div className="space-y-1.5 border-t border-zinc-800 pt-2"><div className="flex items-center gap-1.5 text-[10px] font-semibold text-zinc-300"><Target className="h-3.5 w-3.5 text-violet-400"/>Horizontal Pod Autoscaler</div><select aria-label="Deployment for HPA" value={targetName} onChange={event=>setTargetName(event.target.value)} className="w-full rounded bg-zinc-800 px-2 py-1.5 text-[10px] text-zinc-200"><option value="">Choose Deployment</option>{engineDeployments.map(item=><option key={item.metadata.uid} value={item.metadata.name}>{item.metadata.name}</option>)}</select><div className="flex items-center justify-between gap-2"><span className="text-[9px] text-zinc-500">{activeHpa?'CPU '+(activeHpa.status.currentCPUUtilizationPercentage??0)+'% · replicas '+activeHpa.status.currentReplicas+' → '+activeHpa.status.desiredReplicas:'Target CPU 50% · min 1 · max 6'}</span><button onClick={enableHpa} disabled={!targetName||Boolean(activeHpa)} className="rounded bg-violet-950 px-2 py-1 text-[9px] text-violet-200 disabled:opacity-40">{activeHpa?'HPA enabled':'Enable HPA'}</button></div>{hpas.map(hpa=><div key={hpa.metadata.uid} className="text-[9px] text-zinc-500">{hpa.metadata.name}: {hpa.status.currentCPUUtilizationPercentage??0}% CPU</div>)}</div>
    </div>}
  </section>
}
