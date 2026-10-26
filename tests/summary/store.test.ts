import { describe, it, expect } from 'vitest'
import { pickSavedSummary, parseSessionKey, sessionKey, pickBestSummary } from '../../src/summary/store'
import { SESSION_KEY_SQL } from '../../src/db/migrations/005_session_summaries'
import type { SessionSummaryRow } from '../../src/db/types'

function row(engine: string, text: string, createdAt = '2026-10-25T09:00:00.000Z'): SessionSummaryRow {
  return { session_key: 'api|2026-10-25T08:00:00.000Z', engine, text, created_at: createdAt }
}

describe('sessionKey', () => {
  it('joins the repo and start time', () => {
    expect(sessionKey('api', '2026-10-25T08:00:00.000Z')).toBe('api|2026-10-25T08:00:00.000Z')
  })

  it('uses an empty repo for sessions outside a git repo', () => {
    expect(sessionKey(null, '2026-10-25T08:00:00.000Z')).toBe('|2026-10-25T08:00:00.000Z')
  })

  it('matches the expression migration 005 uses to backfill 1.x summaries', () => {
    expect(SESSION_KEY_SQL).toBe("COALESCE(repo_name, '') || '|' || started_at")
  })
})

describe('pickBestSummary', () => {
  it('is null when nothing is stored', () => {
    expect(pickBestSummary([])).toBeNull()
  })

  it('ranks skill over provider over template', () => {
    const rows = [row('template', 'template'), row('provider', 'provider'), row('skill', 'skill')]

    expect(pickBestSummary(rows)).toBe('skill')
    expect(pickBestSummary(rows.slice(0, 2))).toBe('provider')
  })

  it('ignores stale template rows so a live render always wins', () => {
    expect(pickBestSummary([row('template', 'stale template')])).toBeNull()
  })

  it('ignores engines this build does not know', () => {
    expect(pickBestSummary([row('future-engine', 'unknown')])).toBeNull()
  })

  it('takes the newest among equally ranked engines', () => {
    const rows = [row('legacy', 'old', '2026-10-01T00:00:00.000Z'), row('ollama', 'new', '2026-10-25T00:00:00.000Z')]

    expect(pickBestSummary(rows)).toBe('new')
  })
})

describe('parseSessionKey', () => {
  it('reverses sessionKey for a repo session', () => {
    expect(parseSessionKey(sessionKey('api', '2026-10-25T09:00:00.000Z'))).toEqual({
      repoName: 'api',
      startedAt: '2026-10-25T09:00:00.000Z',
    })
  })

  it('reverses sessionKey for a session outside a git repo', () => {
    expect(parseSessionKey(sessionKey(null, '2026-10-25T09:00:00.000Z'))).toEqual({
      repoName: null,
      startedAt: '2026-10-25T09:00:00.000Z',
    })
  })

  it('splits on the last | so a repo name containing one survives', () => {
    expect(parseSessionKey('odd|name|2026-10-25T09:00:00.000Z')?.repoName).toBe('odd|name')
  })

  it.each(['no-separator', 'api|', 'api|not-a-date'])('is null for the malformed key %s', (key) => {
    expect(parseSessionKey(key)).toBeNull()
  })
})

describe('pickSavedSummary', () => {
  it('prefers a skill summary over a 1.x AI summary', () => {
    const rows = [row('provider', 'provider'), row('skill', 'skill')]

    expect(pickSavedSummary(rows)).toEqual({ text: 'skill', fromSkill: true })
  })

  it.each(['provider', 'ollama', 'legacy'])('still serves a summary a 1.x %s engine wrote', (engine) => {
    expect(pickSavedSummary([row(engine, 'old')])).toEqual({ text: 'old', fromSkill: false })
  })

  it('takes the newest 1.x summary', () => {
    const rows = [
      row('legacy', 'older', '2026-10-24T09:00:00.000Z'),
      row('ollama', 'newer', '2026-10-25T09:00:00.000Z'),
    ]

    expect(pickSavedSummary(rows)?.text).toBe('newer')
  })

  it('never serves a stored template, which is always rendered fresh', () => {
    expect(pickSavedSummary([row('template', 'stale')])).toBeNull()
    expect(pickSavedSummary([])).toBeNull()
  })
})
