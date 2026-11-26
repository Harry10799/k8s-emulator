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
 * Deployment controller with revisioned ReplicaSets and readiness-gated rolling updates.
 * New revisions scale up before old revisions scale down; old ReplicaSets remain as history.
 */
export function reconcileDeployments(state: EngineState): void {
  for (const deployment of deployments(state)) {
    const desired = Math.max(0, Math.floor(deployment.spec.replicas));
    const owned = ownedReplicaSets(state, deployment);
    const key = JSON.stringify(deployment.spec.template);
    let newest = owned.find((rs) => JSON.stringify(rs.spec.template) === key);
    if (!newest) {
      const revision = owned.reduce((max, rs) => Math.max(max, Number(rs.metadata.annotations["deployment.kubernetes.io/revision"] ?? 0)), 0) + 1;
      const name = `${deployment.metadata.name}-${revision}`;
      newest = {
        apiVersion: "apps/v1", kind: "ReplicaSet",
        metadata: { ...createMetadata(state, name, deployment.metadata.namespace ?? "default", deployment.spec.template.metadata.labels), annotations: { "deployment.kubernetes.io/revision": String(revision) } },
        spec: { replicas: owned.length === 0 ? desired : 0, selector: structuredClone(deployment.spec.selector), template: structuredClone(deployment.spec.template) },
        status: { observedGeneration: 1, replicas: 0, readyReplicas: 0, availableReplicas: 0 },
        ownerReferences: [{ uid: deployment.metadata.uid, kind: "Deployment", name: deployment.metadata.name }],
      };
      putResource(state, newest);
      appendEvent(state, "Normal", owned.length ? "RolloutStarted" : "SuccessfulCreate", owned.length ? `Deployment ${deployment.metadata.name} started rollout revision ${revision}` : `Created ReplicaSet ${name}`, deployment.metadata.name);
    }
    const oldSets = ownedReplicaSets(state, deployment).filter((rs) => rs.metadata.uid !== newest!.metadata.uid);
    const activePods = (rs: ReplicaSetResource) => ownedPods(state, rs).filter((p) => p.status.phase !== "Succeeded" && p.status.phase !== "Failed");
    const readyPods = (rs: ReplicaSetResource) => activePods(rs).filter((p) => p.status.phase === "Running" && p.status.conditions.some((c) => c.type === "Ready" && c.status));
    if (oldSets.length === 0) {
      if (newest.spec.replicas !== desired) {
        newest.spec.replicas = desired; newest.metadata.generation += 1; putResource(state, newest);
      }
      continue;
    }
    const surge = Math.max(0, Math.floor(deployment.spec.strategy?.maxSurge ?? 1));
    const unavailable = Math.max(0, Math.floor(deployment.spec.strategy?.maxUnavailable ?? 0));
    const allSets = [newest, ...oldSets];
    const totalActive = allSets.reduce((n, rs) => n + activePods(rs).length, 0);
    const totalReady = allSets.reduce((n, rs) => n + readyPods(rs).length, 0);
    const minAvailable = Math.max(0, desired - unavailable);
    if (newest.spec.replicas < desired && totalActive < desired + surge) {
      newest.spec.replicas = Math.min(desired, newest.spec.replicas + 1);
      newest.metadata.generation += 1; putResource(state, newest);
      appendEvent(state, "Normal", "ScalingReplicaSet", `Scaled new ReplicaSet ${newest.metadata.name} to ${newest.spec.replicas}`, newest.metadata.name);
    }
    if (totalReady >= minAvailable) {
      const old = oldSets.find((rs) => rs.spec.replicas > 0);
      if (old) {
        old.spec.replicas = Math.max(0, old.spec.replicas - 1);
        old.metadata.generation += 1; putResource(state, old);
        appendEvent(state, "Normal", "ScalingReplicaSet", `Scaled old ReplicaSet ${old.metadata.name} to ${old.spec.replicas}`, old.metadata.name);
      }
    }
    if (readyPods(newest).length >= desired) {
      for (const old of oldSets) if (old.spec.replicas > 0) {
        old.spec.replicas = 0; old.metadata.generation += 1; putResource(state, old);
      }
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
