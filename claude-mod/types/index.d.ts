// The Pota DAG pane's $.state contract: what the hooks module keeps for the session.

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
  root: string | null
  timeline: Record<string, { activeAt?: number; completedAt?: number }>
}

export type DagUi = {
  view: 'previous' | 'current' | 'next' | 'all'
  epoch: number
  minute: number
  autoOpenedPlanKey: string | null
  closedGoalId: string | null
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

declare module 'claude-code' {
  interface PluginState {
    pota: { dag: Shaped<DagState>; dagUi: Shaped<DagUi>; dagAgents: Shaped<DagAgent[]> }
  }
}
