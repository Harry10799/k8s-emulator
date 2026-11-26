import type { EngineState, PersistentVolumeClaimResource } from "../types";
import { appendEvent, putResource } from "../resources";
import { values } from "./shared";

export function reconcilePersistentVolumeClaims(state: EngineState): void {
  for (const claim of values<PersistentVolumeClaimResource>(state, "PersistentVolumeClaim")) {
    if (claim.status.phase === "Pending" && state.tick - claim.metadata.creationTimestamp >= 3) {
      claim.status = { phase: "Bound", volumeName: `pv-${claim.metadata.uid}`, boundAtTick: state.tick };
      putResource(state, claim);
      appendEvent(state, "Normal", "Bound", `PersistentVolumeClaim ${claim.metadata.name} bound to ${claim.status.volumeName}`, claim.metadata.name);
    }
  }
}
