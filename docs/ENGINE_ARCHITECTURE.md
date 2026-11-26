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
- `engine/reconcile.ts`: Deployment and ReplicaSet controller implementations plus status aggregation.\n- `engine/controllers/`: modular DaemonSet, StatefulSet, Job, CronJob, PVC and Service controllers, shared helpers, and the ordered controller registry.
- `engine/engine.ts`: pure simulation step and resource insertion.
- `tests/engine.test.ts`: deterministic engine behavior tests.

## Next milestones

1. Move remaining resource CRUD and ownership relationships behind the engine API; keep the canvas model as a read-only projection.
2. Add generation-aware rollout behavior for DaemonSet and StatefulSet, plus Job retry/backoff and CronJob history/TTL policies.
3. Expose engine snapshots and selectors through a dedicated external-store boundary; keep Zustand focused on UI state.
4. Add node heartbeat, cordon/drain, affinity and topology spread, then HPA, metrics and PDB.
5. Add service DNS, ingress, network policy, YAML import/export, terminal commands, snapshots and learning scenarios.


## Container lifecycle simulation

The kubelet stage now models per-container image-pull failures, startup/readiness/liveness probes, memory-limit OOM kills, finite process exits, restart policies, restart counts, and exponential restart backoff. Probe failures can be scheduled with explicit simulation ticks to keep scenarios deterministic. This is an educational approximation: the registry is simulated and actual processes are not executed.


## Resource management and QoS

The resource-management stage classifies Pods as Guaranteed, Burstable, or BestEffort from container requests and limits. Container workloads can specify deterministic CPU and memory usage: CPU above a configured limit is capped and the excess is reported as throttled millicores; memory usage above a container memory limit triggers the existing OOMKilled path. Each Pod and Node exposes simulated resource usage. Nodes raise MemoryPressure at 90% memory utilization and evict Pods until usage falls below 85%, preferring BestEffort, then Burstable, then Guaranteed Pods. These thresholds and eviction rules are educational approximations, not a complete kubelet implementation.


## Kubelet implementation boundary

Container lifecycle lives in engine/kubelet.ts, while the startup/readiness/liveness probe state machine is isolated in engine/probes.ts. Restart backoff is a container waiting state: after a container has started, a Pod remains Running while that container is in CrashLoopBackOff. Startup probe failures have their own StartupProbeFailed termination reason. The engine scheduler uses an in-place internal stage inside step(), avoiding a second full-state clone; the exported schedulePendingPods helper remains immutable for isolated callers.

The canvas now uses a persistent EngineState for Deployment/ReplicaSet reconciliation, workload controllers, Pod scheduling, kubelet lifecycle, chaos injection and resource management. The store no longer runs workload-controller or Pod-lifecycle tick loops. It remains a compatibility-facing command/UI projection: resource creation and editing are synchronized into EngineState at each tick, and short-lived Terminating/Succeeded canvas entries are garbage-collected by the UI projection. A dedicated external-store boundary and fully engine-owned CRUD API remain future work.

\n## Image registry and deterministic failures\n\nThe kubelet consults a simulated image catalogue rather than interpreting image-name substrings. Nodes maintain independent image caches. A known image missing from a node cache enters ContainerCreating while its configured pull duration elapses; a missing registry image reports ErrImagePull and exponential ImagePullBackOff retries. The initial node cache includes a small set of common tutorial images so existing quick-start scenarios remain immediate. Container crash rates are consumed from the injected seeded random source, and the canvas chaos monkey now uses its per-tick seeded source instead of Math.random.\n