'use client'

import { Trash2, RotateCcw, Bug, Minus, Plus, Boxes } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useCluster, nodeUsage } from '@/lib/cluster-store'

const phaseColor: Record<string, string> = {
  Running: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  CrashLoopBackOff: 'bg-red-500/15 text-red-400 border-red-500/30',
  Pending: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
  ContainerCreating: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  Terminating: 'bg-zinc-500/15 text-zinc-500 border-zinc-500/30',
}

export function Inspector() {
  const selected = useCluster((s) => s.selected)
  const pods = useCluster((s) => s.pods)
  const nodes = useCluster((s) => s.nodes)
  const deployments = useCluster((s) => s.deployments)
  const removePod = useCluster((s) => s.removePod)
  const crashPod = useCluster((s) => s.crashPod)
  const restartPod = useCluster((s) => s.restartPod)
  const scaleDeployment = useCluster((s) => s.scaleDeployment)
  const removeDeployment = useCluster((s) => s.removeDeployment)

  if (!selected) {
    return <ClusterSummary />
  }

  const [kind, id] = selected.split(':')

  if (kind === 'pod') {
    const pod = pods.find((p) => p.id === id)
    if (!pod) return <ClusterSummary />
    const node = nodes.find((n) => n.id === pod.nodeId)
    return (
      <div className="p-3 space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-1">Pod · inspect</div>
          <div className="font-mono text-sm text-zinc-100 break-all">{pod.name}</div>
          <div className="mt-1.5 flex gap-1.5">
            <Badge variant="outline" className={`${phaseColor[pod.phase] ?? ''} text-[10px] font-mono`}>{pod.phase}</Badge>
            {pod.restarts > 0 && <Badge variant="outline" className="text-[10px] font-mono border-red-500/40 text-red-400">↻ {pod.restarts} restarts</Badge>}
          </div>
        </div>

        <div className="rounded-lg border border-zinc-700 divide-y divide-zinc-800 text-[11px] font-mono">
          {[
            ['Image', pod.image],
            ['Node', node?.name ?? '<unscheduled>'],
            ['CPU request', `${pod.cpuRequest}m`],
            ['Memory request', `${pod.memRequest}Mi`],
            ['Age', `${pod.ageTicks}s sim-time`],
            ['Phase time', `${pod.phaseTicks}s`],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between px-2.5 py-1.5">
              <span className="text-zinc-500">{k}</span>
              <span className="text-zinc-300">{v}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => crashPod(pod.id)} disabled={pod.phase !== 'Running'}>
            <Bug className="h-3.5 w-3.5 mr-1" /> Crash it
          </Button>
          <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => restartPod(pod.id)}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restart
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-500/50" onClick={() => removePod(pod.id)}>
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
          </Button>
        </div>

        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1.5">Container logs</div>
          <div className="rounded-lg border border-zinc-700 bg-black/60 p-2 h-32 overflow-y-auto custom-scroll">
            {pod.logs.length === 0 ? (
              <div className="text-[11px] text-zinc-600 italic">no log lines yet…</div>
            ) : (
              pod.logs.map((l, i) => (
                <div key={i} className={`text-[10px] font-mono leading-4 ${l.includes('ERROR') || l.includes('crash') ? 'text-red-400' : 'text-zinc-400'}`}>{l}</div>
              ))
            )}
          </div>
        </div>
      </div>
    )
  }

  if (kind === 'node') {
    const node = nodes.find((n) => n.id === id)
    if (!node) return <ClusterSummary />
    const u = nodeUsage(pods, node.id)
    const nodePods = pods.filter((p) => p.nodeId === node.id)
    return (
      <div className="p-3 space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-1">Node · inspect</div>
          <div className="font-mono text-sm text-zinc-100">{node.name}</div>
          <Badge variant="outline" className="mt-1.5 text-[10px] border-emerald-500/30 text-emerald-400 bg-emerald-500/10">Ready</Badge>
        </div>
        <div className="rounded-lg border border-zinc-700 divide-y divide-zinc-800 text-[11px] font-mono">
          {[
            ['CPU', `${u.cpu}m / ${node.cpuCapacity}m (${Math.round((u.cpu / node.cpuCapacity) * 100)}%)`],
            ['Memory', `${u.mem}Mi / ${node.memCapacity}Mi (${Math.round((u.mem / node.memCapacity) * 100)}%)`],
            ['Pods', `${nodePods.length}`],
            ['Role', node.role],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between px-2.5 py-1.5">
              <span className="text-zinc-500">{k}</span>
              <span className="text-zinc-300">{v}</span>
            </div>
          ))}
        </div>
        <div className="text-[10px] text-zinc-500 leading-4 px-1">
          Delete a node from the canvas — its pods get evicted and controllers reschedule them onto remaining nodes. Watch FailedScheduling events if capacity runs out.
        </div>
      </div>
    )
  }

  if (kind === 'deployment') {
    const dep = deployments.find((d) => d.id === id)
    if (!dep) return <ClusterSummary />
    const mine = pods.filter((p) => p.deploymentId === dep.id)
    const ready = mine.filter((p) => p.phase === 'Running').length
    return (
      <div className="p-3 space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-1">Deployment · inspect</div>
          <div className="font-mono text-sm text-zinc-100">{dep.name}</div>
          <Badge variant="outline" className="mt-1.5 text-[10px] font-mono border-emerald-500/30 text-emerald-400 bg-emerald-500/10">
            {ready}/{dep.replicas} ready
          </Badge>
        </div>
        <div className="rounded-lg border border-zinc-700 divide-y divide-zinc-800 text-[11px] font-mono">
          {[
            ['Image', dep.image],
            ['Replicas', `${dep.replicas}`],
            ['CPU / pod', `${dep.cpuRequest}m`],
            ['Mem / pod', `${dep.memRequest}Mi`],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between px-2.5 py-1.5">
              <span className="text-zinc-500">{k}</span>
              <span className="text-zinc-300">{v}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" className="h-7" onClick={() => scaleDeployment(dep.id, dep.replicas - 1)} disabled={dep.replicas <= 0}>
            <Minus className="h-3.5 w-3.5" />
          </Button>
          <span className="font-mono text-sm text-zinc-200 w-8 text-center">{dep.replicas}</span>
          <Button size="sm" variant="secondary" className="h-7" onClick={() => scaleDeployment(dep.id, dep.replicas + 1)}>
            <Plus className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs ml-auto border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-500/50" onClick={() => removeDeployment(dep.id)}>
            <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
          </Button>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1.5">Replica pods</div>
          <div className="space-y-1">
            {mine.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-[10px] font-mono rounded border border-zinc-800 bg-zinc-900 px-2 py-1">
                <span className="text-zinc-400 truncate">{p.name}</span>
                <span className={p.phase === 'Running' ? 'text-emerald-400' : p.phase === 'CrashLoopBackOff' ? 'text-red-400' : 'text-zinc-500'}>{p.phase}</span>
              </div>
            ))}
            {mine.length === 0 && <div className="text-[11px] text-zinc-600 italic">controller creating pods…</div>}
          </div>
        </div>
      </div>
    )
  }

  return <ClusterSummary />
}

