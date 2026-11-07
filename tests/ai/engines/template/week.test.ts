import { describe, it, expect } from 'vitest'
import { MAX_BRANCH_BULLETS, renderWeekByProject, weekByProject } from '../../../../src/ai/engines/template/week'
import { commit, event, onBranch, session } from './fixtures'
import type { EventPayload, SessionPayload } from '../../../../src/ai/types'

function at(base: EventPayload, capturedAt: string, branch: string | null): EventPayload {
  return { ...onBranch(branch, base), capturedAt }
}

function week(days: { date: string; sessions: SessionPayload[] }[]) {
  return { by: 'project' as const, weekStart: '2026-11-02', weekEnd: '2026-11-04', days }
}

describe('weekByProject', () => {
  it('gathers each project across the week, then each branch, with the days it was worked on', () => {
    const monday = session([at(event('testing'), '2026-11-02T10:00:00.000Z', 'main')], {
      project: 'cli',
      projectId: 1,
      branches: ['main'],
      commits: [commit('fix: token', 'main')],
    })
    const tuesday = session([at(event('testing'), '2026-11-03T10:00:00.000Z', 'main')], {
      project: 'cli',
      projectId: 1,
      branches: ['main'],
    })
    const site = session([at(event('building'), '2026-11-03T11:00:00.000Z', 'main')], {
      project: 'site',
      projectId: 2,
      branches: ['main'],
    })

    const projects = weekByProject(
      week([
        { date: '2026-11-02', sessions: [monday] },
        { date: '2026-11-03', sessions: [tuesday, site] },
      ])
    )

    expect(projects.map((project) => project.project)).toEqual(['cli', 'site'])
    expect(projects[0].branches).toEqual([
      {
        branch: 'main',
        dates: ['2026-11-02', '2026-11-03'],
        bullets: ['Committed: fix: token', 'Tests passing'],
        moreCount: 0,
        activity: null,
      },
    ])
  })

  it('tells a thread that spans branches under each of them', () => {
    const thread = session(
      [
        at(event('testing'), '2026-11-02T10:00:00.000Z', 'feat/a'),
        at(event('building'), '2026-11-02T11:00:00.000Z', 'feat/b'),
      ],
      { project: 'cli', projectId: 1, branches: ['feat/a', 'feat/b'] }
    )

    const [project] = weekByProject(week([{ date: '2026-11-02', sessions: [thread] }]))

    expect(project.branches.map((branch) => [branch.branch, branch.bullets])).toEqual([
      ['feat/a', ['Tests passing']],
      ['feat/b', ['Build passing']],
    ])
  })

  it("keeps a thread's leading no-branch events with that thread, not with another thread's last branch", () => {
    const first = session([at(event('testing'), '2026-11-02T10:00:00.000Z', 'feat/a')], {
      project: 'cli',
      projectId: 1,
      branches: ['feat/a'],
    })
    // Starts outside a repo, then works on main: its no-branch build belongs to main, as the day tells it
    const second = session(
      [
        at(event('building'), '2026-11-03T09:00:00.000Z', null),
        at(event('testing', {}, 1), '2026-11-03T10:00:00.000Z', 'main'),
      ],
      { project: 'cli', projectId: 1, branches: ['main'] }
    )

    const [project] = weekByProject(
      week([
        { date: '2026-11-02', sessions: [first] },
        { date: '2026-11-03', sessions: [second] },
      ])
    )

    expect(project.branches.map((branch) => [branch.branch, branch.bullets])).toEqual([
      ['feat/a', ['Tests passing']],
      ['main', ['Tests failing', 'Build passing']],
    ])
  })

  it("counts each branch's own agent sessions in its activity line", () => {
    const agent = { ...event('testing'), source: 'claude-code', agentSessionId: 1 }
    const thread = session(
      [
        at(agent, '2026-11-02T10:00:00.000Z', 'feat/a'),
        at({ ...agent, agentSessionId: 2 }, '2026-11-02T10:05:00.000Z', 'feat/a'),
        at(agent, '2026-11-02T11:00:00.000Z', 'feat/b'),
      ],
      { project: 'cli', projectId: 1, branches: ['feat/a', 'feat/b'] }
    )

    const [project] = weekByProject(week([{ date: '2026-11-02', sessions: [thread] }]))

    expect(project.branches.map((branch) => branch.activity)).toEqual([
      'With Claude Code (2 sessions)',
      'With Claude Code (1 session)',
    ])
  })

  it('counts one agent session across two days once', () => {
    const agent = { ...event('testing'), source: 'claude-code', agentSessionId: 1 }
    const onDay = (date: string, capturedAt: string) => ({
      date,
      sessions: [session([at(agent, capturedAt, 'main')], { project: 'cli', projectId: 1, branches: ['main'] })],
    })

    const [project] = weekByProject(
      week([onDay('2026-11-02', '2026-11-02T23:50:00.000Z'), onDay('2026-11-03', '2026-11-03T00:10:00.000Z')])
    )

    expect(project.branches[0].activity).toBe('With Claude Code (1 session)')
  })

  it(`keeps ${MAX_BRANCH_BULLETS} bullets per branch and counts the rest`, () => {
    const commits = Array.from({ length: 9 }, (_unused, index) => commit(`fix: ${index}`, 'main'))
    const thread = session([at(event('testing'), '2026-11-02T10:00:00.000Z', 'main')], {
      project: 'cli',
      projectId: 1,
      branches: ['main'],
      commits,
    })

    const [{ branches }] = weekByProject(week([{ date: '2026-11-02', sessions: [thread] }]))

    expect(branches[0].bullets).toHaveLength(MAX_BRANCH_BULLETS)
    expect(branches[0].moreCount).toBe(4)
  })

  it('keeps two captured commits with the same subject on different days, and tells one commit once', () => {
    const wip = (committedAt: string) => ({ ...commit('wip', 'main'), committedAt })
    const dayOf = (capturedAt: string, commits: ReturnType<typeof wip>[]) =>
      session([at(event('testing'), capturedAt, 'main')], { project: 'cli', projectId: 1, branches: ['main'], commits })

    const [{ branches }] = weekByProject(
      week([
        { date: '2026-11-02', sessions: [dayOf('2026-11-02T10:00:00.000Z', [wip('2026-11-02T10:00:00.000Z')])] },
        {
          date: '2026-11-03',
          sessions: [
            dayOf('2026-11-03T10:00:00.000Z', [wip('2026-11-03T10:00:00.000Z')]),
            dayOf('2026-11-03T11:00:00.000Z', [wip('2026-11-03T10:00:00.000Z')]),
          ],
        },
      ])
    )

    expect(branches[0].bullets.filter((bullet) => bullet.startsWith('Committed'))).toHaveLength(2)
  })

  it('keeps two projects with the same name apart, and names work outside any project by its folder', () => {
    const api = (projectId: number | null, project: string) =>
      session([at(event('testing'), '2026-11-02T10:00:00.000Z', null)], { project, projectId, branches: [] })

    const projects = weekByProject(
      week([
        {
          date: '2026-11-02',
          sessions: [api(1, 'api'), api(2, 'api'), api(null, '~/scripts'), api(null, '~/scripts')],
        },
      ])
    )

    expect(projects.map((project) => project.project)).toEqual(['api', 'api', '~/scripts'])
    expect(projects[2].branches[0].branch).toBeNull()
  })

  it('says a branch was worked on when nothing it did is told', () => {
    const thread = session([at(event('exploring'), '2026-11-02T10:00:00.000Z', 'main')], {
      project: 'cli',
      projectId: 1,
      branches: ['main'],
    })

    const [{ branches }] = weekByProject(week([{ date: '2026-11-02', sessions: [thread] }]))

    expect(branches[0].bullets).toEqual(['Explored and ran commands'])
  })
})

describe('renderWeekByProject', () => {
  it('writes a ## section per project and a ### block per branch, with its dates, the fold and its activity', () => {
    const text = renderWeekByProject([
      {
        project: 'cli',
        branches: [
          {
            branch: 'main',
            dates: ['2026-11-02', '2026-11-03'],
            bullets: ['Committed: fix: token'],
            moreCount: 2,
            activity: 'With Claude Code (2 sessions)',
          },
          { branch: null, dates: ['2026-11-04'], bullets: ['Tests passing'], moreCount: 0, activity: null },
          {
            branch: 'docs',
            dates: ['2026-11-04'],
            bullets: [],
            moreCount: 0,
            activity: 'With Claude Code (1 session)',
          },
        ],
      },
    ])

    expect(text).toBe(
      [
        '## cli',
        '### main — Mon 2 Nov, Tue 3 Nov\n- Committed: fix: token\n- …plus 2 more\nWith Claude Code (2 sessions)',
        '### (no branch) — Wed 4 Nov\n- Tests passing',
        '### docs — Wed 4 Nov\nWith Claude Code (1 session)',
      ].join('\n\n')
    )
  })
})
