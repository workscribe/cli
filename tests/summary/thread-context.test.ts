import { describe, it, expect } from 'vitest'
import { buildThreadContext, type ThreadContextInput } from '../../src/summary/thread-context'
import type { StoredThread } from '../../src/db/thread-store'
import type { SummaryRow } from '../../src/db/summary-store'
import type { EventRow } from '../../src/db/types'

const CLI = 1
const VSCODE = 2
const SITE = 3
const NAMES = new Map<number, string | null>([
  [CLI, 'workscribe/cli'],
  [VSCODE, 'workscribe/vscode'],
  [SITE, 'workscribe/landing-page'],
])

function thread(id: number, projectId: number | null, startedAt: string, eventCount: number): StoredThread {
  return { id, blockId: 1, projectId, startedAt, endedAt: '2026-10-28T13:48:00.000Z', eventCount, activeSlots: 4 }
}

function event(id: number, branch: string | null = null): EventRow {
  return {
    id,
    captured_at: '2026-10-28T12:31:00.000Z',
    command: 'README.md',
    cwd: '/s/workscribe',
    exit_code: null,
    duration_ms: null,
    repo_name: null,
    branch,
    category: 'code_edit',
    metadata: null,
    source: 'vscode',
    file_path: '/s/workscribe/workscribe-landing-page/README.md',
    project_id: SITE,
  }
}

function summary(overrides: Partial<SummaryRow>): SummaryRow {
  return {
    id: 1,
    scope: 'session',
    project_id: SITE,
    first_event_id: 1,
    last_event_id: 7,
    engine: 'skill',
    text: 'Refactored the cli capture path',
    created_at: '2026-10-28T20:00:00.000Z',
    source_key: 'workscribe/landing-page|2026-10-28T12:09:00.000Z',
    origin: 'mapped',
    anchor_source: 'cached',
    is_mixed: 1,
    ...overrides,
  }
}

// Session 183's shape: cli and vscode interleaved, three landing-page saves
const THREADS = [
  thread(10, CLI, '2026-10-28T12:09:00.000Z', 4),
  thread(11, VSCODE, '2026-10-28T12:15:00.000Z', 2),
  thread(12, SITE, '2026-10-28T12:31:00.000Z', 1),
]
const BLOCK_EVENTS = [
  { id: 1, threadId: 10 },
  { id: 2, threadId: 11 },
  { id: 3, threadId: 10 },
  { id: 4, threadId: 12 },
  { id: 5, threadId: 11 },
  { id: 6, threadId: 10 },
  { id: 7, threadId: 10 },
]

function input(overrides: Partial<ThreadContextInput> = {}): ThreadContextInput {
  return {
    block: {
      id: 1,
      date: '2026-10-28',
      startedAt: '2026-10-28T12:09:00.000Z',
      endedAt: '2026-10-28T13:48:00.000Z',
      activeSlots: 16,
    },
    threads: THREADS,
    blockEvents: BLOCK_EVENTS,
    thread: THREADS[2],
    threadEvents: [event(4, 'main')],
    projectNames: NAMES,
    summaries: [],
    ...overrides,
  }
}

describe('buildThreadContext', () => {
  it("answers a README save with landing-page's own thread, naming cli and vscode alongside", () => {
    const context = buildThreadContext(input())

    expect(context).toMatchObject({
      repoName: 'workscribe/landing-page',
      date: '2026-10-28',
      startedAt: '2026-10-28T12:31:00.000Z',
      eventCount: 1,
      branch: 'main',
      thread: { key: 'workscribe/landing-page|2026-10-28T12:31:00.000Z', projectId: SITE, activeMinutes: 20 },
      block: { startedAt: '2026-10-28T12:09:00.000Z', endedAt: '2026-10-28T13:48:00.000Z', activeMinutes: 80 },
    })
    expect(context.alongside.map((other) => [other.repoName, other.eventCount])).toEqual([
      ['workscribe/cli', 4],
      ['workscribe/vscode', 2],
    ])
  })

  it("never serves the mixed session's summary: it describes cli work under the landing-page name", () => {
    expect(buildThreadContext(input({ summaries: [summary({})] })).savedSummary).toBeNull()
  })

  it("serves the summary that belongs to the thread, the best one when there's more than one", () => {
    const own = [
      summary({ id: 2, project_id: CLI, first_event_id: 1, last_event_id: 3, engine: 'legacy', text: 'older' }),
      summary({ id: 3, project_id: CLI, first_event_id: 1, last_event_id: 3, engine: 'skill', text: 'by the skill' }),
    ]

    const context = buildThreadContext(input({ thread: THREADS[0], summaries: own }))

    expect(context.savedSummary).toBe('by the skill')
  })

  it('has no one alongside when the block is a single project', () => {
    const single = [thread(10, CLI, '2026-10-28T12:09:00.000Z', 2)]
    const context = buildThreadContext(
      input({ threads: single, thread: single[0], blockEvents: [{ id: 1, threadId: 10 }] })
    )

    expect(context.alongside).toEqual([])
  })

  it('names the "elsewhere" thread with no repo', () => {
    const withElsewhere = [...THREADS, thread(13, null, '2026-10-28T12:40:00.000Z', 2)]

    const context = buildThreadContext(input({ threads: withElsewhere }))

    expect(context.alongside.at(-1)).toMatchObject({ repoName: null, eventCount: 2 })
  })
})
