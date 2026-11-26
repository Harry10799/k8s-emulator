# Simulation engine architecture

The emulator uses a deterministic, framework-independent TypeScript engine. React and Zustand are UI concerns; simulation rules belong in `engine/` and must not import either library.

## Core contract

```ts
step(state, rng) -> nextState
```

- `step` never mutates its input. Retaining the previous state provides the foundation for pause/step/rewind and undo/redo.
- Randomness is injected through `RandomSource`; `createSeededRng(seed)` makes a run reproducible.
- Resources use Kubernetes-inspired `apiVersion`, `kind`, `metadata`, `spec`, and `status` shapes.
- Controllers run in control-plane order: Deployment creates/manages a ReplicaSet; ReplicaSet creates/deletes Pods; the scheduler binds eligible Pending Pods; the kubelet simulation starts containers and updates readiness.
- Deployment status is aggregated from its owned ReplicaSet, and ReplicaSet status is aggregated from its owned Pods.
- The scheduler filters nodes by readiness, cordon state, node selectors, taints/tolerations, and requested CPU/memory, then scores feasible nodes by remaining capacity.

## Current simulation boundary

This is an educational emulator, not a real Kubernetes API server and not a drop-in replacement for Kubernetes. The engine models Nodes, Pods, ReplicaSets, Deployments, DaemonSets, StatefulSets, Jobs, CronJobs, PersistentVolumeClaims, and Services. The Deployment controller retains revisioned ReplicaSets and performs readiness-gated rolling updates with surge/unavailable limits. The persistent canvas runtime synchronizes Deployment and ReplicaSet resources into EngineState; Deployment rollouts, ReplicaSet Pod ownership, Pod scheduling and kubelet/container lifecycle all execute through `step()`. First-class engine controllers now reconcile DaemonSets, StatefulSets, Jobs, CronJobs, PersistentVolumeClaims, and Services. A controller registry in `engine/controllers/` runs Deployment, ReplicaSet, DaemonSet, StatefulSet, Job, CronJob, PVC and Service reconciliation. The persistent canvas runtime projects controller-created Pods and updated ReplicaSet state back into the existing Zustand UI model. Duplicate Deployment/ReplicaSet, DaemonSet, StatefulSet, Job/CronJob, PVC and Service reconciliation loops have been removed from the store. Zustand now acts as the canvas-facing projection for these controller-owned resources.

The canvas keeps its existing Zustand-facing data shape as a projection, while `engine/canvas-runtime.ts` retains one EngineState across ticks. Pod scheduling, image pulls, container lifecycle, probes, restarts, seeded chaos injection and resource-pressure handling run in that persistent engine state. The store passes only the chaos-mode configuration; it no longer mutates Pod lifecycle state during ticks. Controller modules are covered by engine tests; the persistent canvas adapter has integration tests for Deployment/ReplicaSet Pod creation, DaemonSet Pod creation, Job completion persistence, and seeded chaos restart semantics. Canvas resource forms and Zustand remain compatibility-facing APIs; their mutations are synchronized into the retained EngineState on each tick.

## Directory map

- `engine/types.ts`: resource and state contracts.
- `engine/rng.ts`: seeded deterministic random source.
- `engine/scheduler.ts`: scheduling filters and scoring.
- `engine/reconcile.ts`: Deployment and ReplicaSet controller implementations plus status aggregation.
- `engine/controllers/`: modular DaemonSet, StatefulSet, Job, CronJob, PVC and Service controllers, shared helpers, and the ordered controller registry.
- `engine/engine.ts`: pure simulation step and resource insertion.
- `tests/engine.test.ts`: deterministic engine behavior tests.

## Engine API and external-store boundary

`engine/api.ts` provides validated create/get/list/update/patch/delete/scale operations, resourceVersion checks and cascading owner-reference deletion. Writes honor API-server and etcd availability. `src/lib/engine-store.ts` is the React adapter and exposes immutable snapshots with `useSyncExternalStore`. The canvas forms remain a compatibility projection pending their final CRUD migration.

## Control plane and node lifecycle

Scheduler and controller-manager availability are independent. With scheduler down, unscheduled Pods remain Pending with `PodScheduled=False` and reason `SchedulerUnavailable`; existing assigned Pods continue. With controller-manager down, desired-state reconciliation pauses while kubelet simulation continues. API-server and etcd failures reject writes and pause control-plane reconciliation. Node heartbeat timeout sets NotReady and adds the `node.kubernetes.io/not-ready:NoExecute` taint; non-tolerating Pods are evicted after the configured timeout. Cordon blocks scheduling; drain cordons and evicts workloads while preserving DaemonSet Pods by default.

