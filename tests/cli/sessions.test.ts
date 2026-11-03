import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest'

const DB = vi.hoisted(() => ({ name: 'the database' }))

vi.mock('../../src/db', () => ({ getDb: vi.fn(() => DB), saveThreadSummary: vi.fn() }))
vi.mock('../../src/db/day-threads', () => ({ isReadyForThreads: vi.fn(), readDayThreads: vi.fn() }))
vi.mock('../../src/sessions/threads', () => ({ ensureDayThreads: vi.fn() }))

vi.mock('../../src/config', () => ({
  readConfig: vi.fn(),
}))

vi.mock('../../src/summary/git-commits', () => ({
  getRepoRoot: vi.fn(),
  getUserEmail: vi.fn(),
  getCommitsInWindow: vi.fn(),
  getOthersSubjects: vi.fn(),
}))

import { Command } from 'commander'
import { isReadyForThreads, readDayThreads } from '../../src/db/day-threads'
import { ensureDayThreads } from '../../src/sessions/threads'
import { log } from '../../src/utils/logger'
import { registerSessions } from '../../src/cli/sessions'
import { readConfig } from '../../src/config'
import { getRepoRoot, getUserEmail, getCommitsInWindow, getOthersSubjects } from '../../src/summary/git-commits'
import { createTestConfig } from '../helpers/config'
import { block, row, thread } from '../summary/contract/fixtures'

const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

const CLI_START = '2026-10-28T12:09:00.000Z'
const CLI_KEY = `cli|${CLI_START}`
const VSCODE_KEY = 'vscode|2026-10-28T12:15:00.000Z'
const SITE_KEY = 'landing-page|2026-10-28T12:30:00.000Z'

const COMMIT_EVENT = row({
  id: 9,
  captured_at: '2026-10-28T12:40:00.000Z',
  command: 'git commit -m "fix: login redirect"',
  cwd: '/Users/dev/cli',
  repo_name: 'cli',
  branch: 'main',
  category: 'shipping',
  metadata: '{"message":"fix: login redirect"}',
})

const CLI = thread([COMMIT_EVENT], {
  id: 1,
  projectId: 1,
  key: CLI_KEY,
  repoName: 'cli',
  startedAt: CLI_START,
  endedAt: '2026-10-28T13:48:00.000Z',
  activeSlots: 16,
})
const VSCODE = thread([row({ id: 10, cwd: '/Users/dev/vscode', repo_name: 'vscode' })], {
  id: 2,
  projectId: 2,
  key: VSCODE_KEY,
  repoName: 'vscode',
  startedAt: '2026-10-28T12:15:00.000Z',
  activeSlots: 6,
})
const SITE = thread([row({ id: 11, cwd: '/Users/dev/landing-page', repo_name: 'landing-page' })], {
  id: 3,
  projectId: 3,
  key: SITE_KEY,
  repoName: 'landing-page',
  startedAt: '2026-10-28T12:30:00.000Z',
  activeSlots: 1,
})
const DAY = [
  block([CLI, VSCODE, SITE], { id: 5, startedAt: CLI_START, endedAt: '2026-10-28T13:48:00.000Z', activeSlots: 18 }),
]

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerSessions(program)
  return program
}

function stubExit() {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('exit')
  }) as never)
  onTestFinished(() => exitSpy.mockRestore())
  return exitSpy
}

function printedLines(): string {
  return mockLog.plain.mock.calls.map((call: unknown[]) => call[0] as string).join('\n')
}

beforeEach(() => {
  vi.mocked(readConfig).mockReturnValue(createTestConfig())
  vi.mocked(isReadyForThreads).mockReturnValue(true)
  vi.mocked(readDayThreads).mockReturnValue(DAY)
})

