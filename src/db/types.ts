// Plain interfaces — no DB import. Safe to use in tests without triggering node:sqlite.

export interface EventRow {
  id: number
  captured_at: string
  command: string
  cwd: string
  exit_code: number | null
  duration_ms: number | null
  repo_name: string | null
  branch: string | null
  category: string
  metadata: string | null
}

export interface SessionRow {
  id: number
  date: string
  started_at: string
  ended_at: string
  repo_name: string | null
  event_count: number
  summary: string | null
}
