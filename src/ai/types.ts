export interface EventPayload {
  category: string
  metadata: Record<string, unknown>
  hint?: string
  /** Who captured the event (e.g. `claude-code` for a command a coding agent ran) — absent for plain shell commands. */
  source?: string
  exitCode: number | null
  durationMs: number | null
}

export interface SessionPayload {
  date: string
  project: string | null
  branch: string | null
  startTime: string
  endTime: string
  durationMinutes: number
  events: EventPayload[]
}

export interface DaySummaryPayload {
  date: string
  sessions: SessionPayload[]
}

export interface WeekSummaryPayload {
  weekStart: string
  weekEnd: string
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
