import { normalizeCommand } from '../../../src/normalize/patterns'
import type { EventRow } from '../../../src/db/types'
import type { Session } from '../../../src/sessions/detector'

export const HOME = '/Users/dev'

export function row(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 1,
    captured_at: '2026-10-25T09:00:00.000Z',
    command: 'npm test',
    cwd: '/Users/dev/api',
    exit_code: 0,
    duration_ms: 1200,
    repo_name: 'api',
    branch: 'feature/auth',
    category: 'testing',
    metadata: null,
    source: 'shell',
    file_path: null,
    ...overrides,
  }
}

/** An event row built the way capture builds it: the real normalizer decides category and metadata. */
export function capturedRow(command: string, overrides: Partial<EventRow> = {}): EventRow {
  const { category, metadata } = normalizeCommand(command)
  return row({ command, category, metadata: JSON.stringify(metadata), ...overrides })
}

export function session(events: EventRow[], overrides: Partial<Session> = {}): Session {
  return {
    id: 1,
    date: '2026-10-25',
    startedAt: '2026-10-25T09:00:00.000Z',
    endedAt: '2026-10-25T10:00:00.000Z',
    repoName: 'api',
    durationMinutes: 60,
    eventCount: events.length,
    summary: null,
    events,
    ...overrides,
  }
}
