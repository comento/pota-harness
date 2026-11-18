import type { DagAgent, DagSnapshot, DagState, DagTask, DagUi } from "../types";

export type AgentEvent =
  | { type: "spawn"; id: string; name: string | null; description: string; model: string | null; parentId: string | null; mentions: string[]; at: number }
  | { type: "call"; id: string; activity: string; at: number }
  | { type: "done"; id: string; at?: number }
  | { type: "sync"; running: string[] };
export type RecentGoal = { goalId?: string; status?: string; endedAt?: string | number | null };

export declare const MAIN_AGENT_ID: "main";
export declare const MAX_AGENTS: number;
export declare const MUTATING_SUBS: ReadonlySet<string>;
export declare const DEBOUNCE_MS: number;
export declare const MIN_GAP_MS: number;
export declare const BACKOFF_MS: number;
export declare const BACKOFF_AFTER: number;
export declare function parsePotaGoalCommand(command: string): { subs: string[]; mutates: boolean; planned: boolean; root: string | null } | null;
export declare function describeToolCall(e: Record<string, unknown>): string;
export declare function extractTaskMentions(text: string, taskIds: readonly string[]): string[];
export declare function reduceAgents(prev: readonly DagAgent[], event: AgentEvent): DagAgent[];
export declare function resolveAgentTasks(agents: readonly DagAgent[], tasks: readonly DagTask[]): Record<string, string>;
export declare function initialDagState(): DagState;
export declare function reduceDagState(
  prev: DagState | null,
  input: { snapshot: DagSnapshot | null; error: string | null; now: number; recent?: readonly RecentGoal[] },
): DagState;
export declare function shouldAutoOpen(input: {
  planned: boolean;
  snapshot: DagSnapshot | null;
  ui: Pick<DagUi, "autoOpenedPlanKey" | "closedGoalId">;
  paneOpen: boolean;
}): boolean;
export declare function nextRefreshDelay(input: { now: number; lastRunAt: number; failures: number; reason: string }): number;
