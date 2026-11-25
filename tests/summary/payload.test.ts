import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/utils/format', () => ({
  formatDate: vi.fn((isoString: string) => `time:${isoString}`),
}))

import {
  branchesOf,
  eventRowToPayload,
  sessionBranch,
  spanToPayload,
  sessionLocation,
  threadRepoCwd,
  type PayloadSpan,
} from '../../src/summary/payload'
import { eventToJson } from '../../src/summary/contract/build'
import type { EventRow } from '../../src/db/types'

function makeEvent(overrides: Partial<EventRow> = {}): EventRow {
  return {
    id: 1,
    captured_at: '2026-08-17T09:00:00.000Z',
    command: 'git commit -m "fix: bug"',
    cwd: '/repo',
    exit_code: 0,
    duration_ms: 50,
    repo_name: 'my-app',
    branch: 'main',
    category: 'shipping',
    metadata: '{"message":"fix: bug"}',
    source: 'shell',
    file_path: null,
    ...overrides,
  }
}

function makeSpan(overrides: Partial<PayloadSpan> = {}): PayloadSpan {
  return {
    startedAt: '2026-08-17T09:00:00.000Z',
    endedAt: '2026-08-17T10:00:00.000Z',
    repoName: 'my-app',
    durationMinutes: 60,
    events: [makeEvent()],
    ...overrides,
  }
}

