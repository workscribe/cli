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
  source: string | null
  file_path: string | null
  /** The project, branch the event links to (migration 008) — null until linked; not read by anything yet */
  project_id?: number | null
  branch_id?: number | null
  /** The agent conversation a hook event came from (migration 012) */
  agent_session_id?: number | null
}
