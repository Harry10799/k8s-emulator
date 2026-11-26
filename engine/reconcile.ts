import type { DeploymentResource, EngineState, PodResource } from "./types";
import { appendEvent, createMetadata, putResource, resourceKey } from "./resources";

function deployments(state: EngineState): DeploymentResource[] {
  return Object.values(state.resources).filter(
    (resource): resource is DeploymentResource => resource.kind === "Deployment",
  );
}

function ownedPods(state: EngineState, deployment: DeploymentResource): PodResource[] {
  return Object.values(state.resources).filter(
    (resource): resource is PodResource =>
      resource.kind === "Pod" && resource.ownerReferences?.some((owner) => owner.uid === deployment.metadata.uid) === true,
  );
}

/** Reconcile Deployment desired replicas against the Pods currently owned by it. */
export function reconcileDeployments(state: EngineState): void {
  for (const deployment of deployments(state)) {
    const desired = Math.max(0, Math.floor(deployment.spec.replicas));
    const current = ownedPods(state, deployment).sort(
      (a, b) => a.metadata.creationTimestamp - b.metadata.creationTimestamp || a.metadata.name.localeCompare(b.metadata.name),
    );

    while (current.length > desired) {
      const pod = current.pop();
      if (pod) {
        delete state.resources[resourceKey(pod)];
        appendEvent(state, "Normal", "SuccessfulDelete", `Deleted pod ${pod.metadata.name} to match desired replicas`, deployment.metadata.name);
      }
    }

    while (current.length < desired) {
      const ordinal = current.length;
      const name = `${deployment.metadata.name}-${ordinal}`;
      const labels = { ...deployment.spec.template.metadata.labels };
      const pod: PodResource = {
        apiVersion: "v1",
        kind: "Pod",
        metadata: createMetadata(state, name, deployment.metadata.namespace ?? "default", labels),
        spec: structuredClone(deployment.spec.template.spec),
        status: {
          phase: "Pending",
          conditions: [
            { type: "PodScheduled", status: false },
            { type: "Ready", status: false },
          ],
          containerStatuses: deployment.spec.template.spec.containers.map((container) => ({
            name: container.name,
            ready: false,
            restartCount: 0,
            state: "Waiting",
          })),
        },
        ownerReferences: [{ uid: deployment.metadata.uid, kind: "Deployment", name: deployment.metadata.name }],
      };
      putResource(state, pod);
      current.push(pod);
      appendEvent(state, "Normal", "SuccessfulCreate", `Created pod ${name}`, deployment.metadata.name);
    }

    const owned = ownedPods(state, deployment);
    const ready = owned.filter((pod) => pod.status.phase === "Running" && pod.status.conditions.some((condition) => condition.type === "Ready" && condition.status)).length;
    deployment.status = {
      observedGeneration: deployment.metadata.generation,
      replicas: owned.length,
      updatedReplicas: owned.length,
      readyReplicas: ready,
      availableReplicas: ready,
      conditions: [
        { type: "Available", status: ready > 0 || desired === 0, reason: ready > 0 ? "MinimumReplicasAvailable" : "MinimumReplicasUnavailable" },
        { type: "Progressing", status: owned.length === desired, reason: owned.length === desired ? "NewReplicaSetAvailable" : "ReplicaSetUpdating" },
      ],
    };
    putResource(state, deployment);
  }
}