## YAML and kubectl

`engine/manifest.ts` supports a constrained safe YAML subset (maps, sequences, scalars and inline JSON), multi-document manifests and apply. The parser supports maps, sequences, scalars and inline JSON, with multi-document apply. It is intentionally not a full YAML 1.2 parser. Manifest and kubectl helpers remain engine modules; the floating Engine Console UI has been removed in favor of the integrated Cluster health panel.


## Container lifecycle simulation

The kubelet stage now models per-container image-pull failures, startup/readiness/liveness probes, memory-limit OOM kills, finite process exits, restart policies, restart counts, and exponential restart backoff. Probe failures can be scheduled with explicit simulation ticks to keep scenarios deterministic. This is an educational approximation: the registry is simulated and actual processes are not executed.


## Resource management and QoS

The resource-management stage classifies Pods as Guaranteed, Burstable, or BestEffort from container requests and limits. Container workloads can specify deterministic CPU and memory usage: CPU above a configured limit is capped and the excess is reported as throttled millicores; memory usage above a container memory limit triggers the existing OOMKilled path. Each Pod and Node exposes simulated resource usage. Nodes raise MemoryPressure at 90% memory utilization and evict Pods until usage falls below 85%, preferring BestEffort, then Burstable, then Guaranteed Pods. These thresholds and eviction rules are educational approximations, not a complete kubelet implementation.


## Kubelet implementation boundary

Container lifecycle lives in engine/kubelet.ts, while the startup/readiness/liveness probe state machine is isolated in engine/probes.ts. Restart backoff is a container waiting state: after a container has started, a Pod remains Running while that container is in CrashLoopBackOff. Startup probe failures have their own StartupProbeFailed termination reason. The engine scheduler uses an in-place internal stage inside step(), avoiding a second full-state clone; the exported schedulePendingPods helper remains immutable for isolated callers.

The canvas now uses a persistent EngineState for Deployment/ReplicaSet reconciliation, workload controllers, Pod scheduling, kubelet lifecycle, chaos injection and resource management. The store no longer runs workload-controller or Pod-lifecycle tick loops. It remains a compatibility-facing command/UI projection: resource creation and editing are synchronized into EngineState at each tick, and short-lived Terminating/Succeeded canvas entries are garbage-collected by the UI projection. The engine API adapter and React `useSyncExternalStore` boundary now observe the same retained EngineState as the canvas runtime. Cluster-health controls operate on this shared state. Existing palette and edit-dialog CRUD actions still originate in the compatibility-facing Zustand projection and synchronize into the engine on simulation ticks; direct API routing for every legacy mutation remains the next migration step.


## Image registry and deterministic failures

The kubelet consults a simulated image catalogue rather than interpreting image-name substrings. Nodes maintain independent image caches. A known image missing from a node cache enters ContainerCreating while its configured pull duration elapses; a missing registry image reports ErrImagePull and exponential ImagePullBackOff retries. The initial node cache includes a small set of common tutorial images so existing quick-start scenarios remain immediate. Container crash rates are consumed from the injected seeded random source, and the canvas chaos monkey now uses its per-tick seeded source instead of Math.random.


## Shared engine state and cluster health

`engine/canvas-runtime.ts` owns the retained simulation state and publishes snapshots to subscribers after each engine tick. `src/lib/engine-store.ts` exposes the same state through `useSyncExternalStore` and routes API operations and node/control-plane actions to it; it no longer maintains a parallel simulation clock or duplicate state. The canvas shows a compact Cluster health panel rather than a separate terminal console. Node projection preserves heartbeat, Ready condition, taints and cordon state between ticks.

The remaining compatibility boundary is explicit: legacy canvas CRUD forms still update Zustand first, then the runtime synchronizes those objects into EngineState during the next simulation tick. The final migration is to route those create/update/delete/scale actions through the engine API and make the canvas a read-only projection.


## Interactive topology and request path

Topology cards expose connectable handles. The canvas accepts only supported source/target pairs and same-namespace relationships. Connections update the backing cluster resource through the existing edit action: Service selectors are copied from Deployment selectors, Ingress backends are set to the selected Service, ConfigMap/Secret references are written to Pods, and PVC size configures the connected StatefulSet storage template.

The topology view also provides a deterministic single-request exercise. It resolves the first visible Ingress, finds its configured Service, then selects a Running Pod matching the Service selector. Only that client → Ingress → Service → Pod path is highlighted during the request animation. Missing Ingress, Service backend, or ready endpoint is reported rather than fabricating a successful response. This is a simplified educational data-plane simulation, not a full kube-proxy or ingress-controller implementation.
