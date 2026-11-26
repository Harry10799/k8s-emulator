'use client'

import { Boxes, ArrowDown, HardDrive, Gauge, Package, Cable, Shield, Activity } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { useCluster, nodeUsage, type Pod } from '@/lib/cluster-store'

function Layer({ icon: Icon, title, sub, color, children }: {
  icon: typeof Boxes
  title: string
  sub: string
  color: string
  children?: React.ReactNode
}) {
  return (
    <div className={`rounded-lg border p-2.5 ${color}`}>
      <div className="flex items-start gap-2.5">
        <Icon className="h-4 w-4 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-xs font-semibold text-zinc-100 font-mono">{title}</div>
          <div className="text-[10px] text-zinc-400 leading-relaxed mt-0.5">{sub}</div>
          {children}
        </div>
      </div>
    </div>
  )
}

const Arrow = () => (
  <div className="flex justify-center py-0.5">
    <ArrowDown className="h-3.5 w-3.5 text-zinc-600" />
  </div>
)

const phaseColor: Record<string, string> = {
  Running: 'text-emerald-500',
  Pending: 'text-zinc-400',
  ContainerCreating: 'text-amber-500',
  CrashLoopBackOff: 'text-red-500',
  Terminating: 'text-zinc-500',
  Succeeded: 'text-emerald-600',
}

/** Dialog showing what runs INSIDE a worker node (double-click a node to open).
 *  Explains the real-world node architecture: kubelet, containerd (CRI), CNI,
 *  kube-proxy, kernel namespaces/cgroups — plus the live pods on this node. */
export function NodeInternalsDialog() {
  const internalsNode = useCluster((s) => s.internalsNode)
  const setInternalsNode = useCluster((s) => s.setInternalsNode)
  const nodes = useCluster((s) => s.nodes)
  const pods = useCluster((s) => s.pods)

  if (!internalsNode) return null
  const node = nodes.find((n) => n.id === internalsNode)
  if (!node) return null

  const nodePods: Pod[] = pods.filter((p) => p.nodeId === node.id || p.requiredNode === node.id)
  const usage = nodeUsage(pods, node.id)

  return (
    <Dialog open onOpenChange={(o) => !o && setInternalsNode(null)}>
      <DialogContent className="max-w-xl bg-zinc-950 border-zinc-700 max-h-[88vh] overflow-y-auto custom-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-zinc-100 font-mono">
            <HardDrive className="h-4 w-4 text-emerald-500" />
            inside {node.name}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-1">
          {/* live stats */}
          <div className="flex gap-1.5 flex-wrap mb-2">
            <Badge variant="outline" className="text-[10px] font-mono border-zinc-700 text-zinc-300">cpu {usage.cpu}m / {node.cpuCapacity}m</Badge>
            <Badge variant="outline" className="text-[10px] font-mono border-zinc-700 text-zinc-300">mem {usage.mem}Mi / {node.memCapacity}Mi</Badge>
            <Badge variant="outline" className="text-[10px] font-mono border-zinc-700 text-zinc-300">pods {nodePods.length}</Badge>
          </div>

          <Layer icon={Shield} title="kernel: namespaces + cgroups" color="border-zinc-700 bg-zinc-900/60"
            sub="Pods look isolated because the Linux kernel gives each one its own PID/net/mount namespace and a cgroup CPU/memory budget. This is the foundation — 'containers' are just processes wearing these constraints.">
            <Arrow />
          </Layer>

          <Layer icon={Activity} title="kubelet — the node agent" color="border-emerald-700/60 bg-emerald-950/20"
            sub="Watches the API server for pods assigned to THIS node (spec.nodeName = node name). For each: writes containerd, reports status/heartbeats, runs liveness probes, restarts crashed containers with exponential backoff (10s→20s→40s… = CrashLoopBackOff).">
            <Arrow />
          </Layer>

          <Layer icon={Package} title="containerd — container runtime (CRI)" color="border-sky-700/60 bg-sky-950/20"
            sub="Actually runs containers: pulls images, creates the 'pause' sandbox container first, then app containers join that sandbox. kubelet never runs containers itself — it always talks CRI to containerd.">
            <Arrow />
          </Layer>

          <Layer icon={Cable} title="CNI plugin — pod networking" color="border-amber-700/60 bg-amber-950/20"
            sub="When a pod sandbox is created, CNI assigns the pod its own IP (that's why every pod is pingable), sets up a veth pair into the node bridge, and programs routes.">
            <Arrow />
          </Layer>

          <Layer icon={Gauge} title="kube-proxy — service VIP rules" color="border-violet-700/60 bg-violet-950/20"
            sub="Programs iptables/IPVS so ClusterIP VIPs (e.g. 10.96.x.x) load-balance to ready pods matching the service selector. NodePort opens the high port on this node.">
          </Layer>

          {/* live pods on this node */}
          <div className="rounded-lg border border-zinc-700 bg-zinc-900/60 p-2.5 mt-2">
            <div className="flex items-center gap-2 mb-1.5">
              <Boxes className="h-4 w-4 text-emerald-500" />
              <span className="text-xs font-semibold text-zinc-100 font-mono">pod sandboxes on this node ({nodePods.length})</span>
            </div>
            {nodePods.length === 0 ? (
              <div className="text-[10px] text-zinc-600 italic">no pods scheduled here yet</div>
            ) : (
              <div className="space-y-1">
                {nodePods.map((p) => (
                  <div key={p.id} className="flex items-center gap-2 text-[10px] font-mono">
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${p.phase === 'Running' ? 'bg-emerald-500' : p.phase === 'CrashLoopBackOff' ? 'bg-red-500 animate-pulse' : 'bg-zinc-400'}`} />
                    <span className="text-zinc-300 truncate">{p.name}</span>
                    <span className="text-zinc-600 truncate hidden sm:inline">pause + {p.image}</span>
                    <span className={`ml-auto shrink-0 ${phaseColor[p.phase] ?? 'text-zinc-400'}`}>{p.phase}</span>
                    {p.restarts > 0 && <span className="text-red-400 shrink-0">↻{p.restarts}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* how a pod lands on this node */}
          <div className="rounded-lg border border-zinc-800 bg-black/40 p-2.5 mt-2">
            <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold mb-1.5">how a pod gets here</div>
            <div className="text-[10px] text-zinc-400 leading-relaxed font-mono space-y-0.5">
              <div>1. you create a pod → API server stores the spec (node: &lt;none&gt;)</div>
              <div>2. scheduler scores nodes → writes node: <span className="text-emerald-400">{node.name}</span> into the pod spec</div>
              <div>3. kubelet (this node) sees it via its watch → calls containerd: pull image, create sandbox</div>
              <div>4. CNI gives the pod an IP → kube-proxy updates service rules → <span className="text-emerald-400">Running</span></div>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
