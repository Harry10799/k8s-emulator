'use client'

import { useCluster } from '@/lib/cluster-store'
import { ScrollArea } from '@/components/ui/scroll-area'

export function EventFeed() {
  const events = useCluster((s) => s.events)
  const tickCount = useCluster((s) => s.tickCount)

  return (
    <div className="h-full flex flex-col bg-zinc-950 border-t border-zinc-800">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-800 shrink-0">
        <div className="text-[10px] uppercase tracking-wider text-zinc-500 font-semibold">Events · last 80</div>
        <div className="text-[10px] font-mono text-zinc-600">sim-time 00:{String(Math.floor(tickCount / 60)).padStart(2, '0')}:{String(tickCount % 60).padStart(2, '0')}</div>
      </div>
      <ScrollArea className="flex-1 px-3 py-1.5">
        {events.length === 0 ? (
          <div className="text-[11px] text-zinc-600 italic py-2">waiting for activity… drag a workload onto the canvas</div>
        ) : (
          events.map((e) => (
            <div key={e.id} className="flex items-baseline gap-2 py-0.5 font-mono text-[10.5px] leading-5">
              <span className="text-zinc-600 shrink-0">{e.time}</span>
              <span className={`shrink-0 ${e.type === 'Warning' ? 'text-red-400' : 'text-emerald-500'}`}>
                {e.type === 'Warning' ? 'W' : 'N'}
              </span>
              <span className="text-zinc-500 shrink-0">{e.reason}</span>
              <span className="text-zinc-400 truncate">{e.message}</span>
            </div>
          ))
        )}
      </ScrollArea>
    </div>
  )
}
