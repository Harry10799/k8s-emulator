# k8s-emulator

An interactive, educational Kubernetes cluster simulator. Build a cluster visually, create workloads and explore how scheduling, controllers, networking and failures affect the cluster.

> **Disclaimer:** This project is an unofficial educational simulator. It is not affiliated with, endorsed by, or supported by the Kubernetes project or the Cloud Native Computing Foundation (CNCF). It does not run a real Kubernetes control plane.

## Current capabilities

- Visual cluster canvas with nodes, workloads and Kubernetes resource inspectors.
- Simulated Pods, Deployments, ReplicaSets, DaemonSets, StatefulSets, Services, ConfigMaps, Secrets, Jobs, CronJobs, PVCs and Ingress.
- Tick-based workload lifecycle, scheduling, events and failure injection.
- A new isolated TypeScript simulation engine foundation with immutable state transitions, seeded randomness, Deployment reconciliation and scheduler filtering/scoring.

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

The existing Next.js/React Flow interface is under `src/`. The new pure TypeScript simulation foundation is under `engine/`; it deliberately has no React, Zustand, browser, or network dependencies.

See [docs/ENGINE_ARCHITECTURE.md](docs/ENGINE_ARCHITECTURE.md) for the engine contract, current boundaries and migration milestones.

## Roadmap

The next stages are UI integration, realistic container and node lifecycle, deployment rollouts, autoscaling, networking, storage/security modeling, YAML/kubectl workflows, and guided failure scenarios.
