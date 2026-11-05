import { describe, it, expect } from 'vitest'
import { TemplateProvider } from '../../../../src/ai/engines/template/provider'
import { mergeByLocation } from '../../../../src/ai/engines/template/week'
import { commit, event, session } from './fixtures'

describe('TemplateProvider.summarize', () => {
  it("tells a single session's story under its heading", async () => {
    const payload = { date: '2026-10-20', sessions: [session([event('testing')], { commits: [commit('fix: token')] })] }

    expect(await new TemplateProvider().summarize(payload)).toBe(
      '## api-service (feature/auth) — 2h\n- Committed: fix: token\n- Tests passing'
    )
  })

  it('gives each session its own heading when summarizing a whole day', async () => {
    const payload = {
      date: '2026-10-20',
      sessions: [
        session([event('testing')], { commits: [commit('fix: token')] }),
        session([event('testing', {}, 0)], { project: 'web', branch: null, branches: [], durationMinutes: 30 }),
      ],
    }

    expect(await new TemplateProvider().summarize(payload)).toBe(
      '## api-service (feature/auth) — 2h\n- Committed: fix: token\n- Tests passing\n\n## web — 30m\n- Tests passing'
    )
  })

  it('passes includeCategories through', async () => {
    const payload = { date: '2026-10-20', sessions: [session([event('linting', {}, 0)])] }

    expect(await new TemplateProvider(['linting']).summarize(payload)).toBe(
      '## api-service (feature/auth) — 2h\n- Explored and ran commands'
    )
  })

  it('validates without doing anything', async () => {
    await expect(new TemplateProvider().validate()).resolves.toBeUndefined()
  })
})

describe('TemplateProvider.summarizeWeek', () => {
  it('lays the week out by project then branch by default', async () => {
    const payload = {
      by: 'project' as const,
      weekStart: '2026-10-19',
      weekEnd: '2026-10-20',
      days: [{ date: '2026-10-20', sessions: [session([event('testing')], { commits: [commit('fix: token')] })] }],
    }

    expect(await new TemplateProvider().summarizeWeek(payload)).toBe(
      '## api-service\n\n### feature/auth — Tue 20 Oct\n- Committed: fix: token\n- Tests passing'
    )
  })

  it('writes one section per day, prefixing bullets with where the work happened', async () => {
    const payload = {
      by: 'day' as const,
      weekStart: '2026-10-19',
      weekEnd: '2026-10-20',
      days: [
        { date: '2026-10-19', sessions: [session([event('shipping', { message: 'fix: token' })])] },
        { date: '2026-10-20', sessions: [session([event('testing', {}, 0)], { project: 'web' })] },
      ],
    }

    expect(await new TemplateProvider().summarizeWeek(payload)).toBe(
      '### 2026-10-19\n- api-service: Committed: fix: token\n\n### 2026-10-20\n- web: Tests passing (1 run)'
    )
  })

  it("merges a day's sessions in the same location and does not repeat the location", async () => {
    const payload = {
      by: 'day' as const,
      weekStart: '2026-10-20',
      weekEnd: '2026-10-20',
      days: [
        {
          date: '2026-10-20',
          sessions: [
            session([event('other'), event('other')], { project: 'streambox' }),
            session([event('versioning', { subcommand: 'status' })], { project: 'streambox' }),
          ],
        },
      ],
    }

    expect(await new TemplateProvider().summarizeWeek(payload)).toBe('### 2026-10-20\n- streambox: 3 commands')
  })

  it('caps a day at 5 bullets, taking turns across sessions', async () => {
    const busy = ['one', 'two', 'three'].map((message) => event('shipping', { message }))
    const payload = {
      by: 'day' as const,
      weekStart: '2026-10-20',
      weekEnd: '2026-10-20',
      days: [
        {
          date: '2026-10-20',
          sessions: [
            session([...busy, event('testing', {}, 0)], { project: 'api' }),
            session([event('note', { text: 'paired on review' }), event('testing', {}, 0)], { project: 'web' }),
          ],
        },
      ],
    }

    expect(await new TemplateProvider().summarizeWeek(payload)).toBe(
      [
        '### 2026-10-20',
        '- api: Committed: one',
        '- web: Note: paired on review',
        '- api: Committed: two',
        '- web: Tests passing (1 run)',
        '- api: Committed: three',
      ].join('\n')
    )
  })
})

describe('mergeByLocation', () => {
  it('joins sessions in the same location, keeping every branch they touched once, in order', () => {
    const morning = session([event('testing')], { branch: 'main', branches: ['main', 'feat/auth'] })
    const afternoon = session([event('building')], { branch: 'feat/auth', branches: ['feat/auth', 'fix/typo'] })

    const [merged] = mergeByLocation([morning, afternoon])

    expect(merged.branches).toEqual(['main', 'feat/auth', 'fix/typo'])
    expect(merged.events.map((mergedEvent) => mergedEvent.category)).toEqual(['testing', 'building'])
  })
})
