import type { DeploymentResource, EngineState, PodResource, ReplicaSetResource } from "./types";
import { appendEvent, createMetadata, putResource, resourceKey } from "./resources";

function deployments(state: EngineState): DeploymentResource[] {
  return Object.values(state.resources).filter(
    (resource): resource is DeploymentResource => resource.kind === "Deployment",
  );
}

function replicaSets(state: EngineState): ReplicaSetResource[] {
  return Object.values(state.resources).filter(
    (resource): resource is ReplicaSetResource => resource.kind === "ReplicaSet",
  );
}

function ownedReplicaSets(state: EngineState, deployment: DeploymentResource): ReplicaSetResource[] {
  return replicaSets(state).filter(
    (resource) => resource.ownerReferences?.some((owner) => owner.uid === deployment.metadata.uid) === true,
  );
}

function ownedPods(state: EngineState, replicaSet: ReplicaSetResource): PodResource[] {
  return Object.values(state.resources).filter(
    (resource): resource is PodResource =>
      resource.kind === "Pod" && resource.ownerReferences?.some((owner) => owner.uid === replicaSet.metadata.uid) === true,
  );
}

/**
 * Deployment controller: ensure a ReplicaSet exists and propagate desired replicas.
 * This milestone intentionally models a single active ReplicaSet; rollout history
 * and multiple revisions are handled by a later rollout controller milestone.
 */
export function reconcileDeployments(state: EngineState): void {
  for (const deployment of deployments(state)) {
    const desired = Math.max(0, Math.floor(deployment.spec.replicas));
    let owned = ownedReplicaSets(state, deployment);

    if (owned.length === 0) {
      const name = `${deployment.metadata.name}-rs`;
      const replicaSet: ReplicaSetResource = {
        apiVersion: "apps/v1",
        kind: "ReplicaSet",
        metadata: createMetadata(
          state,
          name,
          deployment.metadata.namespace ?? "default",
          { ...deployment.spec.template.metadata.labels },
        ),
        spec: {
          replicas: desired,
          selector: structuredClone(deployment.spec.selector),
          template: structuredClone(deployment.spec.template),
        },
        status: { observedGeneration: 1, replicas: 0, readyReplicas: 0, availableReplicas: 0 },
        ownerReferences: [{ uid: deployment.metadata.uid, kind: "Deployment", name: deployment.metadata.name }],
      };
      putResource(state, replicaSet);
      appendEvent(state, "Normal", "SuccessfulCreate", `Created ReplicaSet ${name}`, deployment.metadata.name);
      owned = [replicaSet];
    }

    // One active ReplicaSet is supported until rollout revisions are introduced.
    const active = owned[0];
    if (active && active.spec.replicas !== desired) {
      active.spec.replicas = desired;
      active.metadata.generation += 1;
      putResource(state, active);
      appendEvent(state, "Normal", "ScalingReplicaSet", `Scaled ReplicaSet ${active.metadata.name} to ${desired}`, active.metadata.name);
    }
  }
}

/** ReplicaSet controller: reconcile its desired replica count into owned Pods. */
export function reconcileReplicaSets(state: EngineState): void {
  for (const replicaSet of replicaSets(state)) {
    const desired = Math.max(0, Math.floor(replicaSet.spec.replicas));
    const current = ownedPods(state, replicaSet).sort(
      (a, b) => a.metadata.creationTimestamp - b.metadata.creationTimestamp || a.metadata.name.localeCompare(b.metadata.name),
    );

    while (current.length > desired) {
      const pod = current.pop();
      if (pod) {
        delete state.resources[resourceKey(pod)];
        appendEvent(state, "Normal", "SuccessfulDelete", `Deleted pod ${pod.metadata.name} to match desired replicas`, replicaSet.metadata.name);
      }
    }

    while (current.length < desired) {
      const ordinal = current.length;
      const name = `${replicaSet.metadata.name}-${ordinal}`;
      const pod: PodResource = {
        apiVersion: "v1",
        kind: "Pod",
        metadata: createMetadata(
          state,
          name,
          replicaSet.metadata.namespace ?? "default",
          { ...replicaSet.spec.template.metadata.labels },
        ),
        spec: structuredClone(replicaSet.spec.template.spec),
        status: {
          phase: "Pending",
          conditions: [
            { type: "PodScheduled", status: false },
            { type: "Ready", status: false },
          ],
          containerStatuses: replicaSet.spec.template.spec.containers.map((container) => ({
            name: container.name,
            ready: false,
            restartCount: 0,
            state: "Waiting",
          })),
        },
        ownerReferences: [{ uid: replicaSet.metadata.uid, kind: "ReplicaSet", name: replicaSet.metadata.name }],
      };
      putResource(state, pod);
      current.push(pod);
      appendEvent(state, "Normal", "SuccessfulCreate", `Created pod ${name}`, replicaSet.metadata.name);
    }

    const owned = ownedPods(state, replicaSet);
    const ready = owned.filter(
      (pod) => pod.status.phase === "Running" && pod.status.conditions.some((condition) => condition.type === "Ready" && condition.status),
    ).length;
    replicaSet.status = {
      observedGeneration: replicaSet.metadata.generation,
      replicas: owned.length,
      readyReplicas: ready,
      availableReplicas: ready,
    };
    putResource(state, replicaSet);
  }
}

/** Aggregate ReplicaSet status back onto its owning Deployment. */
export function syncDeploymentStatuses(state: EngineState): void {
  for (const deployment of deployments(state)) {
    const owned = ownedReplicaSets(state, deployment);
    const replicas = owned.reduce((total, item) => total + item.status.replicas, 0);
    const ready = owned.reduce((total, item) => total + item.status.readyReplicas, 0);
    const desired = Math.max(0, Math.floor(deployment.spec.replicas));
    deployment.status = {
      observedGeneration: deployment.metadata.generation,
      replicas,
      updatedReplicas: replicas,
      readyReplicas: ready,
      availableReplicas: ready,
      conditions: [
        { type: "Available", status: ready > 0 || desired === 0, reason: ready > 0 ? "MinimumReplicasAvailable" : "MinimumReplicasUnavailable" },
        { type: "Progressing", status: replicas === desired, reason: replicas === desired ? "NewReplicaSetAvailable" : "ReplicaSetUpdating" },
      ],
    };
    putResource(state, deployment);
  }
}
