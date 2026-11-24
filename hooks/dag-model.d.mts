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
export type DagTaskReceipt = {
  kind: string;
  command: string | null;
  exitCode: number | null;
  verifiedAt: string | null;
  fresh: boolean | null;
  outputDigest: string | null;
  watchFingerprint: string | null;
};
export type DagTaskTranscript = {
  turns: number;
  tokens: {
    input: number;
    cacheRead: number;
    output: number;
    cacheHitRate: number | null;
    truncated: boolean;
  };
  updatedAt: string | null;
};
export type DagTaskEnrichment = {
  approvalGate?: boolean;
  receipts?: DagTaskReceipt[];
  resolvedModel?: string;
  resolvedEffort?: string;
  resolvedTier?: string;
  transcript?: DagTaskTranscript;
};
export type GitDiffFile = {
  path: string;
  status: string;
  added: number;
  deleted: number;
  binary: boolean;
  sensitive: boolean;
};
export type GitDiffTotals = {
  files: number;
  added: number;
  deleted: number;
};
export type GitDiffSummary = {
  available: boolean;
  files: GitDiffFile[];
  totals: GitDiffTotals;
  truncated?: boolean;
};
export type PlanChecklistItem = {
  done: boolean;
  text: string;
};
export type PlanOverview = {
  planId: string | null;
  truncated: boolean;
  title: string | null;
  goalSummary: string | null;
  currentRequest: string | null;
  checklist: {
    done: number;
    pending: number;
    total: number;
    items: PlanChecklistItem[];
  };
};
type Linked = { id: string; dependsOn: readonly string[] };

export declare const VIEWS: readonly ["previous", "current", "next", "all"];
export declare function parseGoalStatus(stdout: string): { snapshot: DagSnapshot | null; error: string | null };
export declare function computeWaves(tasks: readonly Linked[]): { waveOf: Record<string, number>; waves: string[][] };
export declare function reduceEdges(tasks: readonly Linked[]): { from: string; to: string }[];
export declare function taskState(task: DagTask, byId: Map<string, DagTask>): TaskState;
export declare function focusIds(snapshot: DagSnapshot): string[];
export declare function buildDagModel(snapshot: DagSnapshot, view?: ViewId): DagModel;
export declare function summarize(snapshot: { tasks: DagTask[] }): DagSummary;
export declare function planKey(snapshot: DagSnapshot): string;
export declare function isSensitiveRepoPath(relPath: string): boolean;
export declare function normalizeRepoPath(relPath: string): string | null;
export declare function parseGitStatusAndNumstat(
  statusNulText: string,
  unstagedNumstatNulText: string,
  stagedNumstatNulText: string,
): GitDiffSummary & { available: true; truncated: false };
export declare function filterDiffByScope(
  diffSummary: { available?: boolean; files?: readonly GitDiffFile[] } | null | undefined,
  scopePaths: readonly string[] | null | undefined,
): { available: boolean; files: GitDiffFile[]; totals: GitDiffTotals };
export declare function parsePlanOverview(
  text: string,
  options?: { planId?: string | null; truncated?: boolean },
): PlanOverview;
