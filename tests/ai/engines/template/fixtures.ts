import type { EventPayload, SessionPayload } from '../../../../src/ai/types'

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
    ...overrides,
  }
}
