import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/summary/day-commits', () => ({
  DAY_GIT_BUDGET_MS: 3000,
  lookupDayCommits: vi.fn((windows: unknown[]) => windows.map(() => null)),
}))

import { lookupDayCommits } from '../../src/summary/day-commits'
import { renderDay } from '../../src/summary/day'
import { block, row, thread } from './contract/fixtures'
import type { SummaryRow } from '../../src/db/summary-store'
import type { WorkscribeConfig } from '../../src/config'

const CONFIG = {} as WorkscribeConfig
const CLI = 1
const VSCODE = 2
const SITE = 3

function event(id: number, minute: number, repo: string) {
  return row({
    id,
    captured_at: new Date(Date.parse('2026-10-28T12:09:00.000Z') + minute * 60_000).toISOString(),
    cwd: `/Users/dev/${repo}`,
    repo_name: repo,
  })
}

// 2026-10-28's shape: cli and vscode interleaved, landing-page's saves in between
const CLI_THREAD = thread([event(1, 0, 'cli'), event(3, 20, 'cli'), event(5, 50, 'cli')], {
  id: 10,
  projectId: CLI,
  repoName: 'cli',
  key: 'cli|2026-10-28T12:09:00.000Z',
  startedAt: '2026-10-28T12:09:00.000Z',
  endedAt: '2026-10-28T13:48:00.000Z',
  activeSlots: 16,
})
const VSCODE_THREAD = thread([event(2, 6, 'vscode')], { id: 11, projectId: VSCODE, repoName: 'vscode', activeSlots: 6 })
const SITE_THREAD = thread([event(4, 21, 'landing-page'), event(6, 91, 'landing-page')], {
  id: 12,
  projectId: SITE,
  repoName: 'landing-page',
  activeSlots: 1,
})

function summaryRow(overrides: Partial<SummaryRow>): SummaryRow {
  return {
    id: 1,
    scope: 'session',
    project_id: SITE,
    first_event_id: 4,
    last_event_id: 6,
    engine: 'skill',
    text: '## landing-page — 5m\n- Rewrote the README',
    created_at: '2026-10-28T20:00:00.000Z',
    source_key: 'landing-page|2026-10-28T12:30:00.000Z',
    origin: 'saved',
    anchor_source: 'thread',
    is_mixed: 0,
    ...overrides,
  }
}

function dayOf(summaries: SummaryRow[] = []) {
  return [block([CLI_THREAD, VSCODE_THREAD, SITE_THREAD], { id: 5, activeSlots: 18, summaries })]
}

function templateProvider() {
  return {
    summarize: vi.fn(async ({ sessions: [session] }) => `## ${session.project}\n- From the template`),
    validate: vi.fn(),
  }
}

