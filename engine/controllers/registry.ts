import type { EngineState } from "../types";
import { reconcileDeployments, reconcileReplicaSets, syncDeploymentStatuses } from "../reconcile";
import { reconcileDaemonSets } from "./daemon-set";
import { reconcileStatefulSets } from "./stateful-set";
import { reconcileCronJobs } from "./cron-job";
import { reconcileJobs } from "./job";
import { reconcilePersistentVolumeClaims } from "./persistent-volume-claim";
import { reconcileServices } from "./service";
import { reconcileHorizontalPodAutoscalers } from "./horizontal-pod-autoscaler";
export interface EngineController { name: string; reconcile(state: EngineState): void; postReconcile?(state: EngineState): void; }
export const controllers: EngineController[] = [
 {name:"horizontal-pod-autoscaler",reconcile:reconcileHorizontalPodAutoscalers},
 {name:"deployment",reconcile:reconcileDeployments},
 {name:"replicaset",reconcile:reconcileReplicaSets,postReconcile:reconcileReplicaSets},
 {name:"daemonset",reconcile:reconcileDaemonSets,postReconcile:reconcileDaemonSets},
 {name:"statefulset",reconcile:reconcileStatefulSets,postReconcile:reconcileStatefulSets},
 {name:"cronjob",reconcile:reconcileCronJobs},
 {name:"job",reconcile:reconcileJobs,postReconcile:reconcileJobs},
 {name:"persistent-volume-claim",reconcile:reconcilePersistentVolumeClaims},
 {name:"service",reconcile:reconcileServices,postReconcile:reconcileServices},
 {name:"deployment-status",reconcile:syncDeploymentStatuses,postReconcile:syncDeploymentStatuses},
];
export function reconcileControllers(state: EngineState): void { controllers.forEach(controller => controller.reconcile(state)); }
export function reconcilePostKubeletControllers(state: EngineState): void { controllers.forEach(controller => controller.postReconcile?.(state)); }
