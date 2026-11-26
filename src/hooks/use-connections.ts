'use client'

import { useCallback } from 'react'
import type { Connection } from '@xyflow/react'
import { useCluster } from '@/lib/cluster-store'

type Store = ReturnType<typeof useCluster.getState>
type WorkloadKind = 'deployment' | 'daemonset' | 'statefulset'

function decode(nodeId: string): { kind: string; id: string } | null {
  const match = /^t-([a-z]+)-(.+)$/.exec(nodeId)
  return match ? { kind: match[1], id: match[2] } : null
}

type Rule = {
  from: string
  to: string
  apply: (state: Store, fromId: string, toId: string) => string | null
}

const workloadKinds: WorkloadKind[] = ['deployment', 'daemonset', 'statefulset']
const templateReferenceRule = (kind: 'configmap' | 'secret'): Rule => ({
  from: kind,
  to: 'deployment|daemonset|statefulset',
  apply(state, fromId, toId) {
    const resource = kind === 'configmap'
      ? state.configMaps.find(item => item.id === fromId)
      : state.secrets.find(item => item.id === fromId)
    if (!resource) return null
    const workload = workloadKinds.flatMap(workloadKind => {
      const collection = workloadKind === 'deployment' ? state.deployments : workloadKind === 'daemonset' ? state.daemonSets : state.statefulSets
      return collection.filter(item => item.id === toId).map(item => ({ kind: workloadKind, item }))
    })[0]
    if (!workload || workload.item.namespace !== resource.namespace) return null
    const field = kind === 'configmap' ? 'envConfigMaps' : 'envSecrets'
    const names = [...new Set([...(workload.item[field] ?? []), resource.name])]
    state.updateResource(workload.kind, workload.item.id, { [field]: names })
    return `${workload.kind} ${workload.item.name} template now imports ${kind} ${resource.name}; controller rollout will recreate Pods`
  },
})

const CONNECTION_RULES: Rule[] = [
  { from: 'service', to: 'deployment', apply(state, fromId, toId) {
    const service = state.services.find(item => item.id === fromId)
    const deployment = state.deployments.find(item => item.id === toId)
    if (!service || !deployment || service.namespace !== deployment.namespace) return null
    state.updateResource('service', service.id, { selector: { ...deployment.selector } })
    return `Service ${service.name} now selects Deployment ${deployment.name}`
  }},
  { from: 'ingress', to: 'service', apply(state, fromId, toId) {
    const ingress = state.ingresses.find(item => item.id === fromId)
    const service = state.services.find(item => item.id === toId)
    if (!ingress || !service || ingress.namespace !== service.namespace) return null
    state.updateResource('ingress', ingress.id, { serviceName: service.name })
    return `Ingress ${ingress.name} now routes to Service ${service.name}`
  }},
  templateReferenceRule('configmap'),
  templateReferenceRule('secret'),
  { from: 'pvc', to: 'statefulset', apply(state, fromId, toId) {
    const pvc = state.pvcs.find(item => item.id === fromId)
    const sts = state.statefulSets.find(item => item.id === toId)
    if (!pvc || !sts || pvc.namespace !== sts.namespace || sts.replicas !== 1) return null
    state.updateResource('statefulset', sts.id, { storageGi: pvc.sizeGi, claimName: pvc.name })
    return `StatefulSet ${sts.name} now waits for PVC ${pvc.name} to be Bound`
  }},
]

export function useConnections(onMessage: (message: string) => void) {
  return useCallback((connection: Connection) => {
    if (!connection.source || !connection.target) return
    const source = decode(connection.source)
    const target = decode(connection.target)
    if (!source || !target) return
    const rule = CONNECTION_RULES.find(candidate => candidate.from === source.kind && candidate.to.split('|').includes(target.kind))
    if (!rule) {
      onMessage('Unsupported connection. Connect Service → Deployment, Ingress → Service, ConfigMap/Secret → workload template, or PVC → single-replica StatefulSet.')
      return
    }
    const message = rule.apply(useCluster.getState(), source.id, target.id)
    onMessage(message ?? 'Connection rejected: verify resource type, namespace and workload constraints.')
  }, [onMessage])
}
