import { formatDate } from '../utils/format'
import type { DaySummaryPayload, EventPayload, SessionPayload } from '../ai/types'
import type { EventRow } from '../db/types'
import type { Session } from '../sessions/detector'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Metadata is best-effort context for the summary — a corrupt or non-object row must not fail it
function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return isPlainObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function eventRowToPayload(row: EventRow): EventPayload {
  const metadata = parseMetadata(row.metadata)
  const payload: EventPayload = {
    category: row.category,
    metadata,
    exitCode: row.exit_code,
    durationMs: row.duration_ms,
  }
  if (row.category !== 'other' || typeof metadata.hint !== 'string') return payload

  // Unclassified commands carry their raw hint separately so the prompt can show it on its own
  const { hint, tool: _tool, ...rest } = metadata
  return { ...payload, hint, metadata: rest }
}

export function sessionToPayload(session: Session, date: string): SessionPayload {
  return {
    date,
    project: session.repoName,
    branch: session.events[0]?.branch ?? null,
    startTime: formatDate(session.startedAt),
    endTime: formatDate(session.endedAt),
    durationMinutes: session.durationMinutes,
    events: session.events.map(eventRowToPayload),
  }
}

export function buildDayPayload(date: string, sessions: Session[]): DaySummaryPayload {
  return { date, sessions: sessions.map((session) => sessionToPayload(session, date)) }
}
