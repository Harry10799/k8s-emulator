'use client'

import { Trash2, RotateCcw, Bug, Minus, Plus, PencilLine, Boxes } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { useCluster, nodeUsage, serviceEndpoints, type ResourceKind } from '@/lib/cluster-store'

const phaseColor: Record<string, string> = {
  Running: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30',
  CrashLoopBackOff: 'bg-red-500/15 text-red-400 border-red-500/30',
  Pending: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/30',
  ContainerCreating: 'bg-amber-500/15 text-amber-400 border-amber-500/30',
  Terminating: 'bg-zinc-500/15 text-zinc-500 border-zinc-500/30',
  Succeeded: 'bg-emerald-500/15 text-emerald-600 border-emerald-500/30',
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between px-2.5 py-1.5 gap-2">
      <span className="text-zinc-500 shrink-0">{k}</span>
      <span className="text-zinc-300 text-right break-all">{v}</span>
    </div>
  )
}

function InfoCard({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-lg border border-zinc-700 divide-y divide-zinc-800 text-[11px] font-mono">
      {rows.map(([k, v]) => <Row key={k} k={k} v={v} />)}
    </div>
  )
}

function EditBtn({ kind, id }: { kind: ResourceKind; id: string }) {
  const setEditing = useCluster((s) => s.setEditing)
  return (
    <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => setEditing(`${kind}:${id}`)}>
      <PencilLine className="h-3.5 w-3.5 mr-1" /> Edit
    </Button>
  )
}

function DeleteBtn({ kind, id }: { kind: ResourceKind; id: string }) {
  const removeResource = useCluster((s) => s.removeResource)
  return (
    <Button size="sm" variant="outline" className="h-7 text-xs border-zinc-700 text-zinc-400 hover:text-red-400 hover:border-red-500/50" onClick={() => removeResource(kind, id)}>
      <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
    </Button>
  )
}

function ScaleBtns({ onScale, value, min = 0 }: { onScale: (n: number) => void; value: number; min?: number }) {
  return (
    <div className="flex items-center gap-2">
      <Button size="sm" variant="secondary" className="h-7" onClick={() => onScale(value - 1)} disabled={value <= min}>
        <Minus className="h-3.5 w-3.5" />
      </Button>
      <span className="font-mono text-sm text-zinc-200 w-8 text-center">{value}</span>
      <Button size="sm" variant="secondary" className="h-7" onClick={() => onScale(value + 1)}>
        <Plus className="h-3.5 w-3.5" />
      </Button>
    </div>
  )
}

