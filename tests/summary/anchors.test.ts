import { describe, it, expect } from 'vitest'
import { anchorOfSession, findSummaryThread } from '../../src/summary/anchors'
import type { EventRow } from '../../src/db/types'

const CLI = 1
const VSCODE = 2
const SITE = 3

function event(id: number, minute: number, repoName: string | null, projectId: number | null): EventRow {
  return {
    id,
    captured_at: new Date(Date.parse('2026-10-28T12:00:00.000Z') + minute * 60_000).toISOString(),
    command: 'ls',
    cwd: '/repo',
    exit_code: 0,
    duration_ms: 10,
    repo_name: repoName,
    branch: null,
    category: 'files',
    metadata: null,
    source: null,
    file_path: null,
    project_id: projectId,
  }
}

describe('anchorOfSession', () => {
  it("anchors a single-project session to its project, its first and last events, all of it the project's", () => {
    const anchor = anchorOfSession([event(1, 0, 'cli', CLI), event(2, 5, 'cli', CLI)], 'cli')

    expect(anchor).toEqual({
      projectId: CLI,
      firstEventId: 1,
      lastEventId: 2,
      share: 1,
      isMixed: false,
      isUnlinked: false,
    })
  })

  it('reports a session that held few of its named project’s events as mixed — the shape of session 183', () => {
    const events = [
      ...Array.from({ length: 89 }, (_, index) => event(index + 1, index, 'workscribe/cli', CLI)),
      ...Array.from({ length: 35 }, (_, index) => event(index + 100, index, 'workscribe/vscode', VSCODE)),
      ...Array.from({ length: 3 }, (_, index) => event(index + 200, 98, 'workscribe/landing-page', SITE)),
      event(300, 50, null, null),
      event(301, 51, null, null),
    ]

    const anchor = anchorOfSession(events, 'workscribe/landing-page')

    expect(anchor).toMatchObject({ projectId: SITE, isMixed: true })
    expect(anchor.share).toBeCloseTo(3 / 129)
  })

  it('anchors a session stored under both name forms to its one project', () => {
    const anchor = anchorOfSession([event(1, 0, 'cli', CLI), event(2, 5, 'workscribe/cli', CLI)], 'cli')

    expect(anchor).toMatchObject({ projectId: CLI, share: 1 })
  })

  it('gives an "elsewhere" key no project, its share being the events with none', () => {
    const anchor = anchorOfSession([event(1, 0, null, null), event(2, 5, null, null)], null)

    expect(anchor).toMatchObject({ projectId: null, share: 1, isMixed: false, isUnlinked: false })
  })

  it('takes the range in session order, not by id, when ids are out of order with time', () => {
    const anchor = anchorOfSession([event(9, 0, 'cli', CLI), event(4, 5, 'cli', CLI), event(7, 10, 'cli', CLI)], 'cli')

    expect(anchor).toMatchObject({ firstEventId: 9, lastEventId: 7 })
  })

  it('breaks a tie between projects by the lowest id', () => {
    const anchor = anchorOfSession([event(1, 0, 'api', 5), event(2, 1, 'api', 3)], 'api')

    expect(anchor.projectId).toBe(3)
  })

  it('counts exactly half as mixed', () => {
    const anchor = anchorOfSession([event(1, 0, 'cli', CLI), event(2, 1, 'web', VSCODE)], 'cli')

    expect(anchor).toMatchObject({ share: 0.5, isMixed: true })
  })

  it("marks a named session whose events aren't linked to any project yet", () => {
    const anchor = anchorOfSession([event(1, 0, 'cli', null), event(2, 5, 'cli', null)], 'cli')

    expect(anchor).toEqual({
      projectId: null,
      firstEventId: 1,
      lastEventId: 2,
      share: 0,
      isMixed: false,
      isUnlinked: true,
    })
  })

  it('leaves a session with no events unanchored', () => {
    expect(anchorOfSession([], 'cli')).toMatchObject({ firstEventId: null, lastEventId: null, projectId: null })
  })
})

describe('findSummaryThread', () => {
  const threads = [
    { id: 10, projectId: CLI },
    { id: 11, projectId: SITE },
  ]
  const blockEvents = [
    { id: 1, threadId: 10 },
    { id: 2, threadId: 10 },
    { id: 3, threadId: 11 },
    { id: 4, threadId: 10 },
    { id: 5, threadId: 11 },
  ]

  it("attaches a summary to its project's thread when that thread holds most of its range", () => {
    expect(
      findSummaryThread({ projectId: CLI, firstEventId: 1, lastEventId: 4 }, { threads, events: blockEvents })
    ).toEqual(threads[0])
  })

  it("attaches to nothing when the project's thread holds half its range or less", () => {
    const anchor = { projectId: SITE, firstEventId: 1, lastEventId: 5 }

    expect(findSummaryThread(anchor, { threads, events: blockEvents })).toBeNull()
  })

  it('counts only the events inside the range, so a thread running past it gains nothing', () => {
    // From event 3 to 5: the site thread holds 2 of 3, though the cli thread has more events in the block
    expect(
      findSummaryThread({ projectId: SITE, firstEventId: 3, lastEventId: 5 }, { threads, events: blockEvents })
    ).toEqual(threads[1])
  })

  it('attaches to nothing for an unanchored summary, or a day with no threads built', () => {
    expect(
      findSummaryThread({ projectId: CLI, firstEventId: null, lastEventId: null }, { threads, events: blockEvents })
    ).toBeNull()
    expect(
      findSummaryThread({ projectId: CLI, firstEventId: 1, lastEventId: 2 }, { threads: [], events: [] })
    ).toBeNull()
  })
})