describe('eventRowToPayload', () => {
  it.each([
    ['npx vitest run 2>&1 | tail -25', 'testing'],
    ['npx vitest run | grep -E "FAIL|Tests "', 'testing'],
    ['npx vitest run || true', 'testing'],
    ['npx tsc --noEmit; echo "exit=$?"', 'building'],
  ])("reports no exit code for `%s`, whose 0 is not the %s step's", (command, category) => {
    const payload = eventRowToPayload(makeEvent({ command, category, exit_code: 0, metadata: '{}' }))

    expect(payload.exitCode).toBeNull()
  })

  it.each([
    ['npx vitest run', 'testing'],
    ['cd app && npx vitest run', 'testing'],
    ['npx tsc --noEmit && npx vitest run', 'testing'],
  ])("keeps the 0 of `%s`, which is the %s step's", (command, category) => {
    const payload = eventRowToPayload(makeEvent({ command, category, exit_code: 0, metadata: '{}' }))

    expect(payload.exitCode).toBe(0)
  })

  it('keeps a failure however the run was piped', () => {
    const row = makeEvent({ command: 'npx vitest run | tail', category: 'testing', exit_code: 1, metadata: '{}' })

    expect(eventRowToPayload(row).exitCode).toBe(1)
  })

  it('names a branch the shell expanded by the branch the command ended on', () => {
    const row = makeEvent({
      command: 'git switch -c $B main',
      category: 'versioning',
      branch: 'feat/x',
      metadata: '{}',
    })

    expect(eventRowToPayload(row).gitMoves).toEqual([{ kind: 'create-branch', branch: 'feat/x' }])
  })

  it('names a branch built from a variable the same way', () => {
    const row = makeEvent({
      command: 'git checkout -b "fix/$ID-redact" main',
      category: 'versioning',
      branch: 'fix/WOR-166-redact',
      metadata: '{}',
    })

    expect(eventRowToPayload(row).gitMoves).toEqual([{ kind: 'create-branch', branch: 'fix/WOR-166-redact' }])
  })

  it('leaves out a branch the shell expanded when the command ended on no branch', () => {
    const row = makeEvent({ command: 'git switch -c $B main', category: 'versioning', branch: null, metadata: '{}' })

    expect(eventRowToPayload(row)).not.toHaveProperty('gitMoves')
  })

  it('never names a branch from a variable when the command failed', () => {
    const row = makeEvent({
      command: 'git switch -c $B main',
      category: 'versioning',
      branch: 'main',
      exit_code: 128,
      metadata: '{}',
    })

    expect(eventRowToPayload(row)).not.toHaveProperty('gitMoves')
  })

  it('names only the last branch move by the branch the command ended on', () => {
    const row = makeEvent({
      command: 'git switch -c $A main && git switch -c $B',
      category: 'versioning',
      branch: 'feat/b',
      metadata: '{}',
    })

    expect(eventRowToPayload(row).gitMoves).toEqual([{ kind: 'create-branch', branch: 'feat/b' }])
  })

  it('keeps a branch name that is not an expansion exactly as written', () => {
    const row = makeEvent({
      command: 'git switch -c feat/y main',
      category: 'versioning',
      branch: 'feat/y',
      metadata: '{}',
    })

    expect(eventRowToPayload(row).gitMoves).toEqual([{ kind: 'create-branch', branch: 'feat/y' }])
  })

  it('drops shell expansions that were stored as package names', () => {
    const row = makeEvent({
      category: 'dependencies',
      metadata: '{"tool":"npm","packages":["$(cat","pkgs.txt)","zod","$EXTRA"],"action":"remove"}',
    })

    expect(eventRowToPayload(row).metadata).toEqual({ tool: 'npm', packages: ['zod'], action: 'remove' })
  })

  it('leaves the packages of other categories alone', () => {
    const row = makeEvent({ category: 'other', metadata: '{"packages":["$(cat"]}' })

    expect(eventRowToPayload(row).metadata).toEqual({ packages: ['$(cat'] })
  })

  it('maps the row and parses its metadata', () => {
    expect(eventRowToPayload(makeEvent())).toEqual({
      category: 'shipping',
      metadata: { message: 'fix: bug' },
      exitCode: 0,
      durationMs: 50,
      branch: 'main',
      capturedAt: '2026-08-17T09:00:00.000Z',
      source: 'shell',
    })
  })

  it('carries the agent session, only when the event has one', () => {
    expect(eventRowToPayload(makeEvent({ agent_session_id: 7 })).agentSessionId).toBe(7)
    expect(eventRowToPayload(makeEvent({ agent_session_id: null }))).not.toHaveProperty('agentSessionId')
  })

  it('reads the branch moves in a git command, so the story can tell them', () => {
    const row = makeEvent({ category: 'versioning', command: 'git switch -c feat/x', metadata: '{"branch":"feat/x"}' })

    expect(eventRowToPayload(row).gitMoves).toEqual([{ kind: 'create-branch', branch: 'feat/x' }])
  })

  it('keeps the new branch from a compound command that failed later, since the session is on it', () => {
    const row = makeEvent({ command: 'git switch -c feat/x && npm test', exit_code: 1, branch: 'feat/x' })

    expect(eventRowToPayload(row).gitMoves).toEqual([{ kind: 'create-branch', branch: 'feat/x' }])
  })

  it('reads no moves from a git command that failed, or from one that is not git', () => {
    expect(eventRowToPayload(makeEvent({ command: 'git reset --hard', exit_code: 128 }))).not.toHaveProperty('gitMoves')
    expect(eventRowToPayload(makeEvent({ command: 'npm test' }))).not.toHaveProperty('gitMoves')
  })

  it('carries no source for an event that has none', () => {
    expect(eventRowToPayload(makeEvent({ source: null }))).not.toHaveProperty('source')
  })

  it('carries the source of a command a coding agent ran', () => {
    expect(eventRowToPayload(makeEvent({ source: 'claude-code' })).source).toBe('claude-code')
  })

  it('falls back to empty metadata when the JSON is invalid', () => {
    expect(eventRowToPayload(makeEvent({ metadata: '{not json' })).metadata).toEqual({})
  })

  it.each(['null', '5', '"text"', '[1, 2]'])(
    'falls back to empty metadata when the JSON is %s, not an object',
    (raw) => {
      expect(eventRowToPayload(makeEvent({ category: 'other', metadata: raw })).metadata).toEqual({})
    }
  )

  it('falls back to empty metadata when there is none', () => {
    expect(eventRowToPayload(makeEvent({ metadata: null })).metadata).toEqual({})
  })

  it("carries an edit's line counts and last edit time through unchanged", () => {
    const edit = makeEvent({
      category: 'code_edit',
      command: '/repo/src/a.ts',
      file_path: '/repo/src/a.ts',
      source: 'vscode',
      metadata: '{"linesAdded":6,"linesRemoved":2,"lastEditAt":"2026-08-17T09:00:20.000Z"}',
    })

    expect(eventRowToPayload(edit).metadata).toEqual({
      linesAdded: 6,
      linesRemoved: 2,
      lastEditAt: '2026-08-17T09:00:20.000Z',
    })
  })

  it('lifts the hint out of other events and strips hint and tool', () => {
    const row = makeEvent({ category: 'other', metadata: '{"hint":"make deploy","tool":"make","target":"prod"}' })

    expect(eventRowToPayload(row)).toEqual({
      category: 'other',
      hint: 'make deploy',
      metadata: { target: 'prod' },
      exitCode: 0,
      durationMs: 50,
      branch: 'main',
      capturedAt: '2026-08-17T09:00:00.000Z',
      source: 'shell',
    })
  })

  it('leaves a hint in metadata for categories other than other', () => {
    const row = makeEvent({ category: 'testing', metadata: '{"hint":"vitest","tool":"npx"}' })

    expect(eventRowToPayload(row)).toEqual({
      category: 'testing',
      metadata: { hint: 'vitest', tool: 'npx' },
      exitCode: 0,
      durationMs: 50,
      branch: 'main',
      capturedAt: '2026-08-17T09:00:00.000Z',
      source: 'shell',
    })
  })
})

