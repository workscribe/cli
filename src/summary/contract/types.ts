import type { SCHEMA_VERSION } from './constants'
import type { LocationContext } from '../payload'
import type { GitCommit } from '../git-commits'

export interface EventJson {
  capturedAt: string
  category: string
  metadata: Record<string, unknown>
  /** Redacted, ≤120-char prefix of the command — only on unclassified (`other`) events. */
  hint?: string
  exitCode: number | null
  durationMs: number | null
  source: string | null
}

export interface CommitJson {
  hash: string | null
  subject: string
  source: 'git' | 'captured'
}

export interface SessionJson {
  key: string
  project: string | null
  repoName: string | null
  repoPath: string | null
  cwd: string | null
  branch: string | null
  startedAt: string
  endedAt: string
  durationMinutes: number
  eventCount: number
  notes: string[]
  commits: CommitJson[]
  events: EventJson[]
}

export interface SessionsJson {
  schemaVersion: typeof SCHEMA_VERSION
  date: string
  sessions: SessionJson[]
}

export interface EventsJson {
  schemaVersion: typeof SCHEMA_VERSION
  date: string
  total: number
  events: EventJson[]
}

/** Git facts for a session, looked up by the caller so the builders stay free of I/O. */
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
}

export interface EventsJsonOptions {
  limit?: number
  includeCategories: string[]
}
