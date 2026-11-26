'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { PencilLine } from 'lucide-react'
import { useCluster, type ResourceKind } from '@/lib/cluster-store'

type Field =
  | { key: string; label: string; type: 'text' | 'number'; hint?: string }
  | { key: string; label: string; type: 'labels'; hint?: string }
  | { key: string; label: string; type: 'kv'; hint?: string }
  | { key: string; label: string; type: 'select'; options?: string[]; hint?: string }

const fields: Record<ResourceKind, Field[]> = {
  pod: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'image', label: 'Image', type: 'text', hint: 'e.g. nginx:latest' },
    { key: 'cpuRequest', label: 'CPU request (m)', type: 'number' },
    { key: 'memRequest', label: 'Memory request (Mi)', type: 'number' },
    { key: 'crashRate', label: 'Crash rate (0–1)', type: 'number', hint: '0.25 = crashes often' },
    { key: 'labels', label: 'Labels', type: 'labels', hint: 'app=web, tier=frontend' },
    { key: 'envConfigMap', label: 'Env from ConfigMap', type: 'select' },
    { key: 'envSecret', label: 'Env from Secret', type: 'select' },
  ],
  deployment: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'image', label: 'Image', type: 'text', hint: 'change = rolling update' },
    { key: 'replicas', label: 'Replicas', type: 'number' },
    { key: 'cpuRequest', label: 'CPU / pod (m)', type: 'number' },
    { key: 'memRequest', label: 'Mem / pod (Mi)', type: 'number' },
    { key: 'labels', label: 'Labels', type: 'labels' },
    { key: 'selector', label: 'Selector', type: 'labels', hint: 'must match pod labels' },
  ],
  replicaset: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'image', label: 'Image', type: 'text' },
    { key: 'replicas', label: 'Replicas', type: 'number' },
    { key: 'cpuRequest', label: 'CPU / pod (m)', type: 'number' },
    { key: 'memRequest', label: 'Mem / pod (Mi)', type: 'number' },
    { key: 'labels', label: 'Labels', type: 'labels' },
    { key: 'selector', label: 'Selector', type: 'labels' },
  ],
  daemonset: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'image', label: 'Image', type: 'text', hint: 'change = restart on every node' },
    { key: 'cpuRequest', label: 'CPU / pod (m)', type: 'number' },
    { key: 'memRequest', label: 'Mem / pod (Mi)', type: 'number' },
    { key: 'labels', label: 'Labels', type: 'labels' },
    { key: 'selector', label: 'Selector', type: 'labels' },
  ],
  statefulset: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'image', label: 'Image', type: 'text' },
    { key: 'replicas', label: 'Replicas (ordinals)', type: 'number' },
    { key: 'serviceName', label: 'Headless service', type: 'text' },
    { key: 'cpuRequest', label: 'CPU / pod (m)', type: 'number' },
    { key: 'memRequest', label: 'Mem / pod (Mi)', type: 'number' },
    { key: 'labels', label: 'Labels', type: 'labels' },
  ],
  service: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'serviceType', label: 'Type', type: 'select' },
    { key: 'port', label: 'Port', type: 'number' },
    { key: 'targetPort', label: 'Target port', type: 'number' },
    { key: 'selector', label: 'Selector', type: 'labels', hint: 'pods matching this get traffic' },
  ],
  configmap: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'data', label: 'Data', type: 'kv', hint: 'key=value per line' },
  ],
  secret: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'data', label: 'Data', type: 'kv', hint: 'key=value per line' },
  ],
  cronjob: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'schedule', label: 'Schedule (*/Ns)', type: 'text', hint: '*/15 = every 15s sim-time' },
    { key: 'image', label: 'Job image', type: 'text' },
    { key: 'duration', label: 'Job runtime (s)', type: 'number' },
    { key: 'cpuRequest', label: 'CPU (m)', type: 'number' },
    { key: 'memRequest', label: 'Mem (Mi)', type: 'number' },
  ],
  job: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'image', label: 'Image', type: 'text' },
    { key: 'duration', label: 'Runtime (s)', type: 'number' },
  ],
  node: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'cpuCapacity', label: 'CPU capacity (m)', type: 'number' },
    { key: 'memCapacity', label: 'Memory capacity (Mi)', type: 'number' },
  ],
}

function labelsToString(l?: Record<string, string>): string {
  return Object.entries(l ?? {}).map(([k, v]) => `${k}=${v}`).join(', ')
}

function stringToLabels(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  s.split(',').map((x) => x.trim()).filter(Boolean).forEach((pair) => {
    const idx = pair.indexOf('=')
    if (idx > 0) out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
  })
  return out
}

function kvToString(d?: Record<string, string>): string {
  return Object.entries(d ?? {}).map(([k, v]) => `${k}=${v}`).join('\n')
}

function stringToKv(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  s.split('\n').map((x) => x.trim()).filter(Boolean).forEach((pair) => {
    const idx = pair.indexOf('=')
    if (idx > 0) out[pair.slice(0, idx).trim()] = pair.slice(idx + 1).trim()
    else out[pair] = ''
  })
  return out
}

const kindLabel: Record<string, string> = {
  pod: 'Pod', deployment: 'Deployment', replicaset: 'ReplicaSet', daemonset: 'DaemonSet',
  statefulset: 'StatefulSet', service: 'Service', configmap: 'ConfigMap', secret: 'Secret',
  cronjob: 'CronJob', job: 'Job', node: 'Node',
}

export function EditDialog() {
  const editing = useCluster((s) => s.editing)
  if (!editing) return null
  return <EditForm key={editing} editing={editing} />
}

