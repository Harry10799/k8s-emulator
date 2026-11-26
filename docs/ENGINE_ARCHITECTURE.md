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

This is an educational emulator, not a real Kubernetes API server and not a drop-in replacement for Kubernetes. The engine currently models Nodes, Pods, ReplicaSets, and Deployments. The Deployment controller retains revisioned ReplicaSets and performs readiness-gated rolling updates with surge/unavailable limits. The canvas adapter delegates Deployment desired-state decisions to this engine; the persistent canvas runtime now delegates Pod scheduling and kubelet/container lifecycle to the engine; non-Deployment controllers remain in the store.

The canvas keeps its existing Zustand-facing data shape as a projection, while `engine/canvas-runtime.ts` retains one EngineState across ticks. Pod scheduling, image pulls, container lifecycle, probes, restarts and resource-pressure handling run in that persistent engine state. The remaining legacy controller loops (DaemonSet, StatefulSet, Job/CronJob, PVC, Service and related resources) are still scheduled for migration.

## Directory map

- `engine/types.ts`: resource and state contracts.
- `engine/rng.ts`: seeded deterministic random source.
- `engine/scheduler.ts`: scheduling filters and scoring.
- `engine/reconcile.ts`: Deployment and ReplicaSet desired-state controllers plus status aggregation.
- `engine/engine.ts`: pure simulation step and resource insertion.
- `tests/engine.test.ts`: deterministic engine behavior tests.

## Next milestones

1. Migrate existing Zustand tick behavior to call the pure engine.
2. Add container lifecycle, probes, restart/backoff, requests/limits and QoS.
3. Add node heartbeat, cordon/drain, taints, affinity and topology spread.
4. Add HPA, metrics and PDB.
5. Add service endpoints, DNS, ingress, network policy and traffic simulation.
6. Add YAML import/export, terminal commands, snapshots and learning scenarios.


## Container lifecycle simulation

The kubelet stage now models per-container image-pull failures, startup/readiness/liveness probes, memory-limit OOM kills, finite process exits, restart policies, restart counts, and exponential restart backoff. Probe failures can be scheduled with explicit simulation ticks to keep scenarios deterministic. This is an educational approximation: the registry is simulated and actual processes are not executed.


## Resource management and QoS

The resource-management stage classifies Pods as Guaranteed, Burstable, or BestEffort from container requests and limits. Container workloads can specify deterministic CPU and memory usage: CPU above a configured limit is capped and the excess is reported as throttled millicores; memory usage above a container memory limit triggers the existing OOMKilled path. Each Pod and Node exposes simulated resource usage. Nodes raise MemoryPressure at 90% memory utilization and evict Pods until usage falls below 85%, preferring BestEffort, then Burstable, then Guaranteed Pods. These thresholds and eviction rules are educational approximations, not a complete kubelet implementation.


## Kubelet implementation boundary

Container lifecycle lives in engine/kubelet.ts, while the startup/readiness/liveness probe state machine is isolated in engine/probes.ts. Restart backoff is a container waiting state: after a container has started, a Pod remains Running while that container is in CrashLoopBackOff. Startup probe failures have their own StartupProbeFailed termination reason. The engine scheduler uses an in-place internal stage inside step(), avoiding a second full-state clone; the exported schedulePendingPods helper remains immutable for isolated callers.

The canvas now uses a persistent EngineState for Pod scheduling and kubelet lifecycle. The canvas store still owns the non-Deployment controller loops and projects engine Pod status into its existing UI model; the complete all-resource single-source-of-truth migration is not yet finished.

\n## Image registry and deterministic failures\n\nThe kubelet consults a simulated image catalogue rather than interpreting image-name substrings. Nodes maintain independent image caches. A known image missing from a node cache enters ContainerCreating while its configured pull duration elapses; a missing registry image reports ErrImagePull and exponential ImagePullBackOff retries. The initial node cache includes a small set of common tutorial images so existing quick-start scenarios remain immediate. Container crash rates are consumed from the injected seeded random source, and the canvas chaos monkey now uses its per-tick seeded source instead of Math.random.\n