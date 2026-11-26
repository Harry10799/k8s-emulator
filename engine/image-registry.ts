import type { EngineState, KubernetesResource } from "./types";

export interface ImageCatalogueEntry { repository: string; pullTicks: number }

const CATALOGUE: Record<string, ImageCatalogueEntry> = {
  nginx: { repository: "nginx", pullTicks: 1 },
  busybox: { repository: "busybox", pullTicks: 1 },
  postgres: { repository: "postgres", pullTicks: 2 },
  redis: { repository: "redis", pullTicks: 2 },
  alpine: { repository: "alpine", pullTicks: 2 },
  fluentd: { repository: "fluentd", pullTicks: 2 },
};

// These common images are preloaded in the starter cluster to keep first-run tutorials quick.
const STARTER_CACHE = ["nginx:1.27", "nginx:1.28", "busybox", "busybox:1.36"];

function repositoryOf(image: string): string {
  const withoutDigest = image.split("@", 1)[0];
  const last = withoutDigest.split("/").pop() ?? withoutDigest;
  const colon = last.lastIndexOf(":");
  return (colon > 0 ? last.slice(0, colon) : last).toLowerCase();
}

export function imageAvailable(image: string): boolean {
  return Boolean(CATALOGUE[repositoryOf(image)]);
}

export function imagePullDurationTicks(image: string): number {
  return CATALOGUE[repositoryOf(image)]?.pullTicks ?? 1;
}

export function createInitialImageCache(resources: KubernetesResource[]): Record<string, string[]> {
  const cache: Record<string, string[]> = {};
  for (const resource of resources) {
    if (resource.kind === "Node") cache[resource.metadata.uid] = [...STARTER_CACHE];
  }
  return cache;
}

export function isImageCached(state: EngineState, nodeName: string, image: string): boolean {
  const node = Object.values(state.resources).find((resource) => resource.kind === "Node" && resource.metadata.name === nodeName);
  return Boolean(node && state.imageCache[node.metadata.uid]?.includes(image));
}

export function cacheImage(state: EngineState, nodeName: string, image: string): void {
  const node = Object.values(state.resources).find((resource) => resource.kind === "Node" && resource.metadata.name === nodeName);
  if (!node) return;
  const cached = state.imageCache[node.metadata.uid] ?? (state.imageCache[node.metadata.uid] = []);
  if (!cached.includes(image)) cached.push(image);
}