describe('spanToPayload', () => {
  it('maps the session for the given date', () => {
    expect(spanToPayload(makeSpan(), '2026-08-17')).toEqual({
      date: '2026-08-17',
      project: 'my-app',
      branch: 'main',
      branches: ['main'],
      startTime: 'time:2026-08-17T09:00:00.000Z',
      endTime: 'time:2026-08-17T10:00:00.000Z',
      durationMinutes: 60,
      events: [
        {
          category: 'shipping',
          metadata: { message: 'fix: bug' },
          exitCode: 0,
          durationMs: 50,
          branch: 'main',
          capturedAt: '2026-08-17T09:00:00.000Z',
          source: 'shell',
        },
      ],
      commits: [{ hash: null, subject: 'fix: bug', committedAt: '2026-08-17T09:00:00.000Z', branch: 'main' }],
    })
  })

  it('has a null branch and no branches when the session has no events', () => {
    const payload = spanToPayload(makeSpan({ events: [] }), '2026-08-17')

    expect(payload.branch).toBeNull()
    expect(payload.branches).toEqual([])
  })
})

describe('sessionBranch', () => {
  it('is the latest branch the session was on, where the work was heading', () => {
    const events = ['main', 'feat/auth', 'main', 'feat/auth'].map((branch) => makeEvent({ branch }))

    expect(sessionBranch(events)).toBe('feat/auth')
  })

  it('skips later events outside a repo', () => {
    expect(sessionBranch([makeEvent({ branch: 'main' }), makeEvent({ branch: null })])).toBe('main')
  })

  it('is null when no event has a branch', () => {
    expect(sessionBranch([makeEvent({ branch: null })])).toBeNull()
    expect(sessionBranch([])).toBeNull()
  })
})

