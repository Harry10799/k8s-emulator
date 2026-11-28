'use client'

import { useMemo, useState } from 'react'
import type { EngineState, TrafficSample } from '../../../engine/types'

interface Props {
  state: EngineState;
  activeNamespace: string;
  onClose: () => void;
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function TrafficDashboard({ state, activeNamespace, onClose }: Props) {
  const [serviceKey, setServiceKey] = useState('all')
  const history = state.trafficHistory ?? []
  const services = useMemo(() => Object.values(state.resources)
    .filter(resource => resource.kind === 'Service' && (activeNamespace === 'all' || resource.metadata.namespace === activeNamespace))
    .map(resource => ({ key: `${resource.metadata.namespace ?? 'default'}/${resource.metadata.name}`, name: resource.metadata.name, namespace: resource.metadata.namespace ?? 'default' }))
    .sort((a, b) => a.key.localeCompare(b.key)), [state.resources, activeNamespace])
  const scoped = useMemo(() => history.filter(sample =>
    (activeNamespace === 'all' || sample.namespace === activeNamespace) &&
    (serviceKey === 'all' || `${sample.namespace}/${sample.serviceName}` === serviceKey)
  ), [history, activeNamespace, serviceKey])
  const successful = scoped.filter(sample => sample.ok)
  const failed = scoped.length - successful.length
  const avgLatency = successful.length ? successful.reduce((sum, sample) => sum + sample.latencyMs, 0) / successful.length : 0
  const maxLatency = Math.max(1, ...successful.map(sample => sample.latencyMs))
  const distribution = useMemo(() => {
    const counts = new Map<string, number>()
    for (const sample of scoped) {
      const key = sample.podName ?? 'No Pod selected'
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1])
  }, [scoped])
  const recentLatency = successful.slice(-24)
  const total = scoped.length
  const rate = total ? successful.length / total : 0
  const errorRate = total ? failed / total : 0
  const totalRecorded = history.length
  const globalCount = state.trafficRequestCount ?? 0

  return (
    <section aria-label="Traffic telemetry dashboard" className="absolute right-3 top-14 z-30 w-[min(440px,calc(100%-24px))] max-h-[calc(100%-100px)] overflow-y-auto rounded-xl border border-amber-600/40 bg-[var(--panel)] p-3 shadow-2xl">
      <header className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-500"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400"/> Live traffic telemetry</div>
          <p className="mt-1 text-[10px] text-[var(--muted-foreground)]">Measured from actual simulated Service requests · newest {totalRecorded} retained</p>
        </div>
        <button type="button" onClick={onClose} className="rounded border border-[var(--border)] px-2 py-1 text-[10px]">Close</button>
      </header>

      <div className="mt-3">
        <label className="mb-1 block text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]" htmlFor="traffic-service-filter">Scope</label>
        <select id="traffic-service-filter" value={serviceKey} onChange={event => setServiceKey(event.target.value)} className="w-full rounded-md border border-[var(--border)] bg-transparent px-2 py-2 text-[11px] text-[var(--foreground)]">
          <option value="all">All Services · {activeNamespace === 'all' ? 'all namespaces' : activeNamespace}</option>
          {services.map(service => <option key={service.key} value={service.key}>{service.namespace}/{service.name}</option>)}
        </select>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <Metric label="Requests (lifetime)" value={String(globalCount)} detail="Monotonic engine counter"/>
        <Metric label="Success rate" value={total ? percent(rate) : '—'} detail={`${successful.length} successful`}/>
        <Metric label="Error rate" value={total ? percent(errorRate) : '—'} detail={`${failed} failed responses`}/>
        <Metric label="Avg. successful latency" value={successful.length ? `${avgLatency.toFixed(1)} ms` : '—'} detail="Successful requests only"/>
      </div>

      <div className="mt-3 rounded-lg border border-[var(--border)] p-2.5">
        <div className="flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Latency trend</span><span className="text-[10px] text-[var(--muted-foreground)]">Last {recentLatency.length} successful</span></div>
        {recentLatency.length ? <div className="mt-3 flex h-16 items-end gap-1" role="img" aria-label="Latency bars for the most recent successful requests">
          {recentLatency.map((sample: TrafficSample) => <div key={sample.requestNumber} title={`Request #${sample.requestNumber}: ${sample.latencyMs} ms`} className="min-w-0 flex-1 rounded-t-sm bg-amber-500/75" style={{height:`${Math.max(8, sample.latencyMs / maxLatency * 100)}%`}}/>)}
        </div> : <p className="mt-3 text-[10px] text-[var(--muted-foreground)]">Send test requests to populate latency history.</p>}
      </div>

      <div className="mt-3 rounded-lg border border-[var(--border)] p-2.5">
        <div className="flex items-center justify-between"><span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Per-Pod request distribution</span><span className="font-mono text-[10px] text-[var(--muted-foreground)]">{total} requests</span></div>
        {distribution.length ? <div className="mt-2 space-y-2">
          {distribution.map(([pod, count]) => <div key={pod}>
            <div className="mb-1 flex items-center justify-between gap-2 text-[10px]"><span className="truncate font-mono text-[var(--foreground)]">{pod}</span><span className="shrink-0 text-[var(--muted-foreground)]">{count} · {percent(count / Math.max(1, total))}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-[var(--border)]"><div className="h-full rounded-full bg-amber-500" style={{width:`${count / Math.max(1, total) * 100}%`}}/></div>
          </div>)}
        </div> : <p className="mt-2 text-[10px] text-[var(--muted-foreground)]">No request distribution yet. Requests without a Ready endpoint are counted as “No Pod selected”.</p>}
      </div>

      <footer className="mt-3 border-t border-[var(--border)] pt-2 text-[10px] leading-relaxed text-[var(--muted-foreground)]">
        Window: last {totalRecorded} requests retained across the cluster (maximum 120). Current filter: {total} requests. This is request history, not an extrapolated RPS graph; configured load is shown separately in the topology controls.
      </footer>
    </section>
  )
}

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return <div className="rounded-lg border border-[var(--border)] p-2.5">
    <div className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">{label}</div>
    <div className="mt-1 font-mono text-lg font-semibold text-[var(--foreground)]">{value}</div>
    <div className="mt-0.5 text-[10px] text-[var(--muted-foreground)]">{detail}</div>
  </div>
}