describe('workscribe sessions', () => {
  it('logs a no-sessions message for a day with no blocks', async () => {
    vi.mocked(readDayThreads).mockReturnValue([])
    await makeProgram().parseAsync(['sessions'], { from: 'user' })
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('No sessions detected'))
  })

  it('lists each block with every project thread inside it and its active time', async () => {
    await makeProgram().parseAsync(['sessions'], { from: 'user' })

    const printed = printedLines()
    expect(printed).toContain('3 threads in 1 block')
    expect(printed).toContain('1h 30m active')
    for (const name of ['cli', 'vscode', 'landing-page']) expect(printed).toContain(name)
    expect(printed).toContain('1h 20m active')
  })

  it('uses singular nouns for a single thread and event', async () => {
    vi.mocked(readDayThreads).mockReturnValue([block([SITE])])
    await makeProgram().parseAsync(['sessions'], { from: 'user' })
    const printed = printedLines()
    expect(printed).toContain('1 thread in 1 block')
    expect(printed).toContain('1 event')
    expect(printed).not.toContain('1 events')
  })

  it('names the "elsewhere" thread by its folder, or "no repo" without one', async () => {
    const elsewhere = thread([row({ cwd: '/Users/dev/scripts', repo_name: null })], { projectId: null, repoName: null })
    vi.mocked(readDayThreads).mockReturnValue([
      block([elsewhere]),
      block([thread([], { projectId: null, repoName: null })]),
    ])
    await makeProgram().parseAsync(['sessions'], { from: 'user' })
    const printed = printedLines()
    expect(printed).toContain('/scripts')
    expect(printed).toContain('no repo')
  })

  it("shows a thread's notes under it, skipping malformed ones", async () => {
    const notes = [
      row({ category: 'note', metadata: JSON.stringify({ text: 'Fixed race condition' }) }),
      row({ category: 'note', metadata: '{ bad json' }),
    ]
    vi.mocked(readDayThreads).mockReturnValue([block([thread(notes)])])
    await makeProgram().parseAsync(['sessions'], { from: 'user' })
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('Fixed race condition'))
  })

  it('builds and reads the day given with --date', async () => {
    await makeProgram().parseAsync(['sessions', '--date', '2026-01-15'], { from: 'user' })
    expect(ensureDayThreads).toHaveBeenCalledWith('2026-01-15')
    expect(readDayThreads).toHaveBeenCalledWith(DB, '2026-01-15')
  })

  it('logs an error and exits on an invalid date', async () => {
    stubExit()
    await expect(makeProgram().parseAsync(['sessions', '--date', 'bad-date'], { from: 'user' })).rejects.toThrow()
    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('Invalid date'))
  })

  it.each([[['sessions']], [['sessions', '--json']]])(
    'asks for workscribe upgrade, reading nothing, while old events are not linked to projects (%j)',
    async (args) => {
      vi.mocked(isReadyForThreads).mockReturnValue(false)
      const exitSpy = stubExit()

      await expect(makeProgram().parseAsync(args, { from: 'user' })).rejects.toThrow('exit')

      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('run workscribe upgrade'))
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(ensureDayThreads).not.toHaveBeenCalled()
      expect(readDayThreads).not.toHaveBeenCalled()
    }
  )
})

