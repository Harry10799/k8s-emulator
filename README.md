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

## Engine console and known boundaries

Open the Engine Console in the lower-right of the canvas. The terminal supports `kubectl get`, `describe`, `logs`, `delete`, `scale`, `get events`, and `apply -f -` (the YAML editor is stdin). The YAML importer accepts multi-document manifests for supported core, apps and batch resources and normalizes common CPU/memory quantities. It is a safe YAML subset, not a complete YAML 1.2 implementation.

The console is an engine-owned API sandbox seeded with the canvas node inventory. The existing visual resource forms still use their compatibility-facing Zustand model; routing every legacy create/edit/delete action through the new engine CRUD API is the remaining cutover step. The simulator is educational and does not provide full Kubernetes API compatibility, admission, RBAC, PDB, or all kubectl flags.