export function ClusterSummary() {
  const nodes = useCluster((s) => s.nodes)
  const pods = useCluster((s) => s.pods)
  const deployments = useCluster((s) => s.deployments)
  const running = pods.filter((p) => p.phase === 'Running').length
  const crashing = pods.filter((p) => p.phase === 'CrashLoopBackOff').length
  const workers = nodes.filter((n) => n.role === 'worker')
  const totalCpu = workers.reduce((a, n) => a + nodeUsage(pods, n.id).cpu, 0)
  const capCpu = workers.reduce((a, n) => a + n.cpuCapacity, 0)
  const totalMem = workers.reduce((a, n) => a + nodeUsage(pods, n.id).mem, 0)
  const capMem = workers.reduce((a, n) => a + n.memCapacity, 0)

  return (
    <div className="p-3 space-y-3">
      <div>
        <div className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-1">Cluster · overview</div>
        <div className="text-[11px] text-zinc-500">Nothing selected — click a pod or node to inspect it.</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[
          ['Nodes', workers.length, 'text-emerald-400'],
          ['Pods', pods.length, 'text-emerald-400'],
          ['Running', running, 'text-emerald-400'],
          ['CrashLooping', crashing, crashing > 0 ? 'text-red-400' : 'text-zinc-400'],
        ].map(([label, value, cls]) => (
          <div key={label as string} className="rounded-lg border border-zinc-700 bg-zinc-900 p-2.5">
            <div className={`text-lg font-bold font-mono ${cls}`}>{value}</div>
            <div className="text-[10px] text-zinc-500">{label}</div>
          </div>
        ))}
      </div>
      <div className="rounded-lg border border-zinc-700 divide-y divide-zinc-800 text-[11px] font-mono">
        {[
          ['CPU allocated', `${totalCpu}m / ${capCpu}m (${Math.round((totalCpu / Math.max(1, capCpu)) * 100)}%)`],
          ['Mem allocated', `${totalMem}Mi / ${capMem}Mi (${Math.round((totalMem / Math.max(1, capMem)) * 100)}%)`],
          ['Deployments', `${deployments.length}`],
        ].map(([k, v]) => (
          <div key={k} className="flex justify-between px-2.5 py-1.5">
            <span className="text-zinc-500">{k}</span>
            <span className="text-zinc-300">{v}</span>
          </div>
        ))}
      </div>
      <div className="flex items-start gap-2 rounded-lg border border-zinc-700 bg-zinc-900 p-2.5">
        <Boxes className="h-4 w-4 text-zinc-500 mt-0.5 shrink-0" />
        <div className="text-[10px] text-zinc-500 leading-4">
          Deployments listed below are self-healing: crash a replica, delete a pod, or kill a node — the controller recreates and reschedules pods automatically.
        </div>
      </div>
    </div>
  )
}
