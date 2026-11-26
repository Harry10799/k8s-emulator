'use client'

import { useCallback, useEffect, useState } from 'react'
import { useCluster } from '@/lib/cluster-store'
import { engineStore } from '@/lib/engine-store'

export interface TrafficRoute { ingressId: string; serviceId: string; podId: string }

export function useTraffic(activeNamespace: string) {
  const [selectedIngressId, setSelectedIngressId] = useState('')
  const [trafficRoute, setTrafficRoute] = useState<TrafficRoute | null>(null)
  const [trafficMessage, setTrafficMessage] = useState('')
  const [trafficRps, setTrafficRpsState] = useState(engineStore.getSnapshot().simulatedRequestsPerSecond ?? 0)
  const setTrafficRps = useCallback((value: number) => { const next = Math.max(0, Math.min(100, Math.round(value))); setTrafficRpsState(next); engineStore.setTrafficRps(next) }, [])
  useEffect(() => {
    if (!trafficRoute) return
    const timer = window.setTimeout(() => setTrafficRoute(null), 2200)
    return () => window.clearTimeout(timer)
  }, [trafficRoute])
  const sendRequest = useCallback(() => {
    const state = useCluster.getState()
    const ingress = state.ingresses.find(item => item.id === selectedIngressId && (activeNamespace === 'all' || item.namespace === activeNamespace))
    if (!ingress) { setTrafficMessage('Select an Ingress host/path rule in the current namespace'); return }
    const service = state.services.find(item => item.namespace === ingress.namespace && item.name === ingress.serviceName)
    if (!service) { setTrafficMessage(`Ingress ${ingress.name} has no matching Service backend`); return }
    const result = engineStore.simulateTraffic(ingress.namespace, service.name)
    if (!result.podName) { setTrafficMessage(`Request ${result.statusCode} · ${ingress.host}${ingress.path} → ${service.name} · ${result.reason}`); return }
    const podId = state.pods.find(pod => pod.namespace === ingress.namespace && pod.name === result.podName)?.id ?? ''
    setTrafficMessage(`${result.statusCode} · ${ingress.host}${ingress.path} → ${service.name} → ${result.podName} · ${result.latencyMs}ms · ${Math.round(result.errorRate * 100)}% modeled error rate${result.ok ? '' : ' · upstream error'}`)
    setTrafficRoute({ ingressId: ingress.id, serviceId: service.id, podId })
  }, [activeNamespace, selectedIngressId])
  return { selectedIngressId, setSelectedIngressId, trafficRoute, trafficMessage, setTrafficMessage, sendRequest, trafficRps, setTrafficRps }
}