function EditForm({ editing }: { editing: string }) {
  const setEditing = useCluster((s) => s.setEditing)
  const updateResource = useCluster((s) => s.updateResource)
  const configMaps = useCluster((s) => s.configMaps)
  const secrets = useCluster((s) => s.secrets)

  const [kind, id] = editing.split(':')
  const schema = fields[kind as ResourceKind] ?? []

  const [values, setValues] = useState<Record<string, string>>(() => {
    const st = useCluster.getState()
    let res: Record<string, unknown> | undefined
    switch (kind) {
      case 'pod': res = st.pods.find((p) => p.id === id) as unknown as Record<string, unknown>; break
      case 'deployment': res = st.deployments.find((d) => d.id === id) as unknown as Record<string, unknown>; break
      case 'replicaset': res = st.replicaSets.find((r) => r.id === id) as unknown as Record<string, unknown>; break
      case 'daemonset': res = st.daemonSets.find((d) => d.id === id) as unknown as Record<string, unknown>; break
      case 'statefulset': res = st.statefulSets.find((d) => d.id === id) as unknown as Record<string, unknown>; break
      case 'service': res = st.services.find((v) => v.id === id) as unknown as Record<string, unknown>; break
      case 'configmap': res = st.configMaps.find((x) => x.id === id) as unknown as Record<string, unknown>; break
      case 'secret': res = st.secrets.find((x) => x.id === id) as unknown as Record<string, unknown>; break
      case 'cronjob': res = st.cronJobs.find((c) => c.id === id) as unknown as Record<string, unknown>; break
      case 'job': res = st.jobs.find((j) => j.id === id) as unknown as Record<string, unknown>; break
      case 'node': res = st.nodes.find((n) => n.id === id) as unknown as Record<string, unknown>; break
      default: res = undefined
    }
    const init: Record<string, string> = {}
    if (res) {
      for (const f of schema) {
        const v = res[f.key]
        if (f.type === 'labels') init[f.key] = labelsToString(v as Record<string, string>)
        else if (f.type === 'kv') init[f.key] = kvToString(v as Record<string, string>)
        else init[f.key] = String(v ?? '')
      }
    }
    return init
  })

  if (!values) return null

  const set = (k: string, v: string) => setValues((prev) => ({ ...prev, [k]: v }))

  const save = () => {
    const patch: Record<string, unknown> = {}
    for (const f of schema) {
      const raw = values[f.key] ?? ''
      if (f.type === 'labels') patch[f.key] = stringToLabels(raw)
      else if (f.type === 'kv') patch[f.key] = stringToKv(raw)
      else if (f.type === 'number') {
        const n = Number(raw)
        if (!Number.isNaN(n)) patch[f.key] = n
      } else {
        patch[f.key] = raw
      }
    }
    // env refs: empty string -> null
    if ('envConfigMap' in patch && !patch.envConfigMap) patch.envConfigMap = null
    if ('envSecret' in patch && !patch.envSecret) patch.envSecret = null
    updateResource(kind as ResourceKind, id, patch)
    setEditing(null)
  }

  return (
    <Dialog open onOpenChange={(o) => !o && setEditing(null)}>
      <DialogContent className="max-w-lg bg-zinc-950 border-zinc-700 max-h-[85vh] overflow-y-auto custom-scroll">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-zinc-100 font-mono">
            <PencilLine className="h-4 w-4 text-emerald-500" />
            Edit {kindLabel[kind] ?? kind}
          </DialogTitle>
        </DialogHeader>
        <div className="grid gap-3 py-1">
          {schema.map((f) => (
            <div key={f.key} className="grid gap-1">
              <Label className="text-xs text-zinc-400">{f.label}</Label>
              {f.type === 'select' && f.key === 'serviceType' && (
                <Select value={values[f.key] || 'ClusterIP'} onValueChange={(v) => set(f.key, v)}>
                  <SelectTrigger className="h-8 border-zinc-700 bg-zinc-900 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-700">
                    {['ClusterIP', 'NodePort', 'LoadBalancer'].map((o) => (
                      <SelectItem key={o} value={o} className="text-xs">{o}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {f.type === 'select' && (f.key === 'envConfigMap' || f.key === 'envSecret') && (
                <Select value={values[f.key] || 'none'} onValueChange={(v) => set(f.key, v === 'none' ? '' : v)}>
                  <SelectTrigger className="h-8 border-zinc-700 bg-zinc-900 text-xs">
                    <SelectValue placeholder="none" />
                  </SelectTrigger>
                  <SelectContent className="bg-zinc-900 border-zinc-700">
                    <SelectItem value="none" className="text-xs">none</SelectItem>
                    {(f.key === 'envConfigMap' ? configMaps : secrets).map((c) => (
                      <SelectItem key={c.id} value={c.name} className="text-xs font-mono">{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {(f.type === 'text' || f.type === 'number') && (
                <Input
                  value={values[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  type={f.type === 'number' ? 'number' : 'text'}
                  className="h-8 border-zinc-700 bg-zinc-900 text-xs font-mono"
                />
              )}
              {(f.type === 'labels' || f.type === 'kv') && (
                <Textarea
                  value={values[f.key] ?? ''}
                  onChange={(e) => set(f.key, e.target.value)}
                  rows={f.type === 'kv' ? 4 : 1}
                  className="border-zinc-700 bg-zinc-900 text-xs font-mono"
                />
              )}
              {f.hint && <span className="text-[10px] text-zinc-500">{f.hint}</span>}
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" size="sm" className="border-zinc-700 text-zinc-400" onClick={() => setEditing(null)}>Cancel</Button>
          <Button size="sm" className="bg-emerald-600 hover:bg-emerald-500 text-white" onClick={save}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
