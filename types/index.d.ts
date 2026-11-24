// The Pota DAG pane's $.state contract: what the hooks module keeps for the session.

export type DagTaskReceipt = {
  kind: string
  command: string | null
  exitCode: number | null
  verifiedAt: string | null
  fresh: boolean | null
  outputDigest: string | null
  watchFingerprint: string | null
}

export type DagTaskTranscript = {
  turns: number
  tokens: {
    input: number
    cacheRead: number
    output: number
    cacheHitRate: number | null
    truncated: boolean
  }
  updatedAt: string | null
}

export type DagTask = {
  id: string
  title: string
  status: 'pending' | 'active' | 'blocked' | 'completed'
  dependsOn: string[]
  assignedAgentId: string | null
  route: 'light' | 'heavy' | null
  kind: 'design' | null
  effort: string | null
  model: string | null
  effectiveModel: string | null
  requiredEvidence: string[]
  /** Evidence kinds that have a receipt. */
  evidence: string[]
  writeScope: string[] | null
  blocker: string | null
  createdAt: number
  updatedAt: number
  approvalGate?: boolean
  receipts?: DagTaskReceipt[]
  resolvedModel?: string
  resolvedEffort?: string
  resolvedTier?: string
  transcript?: DagTaskTranscript
}

export type DagSnapshot = {
  goalId: string
  title: string
  planId: string
  status: 'active' | 'paused' | 'blocked' | 'cancelled' | 'completed'
  blocker: string | null
  revision: number
  createdAt: number
  requiredEvidence: string[]
  evidence: string[]
  tasks: DagTask[]
}

export type DagState = {
  /** Moves only when the snapshot's content changes. */
  seq: number
  snapshot: DagSnapshot | null
  ended: { status: 'completed' | 'cancelled' | 'unknown'; endedAt: number | null } | null
  error: string | null
  fetchedAt: number
  /** The root the snapshot was read from. */
  root: string | null
  /** The root of the session's own project root at that fetch. */
  home: string | null
  timeline: Record<string, { activeAt?: number; completedAt?: number }>
}

export type DagUi = {
  view: 'previous' | 'current' | 'next' | 'all'
  tab: 'dag' | 'diff' | 'plan' | 'stats'
  epoch: number
  minute: number
  autoOpenedPlanKey: string | null
  closedGoalId: string | null
  /** The running task whose detail block is open in the pane: one at a time, null when none. */
  expandedTaskId: string | null
  selectedTaskId: string | null
  actionError: string | null
}

export type DagAgent = {
  id: string
  name: string | null
  description: string
  model: string | null
  parentId: string | null
  mentions: string[]
  status: 'running' | 'done'
  activity: string
  activityAt: number
  calls: number
}

export type GitDiffFile = {
  path: string
  status: string
  added: number
  deleted: number
  binary: boolean
  sensitive: boolean
}

export type GitDiffSummary = {
  available: boolean
  files: GitDiffFile[]
  totals: {
    files: number
    added: number
    deleted: number
  }
  truncated?: boolean
}

export type PlanOverview = {
  planId: string | null
  truncated: boolean
  title: string | null
  goalSummary: string | null
  currentRequest: string | null
  checklist: {
    done: number
    pending: number
    total: number
    items: { done: boolean; text: string }[]
  }
}

export interface DagContext {
  diff: GitDiffSummary | null
  planOverview: PlanOverview | null
  gitCheckedAt: number
}

declare module 'claude-code' {
  interface PluginState {
    pota: { dag: Shaped<DagState>; dagUi: Shaped<DagUi>; dagAgents: Shaped<DagAgent[]>; dagContext: Shaped<DagContext>; }
  }
}
