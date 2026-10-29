import { describe, it, expect, vi } from 'vitest'

// day.ts reads saved summaries; the db module would load node:sqlite
vi.mock('../../src/db', () => ({ getSessionSummaries: vi.fn(() => []) }))
vi.mock('../../src/summary/day-commits', () => ({
  DAY_GIT_BUDGET_MS: 3000,
  lookupDayCommits: vi.fn((sessions: unknown[]) => sessions.map(() => null)),
}))

import { getSessionSummaries } from '../../src/db'
import { lookupDayCommits } from '../../src/summary/day-commits'
import { renderDay } from '../../src/summary/day'
import { capturedRow, session } from './contract/fixtures'
import type { WorkscribeConfig } from '../../src/config'

const CONFIG = {} as WorkscribeConfig
const API = session([capturedRow('npm test')], { repoName: 'api' })
const WEB = session([capturedRow('npm test')], { repoName: 'web', startedAt: '2026-10-25T13:00:00.000Z' })

function skillSummaryFor(repo: string, text: string) {
  vi.mocked(getSessionSummaries).mockImplementation((key: string) =>
    key.startsWith(`${repo}|`)
      ? [{ session_key: key, engine: 'skill', text, created_at: '2026-10-25T18:00:00.000Z' }]
      : []
  )
}

describe('renderDay', () => {
  it('uses a saved summary where the skill wrote one, and the writer for the rest', async () => {
    skillSummaryFor('api', '## api — 1h\n- From the skill')
    const provider = { summarize: vi.fn(async () => '## web — 1h\n- From the template'), validate: vi.fn() }

    const day = await renderDay({ date: '2026-10-25', sessions: [API, WEB], config: CONFIG, provider })

    expect(day.summaries).toEqual(['## api — 1h\n- From the skill', '## web — 1h\n- From the template'])
    expect(day.fullSummary).toBe('## api — 1h\n- From the skill\n\n## web — 1h\n- From the template')
    expect(day.saved.map((entry) => entry?.fromSkill ?? null)).toEqual([true, null])
    expect(day.needsGeneration).toBe(true)
  })

  it('asks git only about the sessions the template tells', async () => {
    skillSummaryFor('api', '## api — 1h\n- From the skill')
    const provider = { summarize: vi.fn(async () => 'text'), validate: vi.fn() }

    await renderDay({ date: '2026-10-25', sessions: [API, WEB], config: CONFIG, provider })

    expect(lookupDayCommits).toHaveBeenCalledWith([WEB], { budgetMs: 3000 })
  })

  it('ignores saved summaries with fresh', async () => {
    skillSummaryFor('api', '## api — 1h\n- From the skill')
    const provider = { summarize: vi.fn(async () => 'from the template'), validate: vi.fn() }

    const day = await renderDay({ date: '2026-10-25', sessions: [API], config: CONFIG, provider, fresh: true })

    expect(day.summaries).toEqual(['from the template'])
    expect(day.needsGeneration).toBe(true)
  })

  it('lets a failing writer throw, so the command can say so', async () => {
    vi.mocked(getSessionSummaries).mockReturnValue([])
    const provider = { summarize: vi.fn(async () => Promise.reject(new Error('disk full'))), validate: vi.fn() }

    await expect(renderDay({ date: '2026-10-25', sessions: [API], config: CONFIG, provider })).rejects.toThrow(
      'disk full'
    )
  })
})
