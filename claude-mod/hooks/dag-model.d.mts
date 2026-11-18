import type { DagSnapshot, DagTask } from "../types";

export type TaskState = "completed" | "active" | "blocked" | "ready" | "waiting";
export type ViewId = "previous" | "current" | "next" | "all";
export type DagNode = { id: string; wave: number; role: "focus" | "context"; state: TaskState; task: DagTask };
export type DagEdge = { from: string; to: string; state: "done" | "flow" | "wait" | "blocked" };
export type DagWave = { index: number; total: number; completed: number; active: number; blocked: number };
export type DagModel = {
  view: ViewId;
  nodes: DagNode[];
  edges: DagEdge[];
  waves: DagWave[];
  empty: null | "no-completed" | "no-next";
  hiddenAfter: number;
};
export type DagSummary = {
  waveCurrent: number;
  waveTotal: number;
  done: number;
  total: number;
  running: number;
  blocked: number;
  ready: number;
  models: string[];
  allDone: boolean;
};
type Linked = { id: string; dependsOn: readonly string[] };

export declare const VIEWS: readonly ["previous", "current", "next", "all"];
export declare function parseGoalStatus(stdout: string): { snapshot: DagSnapshot | null; error: string | null };
export declare function computeWaves(tasks: readonly Linked[]): { waveOf: Record<string, number>; waves: string[][] };
export declare function reduceEdges(tasks: readonly Linked[]): { from: string; to: string }[];
export declare function taskState(task: DagTask, byId: Map<string, DagTask>): TaskState;
export declare function focusIds(snapshot: DagSnapshot): string[];
export declare function buildDagModel(snapshot: DagSnapshot, view: ViewId): DagModel;
export declare function summarize(snapshot: { tasks: DagTask[] }): DagSummary;
export declare function planKey(snapshot: DagSnapshot): string;
