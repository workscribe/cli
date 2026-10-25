import { describe, it, expect } from 'vitest'
import { sessionKey, summaryEnginesFor, pickOwnSummary, pickBestSummary, isCachedEngine } from '../../src/summary/store'
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

describe('isCachedEngine', () => {
  it('never caches the template, which renders live', () => {
    expect(isCachedEngine('template')).toBe(false)
    expect(isCachedEngine('provider')).toBe(true)
    expect(isCachedEngine('ollama')).toBe(true)
  })
})

describe('summaryEnginesFor', () => {
  it('accepts 1.x summaries for the provider and ollama engines', () => {
    expect(summaryEnginesFor('provider')).toEqual(['provider', 'legacy'])
    expect(summaryEnginesFor('ollama')).toEqual(['ollama', 'legacy'])
  })
})

describe('pickOwnSummary', () => {
  it('ignores summaries written by another engine', () => {
    expect(pickOwnSummary([row('template', 'template text')], 'provider')).toBeNull()
    expect(pickOwnSummary([row('provider', 'provider text')], 'ollama')).toBeNull()
  })

  it('serves a 1.x summary to the provider engine', () => {
    expect(pickOwnSummary([row('legacy', 'old text')], 'provider')).toBe('old text')
  })

  it('prefers the newest accepted summary', () => {
    const rows = [row('legacy', 'old', '2026-10-01T00:00:00.000Z'), row('provider', 'new', '2026-10-25T00:00:00.000Z')]

    expect(pickOwnSummary(rows, 'provider')).toBe('new')
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