describe('spanToPayload — branch and commits', () => {
  it('takes the latest branch, and git commits passed in, each under its branch', () => {
    const events = [
      makeEvent({ id: 1, branch: 'main', captured_at: '2026-08-17T09:00:00.000Z' }),
      makeEvent({
        id: 2,
        branch: 'feat/auth',
        captured_at: '2026-08-17T09:30:00.000Z',
        category: 'testing',
        metadata: null,
      }),
    ]
    const gitCommits = [{ hash: 'a1b2c3d', subject: 'feat: add login', committedAt: '2026-08-17T10:40:00+01:00' }]

    const payload = spanToPayload(makeSpan({ events }), '2026-08-17', { gitCommits })

    expect(payload.branch).toBe('feat/auth')
    expect(payload.commits).toEqual([
      { hash: 'a1b2c3d', subject: 'feat: add login', committedAt: '2026-08-17T10:40:00+01:00', branch: 'feat/auth' },
      { hash: null, subject: 'fix: bug', committedAt: '2026-08-17T09:00:00.000Z', branch: 'main' },
    ])
  })
})

describe('branchesOf', () => {
  it('lists each branch once, in the order first seen', () => {
    const events = ['main', 'feat/auth', 'main', 'fix/typo', 'feat/auth'].map((branch) => makeEvent({ branch }))

    expect(branchesOf(events)).toEqual(['main', 'feat/auth', 'fix/typo'])
  })

  it('skips events outside a repo, which have no branch', () => {
    const events = [makeEvent({ branch: null }), makeEvent({ branch: 'main' }), makeEvent({ branch: null })]

    expect(branchesOf(events)).toEqual(['main'])
  })

  it('is empty when no event has a branch', () => {
    expect(branchesOf([makeEvent({ branch: null })])).toEqual([])
  })
})

describe('sessionLocation', () => {
  const HOME = '/Users/dev'
  const NO_OVERRIDES = { projects: {}, homeDir: HOME }

  it('uses the repo name for sessions in a git repo', () => {
    expect(sessionLocation(makeSpan(), NO_OVERRIDES)).toBe('my-app')
  })

  it('falls back to the home-relative directory outside a git repo', () => {
    const session = makeSpan({
      repoName: null,
      events: [makeEvent({ repo_name: null, cwd: '/Users/dev/Downloads/scripts' })],
    })

    expect(sessionLocation(session, NO_OVERRIDES)).toBe('~/Downloads/scripts')
  })

  it('shows the home directory itself as ~', () => {
    const session = makeSpan({ repoName: null, events: [makeEvent({ repo_name: null, cwd: HOME })] })

    expect(sessionLocation(session, NO_OVERRIDES)).toBe('~')
  })

  it('keeps directories outside home absolute', () => {
    const session = makeSpan({ repoName: null, events: [makeEvent({ repo_name: null, cwd: '/tmp/build' })] })

    expect(sessionLocation(session, NO_OVERRIDES)).toBe('/tmp/build')
  })

  it('names the directory most of the commands ran in', () => {
    const session = makeSpan({
      repoName: null,
      events: [
        makeEvent({ repo_name: null, cwd: '/Users/dev/notes' }),
        makeEvent({ repo_name: null, cwd: '/Users/dev/scripts' }),
        makeEvent({ repo_name: null, cwd: '/Users/dev/scripts' }),
      ],
    })

    expect(sessionLocation(session, NO_OVERRIDES)).toBe('~/scripts')
  })

  it('prefers a config.projects display name for that directory', () => {
    const session = makeSpan({ repoName: null, events: [makeEvent({ repo_name: null, cwd: '/Users/dev/scripts' })] })

    expect(sessionLocation(session, { projects: { '/Users/dev/scripts': 'Shell scripts' }, homeDir: HOME })).toBe(
      'Shell scripts'
    )
  })

  it('is null for a session with no repo and no events', () => {
    expect(sessionLocation(makeSpan({ repoName: null, events: [] }), NO_OVERRIDES)).toBeNull()
  })

  it('becomes the payload project', () => {
    const session = makeSpan({ repoName: null, events: [makeEvent({ repo_name: null, cwd: '/Users/dev/scripts' })] })

    expect(spanToPayload(session, '2026-08-17', { context: NO_OVERRIDES }).project).toBe('~/scripts')
  })
})