export function Inspector() {
  const selected = useCluster((s) => s.selected)
  const pods = useCluster((s) => s.pods)
  const nodes = useCluster((s) => s.nodes)
  const deployments = useCluster((s) => s.deployments)
  const replicaSets = useCluster((s) => s.replicaSets)
  const daemonSets = useCluster((s) => s.daemonSets)
  const statefulSets = useCluster((s) => s.statefulSets)
  const services = useCluster((s) => s.services)
  const configMaps = useCluster((s) => s.configMaps)
  const secrets = useCluster((s) => s.secrets)
  const cronJobs = useCluster((s) => s.cronJobs)
  const jobs = useCluster((s) => s.jobs)
  const crashPod = useCluster((s) => s.crashPod)
  const restartPod = useCluster((s) => s.restartPod)
  const scaleDeployment = useCluster((s) => s.scaleDeployment)
  const scaleReplicaSet = useCluster((s) => s.scaleReplicaSet)
  const scaleStatefulSet = useCluster((s) => s.scaleStatefulSet)

  if (!selected) return <ClusterSummary />

  const [kind, id] = selected.split(':')

  if (kind === 'pod') {
    const pod = pods.find((p) => p.id === id)
    if (!pod) return <ClusterSummary />
    const node = nodes.find((n) => n.id === pod.nodeId)
    const owner = pod.ownerKind === 'replicaset' ? replicaSets.find((r) => r.id === pod.ownerId)?.name : pod.ownerKind === 'statefulset' ? statefulSets.find((s) => s.id === pod.ownerId)?.name : pod.ownerKind === 'job' ? jobs.find((j) => j.id === pod.ownerId)?.name : null
    return (
      <div className="p-3 space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-1">Pod · inspect</div>
          <div className="font-mono text-sm text-zinc-100 break-all">{pod.name}</div>
          <div className="mt-1.5 flex gap-1.5 flex-wrap">
            <Badge variant="outline" className={`${phaseColor[pod.phase] ?? ''} text-[10px] font-mono`}>{pod.phase}</Badge>
            {pod.restarts > 0 && <Badge variant="outline" className="text-[10px] font-mono border-red-500/40 text-red-400">↻ {pod.restarts}</Badge>}
            {pod.completionTicks !== null && <Badge variant="outline" className="text-[10px] font-mono border-sky-500/40 text-sky-400">job: {pod.completionTicks}s left</Badge>}
          </div>
        </div>
        <InfoCard title="pod" rows={[
          ['Image', pod.image],
          ['Node', node?.name ?? '<unscheduled>'],
          ['CPU', `${pod.cpuRequest}m`],
          ['Memory', `${pod.memRequest}Mi`],
          ['Labels', Object.entries(pod.labels).map(([k, v]) => `${k}=${v}`).join(' ')],
          ['Owner', owner ? `${pod.ownerKind}: ${owner}` : pod.ownerKind],
          ['Env', [pod.envConfigMap && `ConfigMap ${pod.envConfigMap}`, pod.envSecret && `Secret ${pod.envSecret}`].filter(Boolean).join(', ') || 'none'],
          ['Age', `${pod.ageTicks}s sim`],
        ]} />
        <div className="flex flex-wrap gap-2">
          <EditBtn kind="pod" id={pod.id} />
          <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => crashPod(pod.id)} disabled={pod.phase !== 'Running'}>
            <Bug className="h-3.5 w-3.5 mr-1" /> Crash it
          </Button>
          <Button size="sm" variant="secondary" className="h-7 text-xs" onClick={() => restartPod(pod.id)}>
            <RotateCcw className="h-3.5 w-3.5 mr-1" /> Restart
          </Button>
          <DeleteBtn kind="pod" id={pod.id} />
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1.5">Container logs</div>
          <div className="rounded-lg border border-zinc-700 bg-black/60 p-2 h-32 overflow-y-auto custom-scroll">
            {pod.logs.length === 0 ? (
              <div className="text-[11px] text-zinc-600 italic">no log lines yet…</div>
            ) : (
              pod.logs.map((l, i) => (
                <div key={i} className={`text-[10px] font-mono leading-4 ${l.includes('ERROR') ? 'text-red-400' : 'text-zinc-400'}`}>{l}</div>
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
        <InfoCard title="node" rows={[
          ['CPU', `${u.cpu}m / ${node.cpuCapacity}m (${Math.round((u.cpu / node.cpuCapacity) * 100)}%)`],
          ['Memory', `${u.mem}Mi / ${node.memCapacity}Mi (${Math.round((u.mem / node.memCapacity) * 100)}%)`],
          ['Pods', `${nodePods.length}`],
          ['Role', node.role],
        ]} />
        <EditBtn kind="node" id={node.id} />
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Pods on this node</div>
          {nodePods.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-[10px] font-mono rounded border border-zinc-800 bg-zinc-900 px-2 py-1">
              <span className="text-zinc-400 truncate">{p.name}</span>
              <span className={p.phase === 'Running' ? 'text-emerald-400' : p.phase === 'CrashLoopBackOff' ? 'text-red-400' : 'text-zinc-500'}>{p.phase}</span>
            </div>
          ))}
        </div>
        <div className="text-[10px] text-zinc-500 leading-4">
          Delete a node from the canvas — DaemonSet pods on it vanish; controllers reschedule other pods onto remaining nodes.
        </div>
      </div>
    )
  }

  if (kind === 'deployment') {
    const dep = deployments.find((d) => d.id === id)
    if (!dep) return <ClusterSummary />
    const depRs = replicaSets.filter((r) => r.parentDeployment === dep.id)
    const activeRs = depRs.find((r) => !r.superseded)
    const mine = pods.filter((p) => depRs.some((r) => p.ownerId === r.id))
    const ready = mine.filter((p) => p.phase === 'Running').length
    return (
      <div className="p-3 space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-1">Deployment · inspect</div>
          <div className="font-mono text-sm text-zinc-100">{dep.name}</div>
          <div className="mt-1.5 flex gap-1.5">
            <Badge variant="outline" className="text-[10px] font-mono border-emerald-500/30 text-emerald-400 bg-emerald-500/10">{ready}/{dep.replicas} ready</Badge>
            <Badge variant="outline" className="text-[10px] font-mono border-zinc-600 text-zinc-400">rev {dep.revision}</Badge>
          </div>
        </div>
        <InfoCard title="dep" rows={[
          ['Image', dep.image],
          ['Selector', Object.entries(dep.selector).map(([k, v]) => `${k}=${v}`).join(', ')],
          ['CPU / pod', `${dep.cpuRequest}m`],
          ['Mem / pod', `${dep.memRequest}Mi`],
          ['ReplicaSets', `${depRs.length} (${depRs.filter((r) => r.superseded).length} superseded)`],
          ['Rollout', activeRs ? `rev ${activeRs.revision} active` : '…'],
        ]} />
        <div className="flex flex-wrap items-center gap-2">
          <EditBtn kind="deployment" id={dep.id} />
          <ScaleBtns value={dep.replicas} onScale={(n) => scaleDeployment(dep.id, n)} />
          <DeleteBtn kind="deployment" id={dep.id} />
        </div>
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Owned pods</div>
          {mine.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-[10px] font-mono rounded border border-zinc-800 bg-zinc-900 px-2 py-1">
              <span className="text-zinc-400 truncate">{p.name}</span>
              <span className={p.phase === 'Running' ? 'text-emerald-400' : p.phase === 'CrashLoopBackOff' ? 'text-red-400' : 'text-zinc-500'}>{p.phase}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (kind === 'replicaset') {
    const rs = replicaSets.find((r) => r.id === id)
    if (!rs) return <ClusterSummary />
    const mine = pods.filter((p) => p.ownerId === rs.id)
    const ready = mine.filter((p) => p.phase === 'Running').length
    return (
      <div className="p-3 space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-1">ReplicaSet · inspect</div>
          <div className="font-mono text-sm text-zinc-100">{rs.name}</div>
          <div className="mt-1.5 flex gap-1.5">
            <Badge variant="outline" className={`text-[10px] font-mono ${rs.superseded ? 'border-zinc-600 text-zinc-500' : 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'}`}>{ready}/{rs.replicas} ready</Badge>
            {rs.superseded && <Badge variant="outline" className="text-[10px] font-mono border-zinc-600 text-zinc-500">superseded</Badge>}
            {!rs.parentDeployment && <Badge variant="outline" className="text-[10px] font-mono border-zinc-600 text-zinc-500">standalone</Badge>}
          </div>
        </div>
        <InfoCard title="rs" rows={[
          ['Image', rs.image],
          ['Selector', Object.entries(rs.selector).map(([k, v]) => `${k}=${v}`).join(', ')],
          ['Revision', `v${rs.revision}`],
          ['CPU / pod', `${rs.cpuRequest}m`],
          ['Mem / pod', `${rs.memRequest}Mi`],
        ]} />
        <div className="flex flex-wrap items-center gap-2">
          <EditBtn kind="replicaset" id={rs.id} />
          {!rs.parentDeployment && <ScaleBtns value={rs.replicas} onScale={(n) => scaleReplicaSet(rs.id, n)} />}
          <DeleteBtn kind="replicaset" id={rs.id} />
        </div>
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Owned pods</div>
          {mine.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-[10px] font-mono rounded border border-zinc-800 bg-zinc-900 px-2 py-1">
              <span className="text-zinc-400 truncate">{p.name}</span>
              <span className={p.phase === 'Running' ? 'text-emerald-400' : 'text-red-400'}>{p.phase}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (kind === 'daemonset') {
    const ds = daemonSets.find((d) => d.id === id)
    if (!ds) return <ClusterSummary />
    const mine = pods.filter((p) => p.ownerId === ds.id)
    const ready = mine.filter((p) => p.phase === 'Running').length
    const workers = nodes.filter((n) => n.role === 'worker')
    return (
      <div className="p-3 space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-1">DaemonSet · inspect</div>
          <div className="font-mono text-sm text-zinc-100">{ds.name}</div>
          <Badge variant="outline" className="mt-1.5 text-[10px] font-mono border-emerald-500/30 text-emerald-400 bg-emerald-500/10">{ready}/{workers.length} nodes covered</Badge>
        </div>
        <InfoCard title="ds" rows={[
          ['Image', ds.image],
          ['Selector', Object.entries(ds.selector).map(([k, v]) => `${k}=${v}`).join(', ')],
          ['CPU / pod', `${ds.cpuRequest}m`],
          ['Mem / pod', `${ds.memRequest}Mi`],
          ['Strategy', 'one pod per worker node'],
        ]} />
        <div className="flex flex-wrap gap-2">
          <EditBtn kind="daemonset" id={ds.id} />
          <DeleteBtn kind="daemonset" id={ds.id} />
        </div>
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Per-node pods</div>
          {mine.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-[10px] font-mono rounded border border-zinc-800 bg-zinc-900 px-2 py-1">
              <span className="text-zinc-400 truncate">{p.name} @ {nodes.find((n) => n.id === p.nodeId)?.name ?? '—'}</span>
              <span className={p.phase === 'Running' ? 'text-emerald-400' : 'text-zinc-500'}>{p.phase}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (kind === 'statefulset') {
    const sts = statefulSets.find((d) => d.id === id)
    if (!sts) return <ClusterSummary />
    const mine = pods.filter((p) => p.ownerId === sts.id && p.phase !== 'Succeeded')
    const ready = mine.filter((p) => p.phase === 'Running').length
    return (
      <div className="p-3 space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-1">StatefulSet · inspect</div>
          <div className="font-mono text-sm text-zinc-100">{sts.name}</div>
          <Badge variant="outline" className="mt-1.5 text-[10px] font-mono border-emerald-500/30 text-emerald-400 bg-emerald-500/10">{ready}/{sts.replicas} ready</Badge>
        </div>
        <InfoCard title="sts" rows={[
          ['Image', sts.image],
          ['Service', sts.serviceName],
          ['CPU / pod', `${sts.cpuRequest}m`],
          ['Mem / pod', `${sts.memRequest}Mi`],
          ['Naming', `${sts.name}-0 … ${sts.name}-${Math.max(0, sts.replicas - 1)}`],
        ]} />
        <div className="flex flex-wrap items-center gap-2">
          <EditBtn kind="statefulset" id={sts.id} />
          <ScaleBtns value={sts.replicas} onScale={(n) => scaleStatefulSet(sts.id, n)} />
          <DeleteBtn kind="statefulset" id={sts.id} />
        </div>
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Ordinal pods (stable names)</div>
          {mine.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-[10px] font-mono rounded border border-zinc-800 bg-zinc-900 px-2 py-1">
              <span className="text-zinc-400 truncate">{p.name}</span>
              <span className={p.phase === 'Running' ? 'text-emerald-400' : 'text-zinc-500'}>{p.phase}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (kind === 'service') {
    const svc = services.find((v) => v.id === id)
    if (!svc) return <ClusterSummary />
    const eps = serviceEndpoints(pods, svc)
    return (
      <div className="p-3 space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-1">Service · inspect</div>
          <div className="font-mono text-sm text-zinc-100">{svc.name}</div>
          <div className="mt-1.5 flex gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[10px] font-mono border-zinc-600 text-zinc-300">{svc.type}</Badge>
            <Badge variant="outline" className={`text-[10px] font-mono ${eps.length > 0 ? 'border-emerald-500/30 text-emerald-400' : 'border-amber-500/30 text-amber-400'}`}>{eps.length} endpoints</Badge>
          </div>
        </div>
        <InfoCard title="svc" rows={[
          ['ClusterIP', svc.clusterIP],
          ['Selector', Object.entries(svc.selector).map(([k, v]) => `${k}=${v}`).join(', ')],
          ['Port', `${svc.port} → ${svc.targetPort} (${svc.protocol})`],
          ['NodePort', svc.nodePort ? String(svc.nodePort) : '—'],
          ['ExternalIP', svc.type === 'LoadBalancer' ? (svc.externalIP ?? 'provisioning…') : '—'],
        ]} />
        <div className="flex flex-wrap gap-2">
          <EditBtn kind="service" id={svc.id} />
          <DeleteBtn kind="service" id={svc.id} />
        </div>
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Endpoints (running pods matching selector)</div>
          {eps.length === 0 && (
            <div className="text-[11px] text-amber-500/80 italic">no pods match — deploy pods with these labels</div>
          )}
          {eps.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-[10px] font-mono rounded border border-zinc-800 bg-zinc-900 px-2 py-1">
              <span className="text-zinc-400 truncate">{p.name}</span>
              <span className="text-emerald-400">{nodes.find((n) => n.id === p.nodeId)?.name}:{svc.targetPort}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (kind === 'configmap' || kind === 'secret') {
    const res = kind === 'configmap' ? configMaps.find((c) => c.id === id) : secrets.find((c) => c.id === id)
    if (!res) return <ClusterSummary />
    const consumers = pods.filter((p) => (kind === 'configmap' ? p.envConfigMap === res.name : p.envSecret === res.name))
    return (
      <div className="p-3 space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-1">{kind === 'configmap' ? 'ConfigMap' : 'Secret'} · inspect</div>
          <div className="font-mono text-sm text-zinc-100">{res.name}</div>
        </div>
        <div className="rounded-lg border border-zinc-700 bg-black/40 p-2.5">
          {Object.entries(res.data).map(([k, v]) => (
            <div key={k} className="text-[11px] font-mono leading-5">
              <span className="text-emerald-500">{k}</span>
              <span className="text-zinc-600"> = </span>
              <span className={kind === 'secret' ? 'text-amber-400' : 'text-zinc-300'}>{v}</span>
            </div>
          ))}
          {Object.keys(res.data).length === 0 && <div className="text-[11px] text-zinc-600 italic">empty</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          <EditBtn kind={kind as ResourceKind} id={res.id} />
          <DeleteBtn kind={kind as ResourceKind} id={res.id} />
        </div>
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Mounted by (envFrom)</div>
          {consumers.length === 0 && <div className="text-[11px] text-zinc-600 italic">no pods consume this yet — edit a pod and set env</div>}
          {consumers.map((p) => (
            <div key={p.id} className="text-[10px] font-mono rounded border border-zinc-800 bg-zinc-900 px-2 py-1 text-zinc-400">{p.name}</div>
          ))}
        </div>
      </div>
    )
  }

  if (kind === 'cronjob') {
    const cj = cronJobs.find((c) => c.id === id)
    if (!cj) return <ClusterSummary />
    const myJobs = jobs.filter((j) => j.cronjobOwner === cj.id)
    return (
      <div className="p-3 space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-1">CronJob · inspect</div>
          <div className="font-mono text-sm text-zinc-100">{cj.name}</div>
          <Badge variant="outline" className="mt-1.5 text-[10px] font-mono border-zinc-600 text-zinc-300">every {parseSched(cj.schedule)}s sim-time</Badge>
        </div>
        <InfoCard title="cj" rows={[
          ['Schedule', cj.schedule],
          ['Job image', cj.image],
          ['Job runtime', `${cj.duration}s sim`],
          ['Completions', `${cj.completions}`],
          ['Active', `${cj.active}`],
        ]} />
        <div className="flex flex-wrap gap-2">
          <EditBtn kind="cronjob" id={cj.id} />
          <DeleteBtn kind="cronjob" id={cj.id} />
        </div>
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Recent jobs</div>
          {myJobs.slice(0, 6).map((j) => (
            <div key={j.id} className="flex items-center justify-between text-[10px] font-mono rounded border border-zinc-800 bg-zinc-900 px-2 py-1">
              <span className="text-zinc-400 truncate">{j.name}</span>
              <span className={j.status === 'Complete' ? 'text-emerald-400' : 'text-amber-400'}>{j.status}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (kind === 'job') {
    const job = jobs.find((j) => j.id === id)
    if (!job) return <ClusterSummary />
    const myPods = pods.filter((p) => p.ownerId === job.id)
    return (
      <div className="p-3 space-y-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-zinc-500 font-semibold mb-1">Job · inspect</div>
          <div className="font-mono text-sm text-zinc-100">{job.name}</div>
          <Badge variant="outline" className={`mt-1.5 text-[10px] font-mono ${job.status === 'Complete' ? 'border-emerald-500/30 text-emerald-400' : 'border-amber-500/30 text-amber-400'}`}>{job.status}</Badge>
        </div>
        <InfoCard title="job" rows={[
          ['Image', job.image],
          ['Runtime', `${job.duration}s sim`],
          ['Completions', '1/1'],
        ]} />
        <div className="flex flex-wrap gap-2">
          <EditBtn kind="job" id={job.id} />
          <DeleteBtn kind="job" id={job.id} />
        </div>
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Job pods</div>
          {myPods.map((p) => (
            <div key={p.id} className="flex items-center justify-between text-[10px] font-mono rounded border border-zinc-800 bg-zinc-900 px-2 py-1">
              <span className="text-zinc-400 truncate">{p.name}</span>
              <span className={p.phase === 'Succeeded' ? 'text-emerald-400' : 'text-zinc-400'}>{p.phase}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return <ClusterSummary />
}

function parseSched(s: string): string {
  const m = s.match(/^\*\/(\d+)/)
  if (m) return m[1]
  if (s.trim() === '* * * * *') return '60'
  const p = s.match(/^(\d+)$/)
  if (p) return p[1]
  return '?'
}

export function ClusterSummary() {
  const nodes = useCluster((s) => s.nodes)
  const pods = useCluster((s) => s.pods)
  const deployments = useCluster((s) => s.deployments)
  const services = useCluster((s) => s.services)
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
        <div className="text-[11px] text-zinc-500">Nothing selected — click any resource in the list or a pod on canvas to inspect and edit it.</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[
          ['Nodes', workers.length],
          ['Pods', pods.length],
          ['Running', running],
          ['CrashLooping', crashing],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-lg border border-zinc-700 bg-zinc-900 p-2.5">
            <div className={`text-lg font-bold font-mono ${label === 'CrashLooping' && (value as number) > 0 ? 'text-red-400' : 'text-emerald-400'}`}>{value}</div>
            <div className="text-[10px] text-zinc-500">{label}</div>
          </div>
        ))}
      </div>
      <InfoCard title="alloc" rows={[
        ['CPU allocated', `${totalCpu}m / ${capCpu}m (${Math.round((totalCpu / Math.max(1, capCpu)) * 100)}%)`],
        ['Mem allocated', `${totalMem}Mi / ${capMem}Mi (${Math.round((totalMem / Math.max(1, capMem)) * 100)}%)`],
        ['Deployments', `${deployments.length}`],
        ['Services', `${services.length}`],
      ]} />
      <div className="flex items-start gap-2 rounded-lg border border-zinc-700 bg-zinc-900 p-2.5">
        <Boxes className="h-4 w-4 text-zinc-500 mt-0.5 shrink-0" />
        <div className="text-[10px] text-zinc-500 leading-4">
          Every resource is editable: select one → Edit → change image/labels/replicas → watch controllers react (rollouts, rescheduling, endpoint changes).
        </div>
      </div>
    </div>
  )
}
