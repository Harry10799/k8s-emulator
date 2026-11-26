'use client'
import { useSyncExternalStore } from 'react'
import { createInitialState } from '../../engine/engine'
import { createResource, deleteResource, getResource, listResources, scaleResource, updateResource } from '../../engine/api'
import { cordonNode, drainNode, setNodeHeartbeat } from '../../engine/node-lifecycle'
import { applyManifests, runKubectl } from '../../engine/manifest'
import type { EngineState, KubernetesResource } from '../../engine/types'
import { getCanvasRuntimeState, setCanvasRuntimeState, subscribeCanvasRuntime } from '../../engine/canvas-runtime'

const publish = (next: EngineState) => setCanvasRuntimeState(next)

export const engineStore = {
  getSnapshot: getCanvasRuntimeState,
  subscribe: subscribeCanvasRuntime,
  reset: (resources: KubernetesResource[] = []) => publish(createInitialState(resources)),
  create: (resource: KubernetesResource) => {
    const result = createResource(getCanvasRuntimeState(), resource)
    if (result.ok && result.state) publish(result.state)
    return result
  },
  get: getResource,
  list: listResources,
  update: (resource: KubernetesResource, expectedVersion?: number) => {
    const result = updateResource(getCanvasRuntimeState(), resource, expectedVersion)
    if (result.ok && result.state) publish(result.state)
    return result
  },
  delete: (kind: any, name: string, namespace = 'default', cascade = true) => {
    const result = deleteResource(getCanvasRuntimeState(), kind, name, namespace, cascade)
    if (result.ok && result.state) publish(result.state)
    return result
  },
  scale: (kind: any, name: string, replicas: number, namespace = 'default') => {
    const result = scaleResource(getCanvasRuntimeState(), kind, name, replicas, namespace)
    if (result.ok && result.state) publish(result.state)
    return result
  },
  setLoadPercent: (percent: number) => { const next = structuredClone(getCanvasRuntimeState()); next.simulatedLoadPercent = Math.max(0, Math.min(300, Math.round(percent))); publish(next) },
  setControlPlane: (key: 'apiServerAvailable' | 'schedulerAvailable' | 'controllerManagerAvailable' | 'etcdAvailable', available: boolean) => {
    const next = structuredClone(getCanvasRuntimeState())
    next.controlPlane ??= { apiServerAvailable: true, schedulerAvailable: true, controllerManagerAvailable: true, etcdAvailable: true }
    next.controlPlane[key] = available
    publish(next)
  },
  setHeartbeat: (name: string, enabled: boolean) => publish(setNodeHeartbeat(getCanvasRuntimeState(), name, enabled)),
  cordon: (name: string, value = true) => publish(cordonNode(getCanvasRuntimeState(), name, value)),
  drain: (name: string) => publish(drainNode(getCanvasRuntimeState(), name)),
  applyYaml: (yaml: string) => {
    const result = applyManifests(getCanvasRuntimeState(), yaml)
    publish(result.state)
    return result.messages
  },
  kubectl: (command: string, stdin?: string) => {
    const current = getCanvasRuntimeState()
    const result = runKubectl(current, command, stdin)
    if (result.state !== current) publish(result.state)
    return result
  },
}

export function useEngineSnapshot<T>(selector: (state: EngineState) => T): T {
  const state = useSyncExternalStore(engineStore.subscribe, engineStore.getSnapshot, engineStore.getSnapshot)
  return selector(state)
}
