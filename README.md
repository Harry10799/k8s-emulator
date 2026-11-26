# k8s-emulator

An interactive, educational Kubernetes cluster simulator. Build a cluster visually, create workloads and explore how scheduling, controllers, networking and failures affect the cluster.

> **Disclaimer:** This project is an unofficial educational simulator. It is not affiliated with, endorsed by, or supported by the Kubernetes project or the Cloud Native Computing Foundation (CNCF). It does not run a real Kubernetes control plane.

## Current capabilities

- Visual cluster canvas with nodes, workloads and Kubernetes resource inspectors.
- Simulated Pods, Deployments, ReplicaSets, DaemonSets, StatefulSets, Services, ConfigMaps, Secrets, Jobs, CronJobs, PVCs and Ingress.
- Tick-based workload lifecycle, scheduling, events and failure injection.
- An isolated TypeScript simulation engine with immutable state transitions, seeded randomness, scheduler filtering/scoring, and a Deployment → ReplicaSet → Pod controller chain.
- Engine-owned resource CRUD with validation, optimistic resourceVersion checks and cascading deletion.
- A React external-store boundary using useSyncExternalStore, control-plane failure injection, node heartbeat/NotReady, eviction, cordon and drain.
- A built-in engine console with safe-subset YAML import and kubectl-style resource commands.

## Getting started

Requirements: [Bun](https://bun.sh/) and a supported Node.js runtime.

```bash
bun install
bun run db:generate
bun run dev
```

Open http://localhost:3000.

Set `DATABASE_URL` in your local `.env` file when using the Prisma-backed database. Never commit real credentials or local environment files.

## Quality checks

```bash
bun run lint
bun run test
bun run build
```

## Architecture

The existing Next.js/React Flow interface is under `src/`. The pure TypeScript simulation foundation is under `engine/`; it deliberately has no React, Zustand, browser, or network dependencies. The React adapter in `src/lib/engine-store.ts` exposes immutable engine snapshots through `useSyncExternalStore`.

See [docs/ENGINE_ARCHITECTURE.md](docs/ENGINE_ARCHITECTURE.md) for the engine contract, current boundaries and migration milestones.

## Cluster health and engine boundary

The canvas has an integrated **Cluster health** panel in the upper-right. It summarizes node readiness, Pod health and simulation tick, and exposes control-plane availability, node heartbeat, cordon/uncordon and drain scenarios without opening a separate terminal window.

The simulation and API adapter now share one retained EngineState. The engine's React adapter uses `useSyncExternalStore` and receives updates from the same runtime that advances the canvas. Existing palette and edit-dialog actions still pass through the compatibility-facing Zustand projection and are synchronized into the engine at simulation ticks; migrating every legacy CRUD action to direct API calls is the next cutover step. The YAML and kubectl engine modules remain available for a future native manifest/workflow surface, but are no longer presented as a floating console.

The simulator is educational and does not provide full Kubernetes API compatibility, admission, RBAC, PDB, or all kubectl flags.


### Interactive topology and traffic

The Topology view supports typed drag-to-connect relationships: Service → Deployment (copies the Deployment selector), Ingress → Service (sets the backend), ConfigMap/Secret → Pod (sets environment references), and PVC → StatefulSet (uses the claim size for the StatefulSet storage template). Select an explicit Ingress host/path rule and use **Send test request**. Requests route through the engine-published Service endpoint list (Ready Pods only); the deterministic engine traffic model selects an endpoint and reports status, latency and modeled error rate. A failed readiness probe therefore removes the Pod from routing naturally.


### Simulation controls, challenges and autoscaling

The canvas includes pause/resume, single-step and bounded rewind history (up to 120 ticks). The Simulation Lab includes a Pending Pod troubleshooting exercise and a readiness-gated zero-downtime rollout exercise with live validators. It also exposes a simulated CPU load control and can attach an autoscaling/v2-style HPA to a selected Deployment. HPA decisions use simulated CPU utilization and reconcile Deployment replicas within configured minimum/maximum bounds. This is an educational approximation of Kubernetes HPA behavior.