describe('workscribe sessions --json', () => {
  function printedJson() {
    const [[printed]] = mockLog.plain.mock.calls
    return JSON.parse(printed as string)
  }

  beforeEach(() => {
    vi.mocked(getRepoRoot).mockImplementation((cwd: string) => cwd)
    vi.mocked(getUserEmail).mockReturnValue('dev@example.com')
    vi.mocked(getCommitsInWindow).mockReturnValue([])
    vi.mocked(getOthersSubjects).mockReturnValue([])
  })

  it('prints version 2: a session per thread, each naming the others alongside, and the block', async () => {
    await makeProgram().parseAsync(['sessions', '--json', '--date', '2026-10-28'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenCalledTimes(1)
    const json = printedJson()
    expect(json).toMatchObject({ schemaVersion: 2, date: '2026-10-28' })
    expect(json.blocks).toEqual([
      {
        id: 5,
        startedAt: CLI_START,
        endedAt: '2026-10-28T13:48:00.000Z',
        eventCount: 3,
        activeMinutes: 90,
        threadKeys: [CLI_KEY, VSCODE_KEY, SITE_KEY],
      },
    ])
    expect(json.sessions.map((session: { key: string }) => session.key)).toEqual([CLI_KEY, VSCODE_KEY, SITE_KEY])
    expect(json.sessions[2]).toMatchObject({
      project: 'landing-page',
      repoPath: '/Users/dev/landing-page',
      blockId: 5,
      activeMinutes: 5,
      alongside: [CLI_KEY, VSCODE_KEY],
    })
    expect(JSON.stringify(json)).not.toContain('git commit -m')
  })

  it("merges git's commits for the thread's own window in its repo", async () => {
    vi.mocked(getCommitsInWindow).mockReturnValue([
      { hash: 'a1b2c3d', subject: 'fix: login redirect', committedAt: '2026-10-28T12:40:00+00:00' },
    ])
    vi.mocked(readDayThreads).mockReturnValue([block([CLI])])

    await makeProgram().parseAsync(['sessions', '--json'], { from: 'user' })

    expect(getCommitsInWindow).toHaveBeenCalledWith({
      repoRoot: '/Users/dev/cli',
      since: CLI_START,
      until: '2026-10-28T13:48:00.000Z',
      author: 'dev@example.com',
    })
    expect(printedJson().sessions[0].commits).toEqual([
      { hash: 'a1b2c3d', subject: 'fix: login redirect', committedAt: '2026-10-28T12:40:00+00:00', source: 'git' },
    ])
  })

  it('prints empty lists for a day with no blocks', async () => {
    vi.mocked(readDayThreads).mockReturnValue([])

    await makeProgram().parseAsync(['sessions', '--json', '--date', '2026-05-28'], { from: 'user' })

    expect(printedJson()).toEqual({ schemaVersion: 2, date: '2026-05-28', blocks: [], sessions: [] })
  })

  it('keeps captured commits when the thread is not in a git repo', async () => {
    vi.mocked(getRepoRoot).mockReturnValue(null)
    vi.mocked(readDayThreads).mockReturnValue([block([CLI])])

    await makeProgram().parseAsync(['sessions', '--json'], { from: 'user' })

    expect(printedJson().sessions[0]).toMatchObject({
      repoPath: null,
      commits: [{ hash: null, subject: 'fix: login redirect', source: 'captured' }],
    })
    expect(getCommitsInWindow).not.toHaveBeenCalled()
  })

  it('asks git for the repo root and email once per run, not once per thread', async () => {
    const later = { ...CLI, id: 4, key: 'cli|2026-10-28T15:00:00.000Z' }
    vi.mocked(readDayThreads).mockReturnValue([block([CLI], { id: 5 }), block([later], { id: 6 })])

    await makeProgram().parseAsync(['sessions', '--json'], { from: 'user' })

    expect(getRepoRoot).toHaveBeenCalledTimes(1)
    expect(getUserEmail).toHaveBeenCalledTimes(1)
    expect(getOthersSubjects).toHaveBeenCalledTimes(1)
    expect(getCommitsInWindow).toHaveBeenCalledTimes(2)
  })

  it('drops a captured commit that someone else made, such as one pulled in during an AI session', async () => {
    vi.mocked(getOthersSubjects).mockReturnValue(['fix: login redirect'])
    vi.mocked(readDayThreads).mockReturnValue([block([CLI])])

    await makeProgram().parseAsync(['sessions', '--json'], { from: 'user' })

    expect(getOthersSubjects).toHaveBeenCalledWith('/Users/dev/cli', 'dev@example.com')
    expect(printedJson().sessions[0].commits).toEqual([])
  })
})
