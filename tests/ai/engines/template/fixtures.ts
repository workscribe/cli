import type { EventPayload, SessionPayload } from '../../../../src/ai/types'
import type { StoryCommit } from '../../../../src/summary/story-commits'

export function event(
  category: string,
  metadata: Record<string, unknown> = {},
  exitCode: number | null = 0
): EventPayload {
  return {
    category,
    metadata,
    exitCode,
    durationMs: null,
    branch: 'feature/auth',
    capturedAt: '2026-10-20T09:00:00.000Z',
  }
}

export function session(events: EventPayload[], overrides: Partial<SessionPayload> = {}): SessionPayload {
  return {
    date: '2026-10-20',
    project: 'api-service',
    branch: 'feature/auth',
    branches: ['feature/auth'],
    startTime: '09:00',
    endTime: '11:00',
    durationMinutes: 120,
    events,
    commits: [],
    ...overrides,
  }
}

/** An event on a given branch — the session's timeline decides which branch group it tells under. */
export function onBranch(branch: string | null, base: EventPayload): EventPayload {
  return { ...base, branch }
}

export function commit(subject: string, branch: string | null = 'feature/auth'): StoryCommit {
  return { subject, hash: null, committedAt: '2026-10-20T09:30:00.000Z', branch }
}
