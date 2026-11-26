# Simulation engine architecture

The emulator uses a deterministic, framework-independent TypeScript engine. React and Zustand are UI concerns; simulation rules belong in `engine/` and must not import either library.

## Core contract

```ts
step(state, rng) -> nextState
```

- `step` never mutates its input. Retaining the previous state provides the foundation for pause/step/rewind and undo/redo.
- Randomness is injected through `RandomSource`; `createSeededRng(seed)` makes a run reproducible.
- Resources use Kubernetes-inspired `apiVersion`, `kind`, `metadata`, `spec`, and `status` shapes.
- Controllers reconcile desired state before scheduling. The first controller models Deployment replica reconciliation.
- The scheduler filters nodes by readiness, cordon state, node selectors, taints/tolerations, and requested CPU/memory, then scores feasible nodes by remaining capacity.

## Current simulation boundary

This is an educational emulator, not a real Kubernetes API server and not a drop-in replacement for Kubernetes. The first engine slice models Nodes, Pods, and Deployments. The existing canvas and Zustand simulation remain in place while the engine is introduced and tested independently; UI integration is a follow-up migration, not silently mixed into this foundation commit.

## Directory map

- `engine/types.ts`: resource and state contracts.
- `engine/rng.ts`: seeded deterministic random source.
- `engine/scheduler.ts`: scheduling filters and scoring.
- `engine/reconcile.ts`: desired-state reconciliation.
- `engine/engine.ts`: pure simulation step and resource insertion.
- `tests/engine.test.ts`: deterministic engine behavior tests.

## Next milestones

1. Migrate existing Zustand tick behavior to call the pure engine.
2. Add container lifecycle, probes, restart/backoff, requests/limits and QoS.
3. Add node heartbeat, cordon/drain, taints, affinity and topology spread.
4. Add rollout history, readiness-gated updates, HPA, metrics and PDB.
5. Add service endpoints, DNS, ingress, network policy and traffic simulation.
6. Add YAML import/export, terminal commands, snapshots and learning scenarios.
