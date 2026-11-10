import type { StoryCommit } from '../summary/story-commits'
import type { GitMove } from '../normalize/git-move'

export interface EventPayload {
  category: string
  metadata: Record<string, unknown>
  hint?: string
  /** Who captured the event (e.g. `claude-code` for a command a coding agent ran) — absent for plain shell commands. */
  source?: string
  /** The file a `code_edit` changed. Local only: the story counts files by it and never prints it. */
  filePath?: string
  /** The agent session the event belongs to (`agent_sessions.id`, so only meaningful within one database), if any */
  agentSessionId?: number
  exitCode: number | null
  durationMs: number | null
  /** The branch the event happened on (read just after the command ran), or null outside a repo */
  branch: string | null
  capturedAt: string
  /** Branch-moving git work the command did (a branch created, a stash, a rebase, a discard) — only when it succeeded */
  gitMoves?: GitMove[]
}

/** An agent conversation a session's events came from; `recap` is null unless one is stored and shown. */
export interface AgentSessionPayload {
  id: number
  source: string
  lastSeenAt: string
  recap: string | null
}

export interface SessionPayload {
  date: string
  project: string | null
  branch: string | null
  /** Every branch the session touched, in the order first seen — a session can span several */
  branches: string[]
  startTime: string
  endTime: string
  durationMinutes: number
  /** A thread's own active time (its 5-minute slots) — shown in its heading instead of `durationMinutes` */
  activeMinutes?: number
  /** For a thread: the names of the other projects worked in its block, in block order */
  alongside?: string[]
  /** For a thread: its project's id, so the week groups projects by identity; null outside any project */
  projectId?: number | null
  events: EventPayload[]
  /** The agent conversations its events came from (ids match `EventPayload.agentSessionId`) */
  agentSessions?: AgentSessionPayload[]
  /** The session's commits, each under the branch it was made on — captured ones, plus git's when it was asked */
  commits: StoryCommit[]
}

export interface DaySummaryPayload {
  date: string
  sessions: SessionPayload[]
}

/** How the week is laid out: each project then each branch (the default), or day by day. */
export type WeekLayout = 'project' | 'day'

export interface WeekSummaryPayload {
  weekStart: string
  weekEnd: string
  by: WeekLayout
  days: {
    date: string
    sessions: SessionPayload[]
  }[]
}

export interface AIProvider {
  summarize(payload: DaySummaryPayload): Promise<string>
  summarizeWeek?(payload: WeekSummaryPayload): Promise<string>
  validate(): Promise<void>
}