describe('threadRepoCwd', () => {
  it("finds the repo directory though the project's name differs from what its events were stored under", () => {
    // The project is named workscribe/movies now; its events were captured as plain movies
    const events = [
      makeEvent({ repo_name: null, cwd: '/Users/dev' }),
      makeEvent({ repo_name: null, cwd: '/Users/dev' }),
      makeEvent({ repo_name: 'movies', cwd: '/Users/dev/movies' }),
    ]

    expect(threadRepoCwd(events)).toBe('/Users/dev/movies')
  })

  it('falls back to the most-used directory when no event was captured inside a repo', () => {
    const events = [makeEvent({ repo_name: null, cwd: '/tmp/scripts' }), makeEvent({ repo_name: null, cwd: '/tmp' })]

    expect(threadRepoCwd(events)).toBe('/tmp/scripts')
  })

  it('is null for no events', () => {
    expect(threadRepoCwd([])).toBeNull()
  })
})

describe('spanToPayload: what was read', () => {
  const exploring = makeEvent({
    id: 2,
    category: 'exploring',
    command: 'cat src/a.ts',
    cwd: '/repo',
    metadata: '{"tool":"cat"}',
  })
  const resolver = { repoRootOf: () => '/repo', ignoredAmong: () => new Set<string>() }

  it('gives no event a read list unless the caller can tell which paths git ignores', () => {
    const payload = spanToPayload(makeSpan({ events: [makeEvent(), exploring] }), '2026-08-17')

    expect(payload.events.some((event) => 'reads' in event)).toBe(false)
  })

  it('gives the exploring events what they read, and no other event', () => {
    const span = makeSpan({ events: [makeEvent(), exploring] })

    const payload = spanToPayload(span, '2026-08-17', { readPaths: resolver })

    expect(payload.events.map((event) => event.reads)).toEqual([undefined, ['src/a.ts']])
  })

  it('gives an event no reads in a repository git cannot check', () => {
    const unverifiable = { repoRootOf: () => '/repo', ignoredAmong: () => null }

    const payload = spanToPayload(makeSpan({ events: [exploring] }), '2026-08-17', { readPaths: unverifiable })

    expect(payload.events[0]).not.toHaveProperty('reads')
  })

  it('never puts reads on a payload built from a row alone, which is what the contracts use', () => {
    expect(eventRowToPayload(exploring)).not.toHaveProperty('reads')
  })
})

describe('eventRowToPayload: scripts from standard input', () => {
  const script = (command: string) => eventRowToPayload(makeEvent({ category: 'running', command }))

  it('counts the scripts a command ran, whatever step set its category', () => {
    expect(script("python3 - <<'EOF'\nEOF").scripts).toBe(1)
    expect(
      eventRowToPayload(makeEvent({ category: 'linting', command: "python3 - <<'EOF'\nEOF\nnpx prettier --write src" }))
        .scripts
    ).toBe(1)
    expect(script("python3 - <<'A'\nA\npython3 - <<'B'\nB").scripts).toBe(2)
    expect(script('cat a.py | python3 -').scripts).toBe(1)
    expect(script("python3 <<'EOF'\nEOF").scripts).toBe(1)
    expect(script('python3 -I -').scripts).toBe(1)
  })

  it('has none for a command that runs no script from standard input', () => {
    expect(script('python3 -c "print(1)"')).not.toHaveProperty('scripts')
    expect(script('python3 x.py')).not.toHaveProperty('scripts')
    expect(script('npm test')).not.toHaveProperty('scripts')
  })

  it('never reaches a contract: the count is not one of the fields they copy', () => {
    const payload = script("python3 - <<'EOF'\nEOF")

    expect(payload.scripts).toBe(1)
    expect(Object.keys(eventToJson(makeEvent({ command: "python3 - <<'EOF'\nEOF" })))).not.toContain('scripts')
  })
})
