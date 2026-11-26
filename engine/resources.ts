import type { EngineState, KubernetesResource, ObjectMetadata } from "./types";

export function resourceKey(resource: Pick<KubernetesResource, "kind" | "metadata">): string {
  const namespace = resource.kind === "Node" ? "" : resource.metadata.namespace ?? "default";
  return namespace ? `${resource.kind}:${namespace}/${resource.metadata.name}` : `${resource.kind}:${resource.metadata.name}`;
}

export function createMetadata(
  state: EngineState,
  name: string,
  namespace = "default",
  labels: Record<string, string> = {},
): ObjectMetadata {
  const id = state.nextId++;
  const resourceVersion = state.nextResourceVersion++;
  return {
    name,
    namespace,
    uid: `sim-${id}`,
    resourceVersion,
    generation: 1,
    labels: { ...labels },
    annotations: {},
    creationTimestamp: state.tick,
  };
}

export function putResource(state: EngineState, resource: KubernetesResource): void {
  resource.metadata.resourceVersion = state.nextResourceVersion++;
  state.resources[resourceKey(resource)] = resource;
}

export function appendEvent(
  state: EngineState,
  type: "Normal" | "Warning",
  reason: string,
  message: string,
  object: string,
): void {
  const id = `event-${state.nextId++}`;
  state.events.unshift({ id, tick: state.tick, type, reason, message, object });
  if (state.events.length > 200) state.events.length = 200;
}