describe('renderDay', () => {
  it('tells each thread in its own section, with its own active time and the projects alongside it', async () => {
    const provider = templateProvider()

    const day = await renderDay({ date: '2026-10-28', blocks: dayOf(), config: CONFIG, provider })

    expect(day.sessionPayloads.map((payload) => [payload.project, payload.activeMinutes, payload.alongside])).toEqual([
      ['cli', 80, ['vscode', 'landing-page']],
      ['vscode', 30, ['cli', 'landing-page']],
      ['landing-page', 5, ['cli', 'vscode']],
    ])
    expect(day.sessionPayloads[0].durationMinutes).toBe(99)
    expect(day.fullSummary).toBe(
      [
        '## cli\n- From the template\nAlongside: vscode, landing-page',
        '## vscode\n- From the template\nAlongside: cli, landing-page',
        '## landing-page\n- From the template\nAlongside: cli, vscode',
        'Time worked: 1h 30m',
      ].join('\n\n')
    )
    // The per-thread texts JSON bullets come from carry neither added line
    expect(day.summaries.join('\n')).not.toMatch(/Alongside:|Time worked:/)
  })

  it("counts time worked from the blocks, never the sum of the threads'", async () => {
    const second = block([thread([event(9, 300, 'cli')], { id: 20, activeSlots: 3 })], { id: 6, activeSlots: 3 })

    const day = await renderDay({
      date: '2026-10-28',
      blocks: [...dayOf(), second],
      config: CONFIG,
      provider: templateProvider(),
    })

    expect(day.activeMinutes).toBe(105)
    expect(day.fullSummary.endsWith('Time worked: 1h 45m')).toBe(true)
    // A block of one thread has no one alongside
    expect(day.fullSummary).toContain('## api\n- From the template\n\nTime worked')
  })

  it("shows the summary saved for a small thread worked in between a busier project's events", async () => {
    const provider = templateProvider()

    const day = await renderDay({ date: '2026-10-28', blocks: dayOf([summaryRow({})]), config: CONFIG, provider })

    expect(day.summaries[2]).toBe('## landing-page — 5m\n- Rewrote the README')
    expect(day.saved.map((entry) => entry?.fromSkill ?? null)).toEqual([null, null, true])
    expect(day.fullSummary).toContain('- Rewrote the README\nAlongside: cli, vscode')
    expect(provider.summarize).toHaveBeenCalledTimes(2)
    expect(day.needsGeneration).toBe(true)
  })

  it("never shows a mapped summary that fits no thread, like session 183's", async () => {
    const mixed = summaryRow({ first_event_id: 1, last_event_id: 6, origin: 'mapped', anchor_source: 'cached' })

    const day = await renderDay({
      date: '2026-10-28',
      blocks: dayOf([mixed]),
      config: CONFIG,
      provider: templateProvider(),
    })

    expect(day.saved).toEqual([null, null, null])
  })

  it('shows a mapped summary on the thread that holds most of its range, and never a template row', async () => {
    const mapped = summaryRow({
      project_id: CLI,
      first_event_id: 1,
      last_event_id: 3,
      origin: 'mapped',
      anchor_source: 'cached',
      text: 'old cli summary',
      engine: 'legacy',
    })
    const template = summaryRow({
      id: 2,
      project_id: VSCODE,
      first_event_id: 2,
      last_event_id: 2,
      engine: 'template',
      text: 'stale',
    })

    const day = await renderDay({
      date: '2026-10-28',
      blocks: dayOf([mapped, template]),
      config: CONFIG,
      provider: templateProvider(),
    })

    expect(day.summaries[0]).toBe('old cli summary')
    expect(day.saved[0]).toEqual({ text: 'old cli summary', fromSkill: false })
    expect(day.saved[1]).toBeNull()
  })

  it('asks git only about the threads the template tells, from a folder inside each repo', async () => {
    await renderDay({
      date: '2026-10-28',
      blocks: dayOf([summaryRow({})]),
      config: CONFIG,
      provider: templateProvider(),
    })

    expect(lookupDayCommits).toHaveBeenCalledWith(
      [
        { cwd: '/Users/dev/cli', startedAt: '2026-10-28T12:09:00.000Z', endedAt: '2026-10-28T13:48:00.000Z' },
        { cwd: '/Users/dev/vscode', startedAt: VSCODE_THREAD.startedAt, endedAt: VSCODE_THREAD.endedAt },
      ],
      { budgetMs: 3000 }
    )
  })

  it('ignores saved summaries with fresh', async () => {
    const day = await renderDay({
      date: '2026-10-28',
      blocks: dayOf([summaryRow({})]),
      config: CONFIG,
      provider: templateProvider(),
      fresh: true,
    })

    expect(day.saved).toEqual([null, null, null])
    expect(day.summaries[2]).toBe('## landing-page\n- From the template')
  })

  it('lets a failing writer throw, so the command can say so', async () => {
    const provider = { summarize: vi.fn(async () => Promise.reject(new Error('disk full'))), validate: vi.fn() }

    await expect(renderDay({ date: '2026-10-28', blocks: dayOf(), config: CONFIG, provider })).rejects.toThrow(
      'disk full'
    )
  })
})
