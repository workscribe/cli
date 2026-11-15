import type { EVENTS_SCHEMA_VERSION, HISTORY_SCHEMA_VERSION, SESSIONS_SCHEMA_VERSION } from './constants'
import type { LocationContext } from '../payload'
import type { GitCommit } from '../git-commits'

export interface EventJson {
  capturedAt: string
  category: string
  metadata: Record<string, unknown>
  /** Redacted, ≤120-char prefix of the command — only on unclassified (`other`) events. */
  hint?: string
  /** 0 passed, another code failed, -1 failed with no code known, null unknown (agent hooks that report none, interrupts) */
  exitCode: number | null
  durationMs: number | null
  source: string | null
}

export interface CommitJson {
  hash: string | null
  subject: string
  /** When it was made: git's committer date, or when Workscribe captured the `git commit`; null for an AI session's commits */
  committedAt: string | null
  source: 'git' | 'captured'
}

/** An agent conversation some of a thread's events came from. Never its working folder. */
export interface AgentSessionJson {
  source: string
  sessionId: string
  startedAt: string
  lastSeenAt: string
  /** When the agent ended it; null if it hasn't (or never said) */
  endedAt: string | null
  /** What the thread's events from this conversation add up to — never their paths */
  commandCount: number
  filesChanged: number
  /** The sum of the known counts of its edits; null when none had counts */
  linesAdded: number | null
  linesRemoved: number | null
  /** The agent's latest recap. Only there when `skill.includeAgentMessages` and `capture.agentMessages` are on. */
  recap?: string
}

/** A session is one project's thread inside a work block. */
export interface SessionJson {
  key: string
  project: string | null
  /** The project's name; null for the block's "elsewhere" thread (work outside any project) */
  repoName: string | null
  repoPath: string | null
  cwd: string | null
  branch: string | null
  /** Every branch the thread touched, in the order first seen */
  branches: string[]
  startedAt: string
  endedAt: string
  durationMinutes: number
  /** 5-minute slots with this project's activity */
  activeMinutes: number
  eventCount: number
  /** The block's `id` in this document; blocks are rebuilt, so it means nothing across runs */
  blockId: number
  /** The `key`s of the block's other threads, in block order */
  alongside: string[]
  agentSessions: AgentSessionJson[]
  /** Ticket keys the thread's branches and commits name (`tickets.pattern`), sorted; may be incomplete for history
   * until the `ticket-refs` upgrade has run */
  tickets: string[]
  notes: string[]
  commits: CommitJson[]
  events: EventJson[]
}

/** A work block: a stretch of work between idle gaps, across every project. */
export interface BlockJson {
  id: number
  startedAt: string
  endedAt: string
  eventCount: number
  /** 5-minute slots with any activity — time worked, never the sum of the threads' */
  activeMinutes: number
  threadKeys: string[]
}

export interface SessionsJson {
  schemaVersion: typeof SESSIONS_SCHEMA_VERSION
  date: string
  blocks: BlockJson[]
  sessions: SessionJson[]
}

export interface EventsJson {
  schemaVersion: typeof EVENTS_SCHEMA_VERSION
  date: string
  total: number
  events: EventJson[]
}

/** Git facts for a thread, looked up by the caller so the builders stay free of I/O. */
export interface SessionGitInfo {
  repoPath: string | null
  commits: GitCommit[]
  /** Recent commit subjects made only by other people — captured subjects matching them are not the user's. */
  othersSubjects: string[]
}

export interface SessionJsonOptions {
  location: LocationContext
  git: SessionGitInfo
  includeCategories: string[]
  /** Whether agent recaps go into `agentSessions` */
  includeAgentRecaps?: boolean
}

export interface EventsJsonOptions {
  limit?: number
  includeCategories: string[]
}

/** One command in a repo's history. No command text, folder or file path: the JSON is read by other tools. */
export interface HistoryEntryJson {
  capturedAt: string
  branch: string | null
  /** `shell`, `editor`, or the coding agent's name */
  source: string
  isGit: boolean
  /** As on an event: -1 is a failure with no code known, null is unknown */
  exitCode: number | null
  /** The branch moves it made, in plain language */
  moves: string[]
  /** Where git itself can show what it changed */
  recovery: string[]
}

export interface HistoryJson {
  schemaVersion: typeof HISTORY_SCHEMA_VERSION
  repo: string
  /** The start of the window, as an ISO timestamp */
  since: string
  entries: HistoryEntryJson[]
  /** Stashes nobody restored in the window */
  leftStashed: string[]
}
