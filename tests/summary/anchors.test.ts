import { describe, it, expect } from 'vitest'
import { anchorOfSession, anchorOfThread, findSummaryThread, summariesOfThread } from '../../src/summary/anchors'
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
      findSummaryThread(
        { projectId: CLI, firstEventId: 1, lastEventId: 4, isThreadSaved: false },
        { threads, events: blockEvents }
      )
    ).toEqual(threads[0])
  })

  it("attaches to nothing when the project's thread holds half its range or less", () => {
    const anchor = { projectId: SITE, firstEventId: 1, lastEventId: 5, isThreadSaved: false }

    expect(findSummaryThread(anchor, { threads, events: blockEvents })).toBeNull()
  })

  it('counts only the events inside the range, so a thread running past it gains nothing', () => {
    // From event 3 to 5: the site thread holds 2 of 3, though the cli thread has more events in the block
    expect(
      findSummaryThread(
        { projectId: SITE, firstEventId: 3, lastEventId: 5, isThreadSaved: false },
        { threads, events: blockEvents }
      )
    ).toEqual(threads[1])
  })

  it('attaches to nothing for an unanchored summary, or a day with no threads built', () => {
    expect(
      findSummaryThread(
        { projectId: CLI, firstEventId: null, lastEventId: null, isThreadSaved: false },
        { threads, events: blockEvents }
      )
    ).toBeNull()
    expect(
      findSummaryThread(
        { projectId: CLI, firstEventId: 1, lastEventId: 2, isThreadSaved: true },
        { threads: [], events: [] }
      )
    ).toBeNull()
  })

  it('attaches a summary saved for a thread to that thread, though it holds half its range or less', () => {
    // From event 3 to 7 the site thread holds 2 of 5: no majority, but the summary was saved for that thread
    const events = [...blockEvents, { id: 6, threadId: 10 }, { id: 7, threadId: 10 }]
    const saved = { projectId: SITE, firstEventId: 3, lastEventId: 7, isThreadSaved: true }

    expect(findSummaryThread(saved, { threads, events })).toEqual(threads[1])
    expect(findSummaryThread({ ...saved, isThreadSaved: false }, { threads, events })).toBeNull()
  })

  it("attaches a thread's summary to nothing once its first event belongs to another thread", () => {
    const saved = { projectId: SITE, firstEventId: 1, lastEventId: 5, isThreadSaved: true }

    expect(findSummaryThread(saved, { threads, events: blockEvents })).toBeNull()
  })
})

describe('anchorOfThread', () => {
  it("anchors to the thread's project and its first and last events, never mixed", () => {
    const events = [event(4, 30, 'landing-page', SITE), event(9, 100, 'landing-page', SITE)]

    expect(anchorOfThread(events, SITE)).toEqual({ projectId: SITE, firstEventId: 4, lastEventId: 9, isMixed: false })
  })
})

describe('summariesOfThread', () => {
  const threads = [
    { id: 10, projectId: CLI },
    { id: 11, projectId: SITE },
  ]
  const events = [
    { id: 1, threadId: 10 },
    { id: 2, threadId: 11 },
    { id: 3, threadId: 10 },
    { id: 4, threadId: 10 },
    { id: 5, threadId: 11 },
  ]
  const stored = (id: number, overrides: object) => ({
    id,
    project_id: SITE,
    first_event_id: 2,
    last_event_id: 5,
    anchor_source: 'cached',
    ...overrides,
  })

  it('keeps the summaries that belong to the thread: its own saved ones, and mapped ones it holds most of', () => {
    const savedForSite = stored(1, { anchor_source: 'thread' })
    const mappedMixed = stored(2, {})
    const mappedCli = stored(3, { project_id: CLI, first_event_id: 3, last_event_id: 4 })

    const block = { threads, events }
    const summaries = [savedForSite, mappedMixed, mappedCli]
    expect(summariesOfThread(11, block, summaries)).toEqual([savedForSite])
    expect(summariesOfThread(10, block, summaries)).toEqual([mappedCli])
  })
})
