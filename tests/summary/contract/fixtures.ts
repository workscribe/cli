import { normalizeCommand } from '../../../src/normalize/patterns'
import type { EventRow } from '../../../src/db/types'
import type { DayBlock, DayThread } from '../../../src/db/day-threads'

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

export function thread(events: EventRow[], overrides: Partial<DayThread> = {}): DayThread {
  return {
    id: 1,
    blockId: 1,
    projectId: 4,
    key: 'api|2026-10-25T09:00:00.000Z',
    repoName: 'api',
    startedAt: '2026-10-25T09:00:00.000Z',
    endedAt: '2026-10-25T10:00:00.000Z',
    eventCount: events.length,
    activeSlots: 6,
    events,
    agentSessions: [],
    tickets: [],
    ...overrides,
  }
}

export function block(threads: DayThread[], overrides: Partial<DayBlock> = {}): DayBlock {
  return {
    id: 1,
    date: '2026-10-25',
    startedAt: '2026-10-25T09:00:00.000Z',
    endedAt: '2026-10-25T10:00:00.000Z',
    eventCount: threads.reduce((total, member) => total + member.eventCount, 0),
    activeSlots: 8,
    groupingVersion: 1,
    threads,
    summaries: [],
    ...overrides,
  }
}
