import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db', () => ({
  getRecentSessionsForRepo: vi.fn(),
  getLastSessionTouchingFile: vi.fn(),
  getSessionBranch: vi.fn(),
  getSessionSummaries: vi.fn(),
  getEventsBySessionId: vi.fn(),
}))

vi.mock('../../src/config', () => ({
  readConfig: vi.fn(),
}))

// The folder as reached through a symlink, and both forms of its repo root
vi.mock('../../src/utils/working-directory', () => ({
  currentDirectory: vi.fn(() => '/Users/dev/link/myapp'),
  rootForms: vi.fn(() => ['/Users/dev/myapp', '/Users/dev/link/myapp']),
}))

vi.mock('../../src/capture/git', () => ({
  getRepoContext: vi.fn(),
}))

import { Command } from 'commander'
import {
  getRecentSessionsForRepo,
  getLastSessionTouchingFile,
  getSessionBranch,
  getSessionSummaries,
  getEventsBySessionId,
} from '../../src/db'
import { readConfig } from '../../src/config'
import { createTestConfig } from '../helpers/config'
import { getRepoContext } from '../../src/capture/git'
import { log } from '../../src/utils/logger'
import { registerContext } from '../../src/cli/context'

const mockGetRecentSessionsForRepo = getRecentSessionsForRepo as ReturnType<typeof vi.fn>
const mockGetLastSessionTouchingFile = getLastSessionTouchingFile as ReturnType<typeof vi.fn>
const mockGetSessionBranch = getSessionBranch as ReturnType<typeof vi.fn>
const mockGetRepoContext = getRepoContext as ReturnType<typeof vi.fn>
const mockGetSessionSummaries = getSessionSummaries as ReturnType<typeof vi.fn>
const mockGetEventsBySessionId = getEventsBySessionId as ReturnType<typeof vi.fn>
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

const SAMPLE_SESSION = {
  id: 1,
  date: '2026-08-20',
  started_at: '2026-08-20T10:00:00.000Z',
  ended_at: '2026-08-20T12:14:00.000Z',
  repo_name: 'myapp',
  event_count: 42,
  summary: 'Implemented authentication middleware.',
}

function storedSummary(engine: string, text: string, createdAt = '2026-08-20T13:00:00.000Z') {
  return { session_key: 'myapp|2026-08-20T10:00:00.000Z', engine, text, created_at: createdAt }
}

const COMMIT_EVENT = {
  id: 7,
  captured_at: '2026-08-20T11:00:00.000Z',
  command: 'git commit -m "add auth middleware"',
  cwd: '/Users/dev/myapp',
  exit_code: 0,
  duration_ms: 40,
  repo_name: 'myapp',
  branch: 'feature/auth',
  category: 'shipping',
  metadata: '{"message":"add auth middleware"}',
  source: 'shell',
  file_path: null,
}

beforeEach(() => {
  mockReadConfig.mockReturnValue(createTestConfig())
  mockGetSessionSummaries.mockReturnValue([storedSummary('provider', 'Implemented authentication middleware.')])
  mockGetEventsBySessionId.mockReturnValue([COMMIT_EVENT])
})

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerContext(program)
  return program
}

describe('workscribe context --file', () => {
  describe('--json', () => {
    it('prints a structured object when a session is found', async () => {
      mockGetLastSessionTouchingFile.mockReturnValue(SAMPLE_SESSION)
      mockGetSessionBranch.mockReturnValue('feature/auth')

      await makeProgram().parseAsync(['context', '--file', 'src/auth.ts', '--json'], { from: 'user' })

      const printed = mockLog.plain.mock.calls[0][0] as string
      const parsed = JSON.parse(printed)
      expect(parsed).toMatchObject({
        date: '2026-08-20',
        startedAt: '2026-08-20T10:00:00.000Z',
        endedAt: '2026-08-20T12:14:00.000Z',
        branch: 'feature/auth',
        eventCount: 42,
        summary: 'Implemented authentication middleware.',
      })
      expect(parsed.timeAgo).toEqual(expect.any(String))
      expect(parsed.durationMinutes).toBe(134)
    })

    it('prints null when no session touches the file', async () => {
      mockGetLastSessionTouchingFile.mockReturnValue(undefined)

      await makeProgram().parseAsync(['context', '--file', 'src/never-touched.ts', '--json'], { from: 'user' })

      expect(mockLog.plain).toHaveBeenCalledWith('null')
    })

    it('falls back to a template summary when nothing has been stored yet', async () => {
      mockGetLastSessionTouchingFile.mockReturnValue({ ...SAMPLE_SESSION, summary: null })
      mockGetSessionBranch.mockReturnValue(null)
      mockGetSessionSummaries.mockReturnValue([])

      await makeProgram().parseAsync(['context', '--file', 'src/auth.ts', '--json'], { from: 'user' })

      const parsed = JSON.parse(mockLog.plain.mock.calls[0][0] as string)
      expect(parsed.summary).toBe('## myapp (feature/auth) — 2h 14m\n- Committed: add auth middleware')
      expect(parsed.branch).toBeNull()
    })

    it('prefers a skill summary over a provider one, and either over the template', async () => {
      mockGetLastSessionTouchingFile.mockReturnValue(SAMPLE_SESSION)
      mockGetSessionSummaries.mockReturnValue([
        storedSummary('template', 'template text'),
        storedSummary('skill', 'skill text'),
        storedSummary('provider', 'provider text'),
      ])

      await makeProgram().parseAsync(['context', '--file', 'src/auth.ts', '--json'], { from: 'user' })

      expect(JSON.parse(mockLog.plain.mock.calls[0][0] as string).summary).toBe('skill text')
    })
  })

  describe('without --json (default text output)', () => {
    it('prints a formatted message when no session touches the file', async () => {
      mockGetLastSessionTouchingFile.mockReturnValue(undefined)

      await makeProgram().parseAsync(['context', '--file', 'src/never-touched.ts'], { from: 'user' })

      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('No sessions found touching'))
    })

    it('prints the session heading and summary when a session is found', async () => {
      mockGetLastSessionTouchingFile.mockReturnValue(SAMPLE_SESSION)
      mockGetSessionBranch.mockReturnValue('feature/auth')

      await makeProgram().parseAsync(['context', '--file', 'src/auth.ts'], { from: 'user' })

      const calls = mockLog.plain.mock.calls.map((call: unknown[]) => call[0])
      expect(calls.some((call) => typeof call === 'string' && call.includes('Last session touching'))).toBe(true)
      expect(calls.some((call) => typeof call === 'string' && call.includes(SAMPLE_SESSION.summary))).toBe(true)
    })
  })
})

describe('workscribe context (repo mode)', () => {
  it('prints null with --json when not in a git repository', async () => {
    mockGetRepoContext.mockReturnValue({ repoName: null, branch: null, root: null, remote: null })

    await makeProgram().parseAsync(['context', '--json'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenCalledWith('null')
  })

  it('prints null with --json when no sessions exist for the repo', async () => {
    mockGetRepoContext.mockReturnValue({ repoName: 'myapp', branch: 'main', root: '/Users/dev/myapp', remote: null })
    mockGetRecentSessionsForRepo.mockReturnValue([])

    await makeProgram().parseAsync(['context', '--json'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenCalledWith('null')
  })

  it('prints a structured object with --json when a session exists', async () => {
    mockGetRepoContext.mockReturnValue({ repoName: 'myapp', branch: 'main', root: '/Users/dev/myapp', remote: null })
    mockGetRecentSessionsForRepo.mockReturnValue([SAMPLE_SESSION])
    mockGetSessionBranch.mockReturnValue('main')

    await makeProgram().parseAsync(['context', '--json'], { from: 'user' })

    const parsed = JSON.parse(mockLog.plain.mock.calls[0][0] as string)
    expect(parsed.eventCount).toBe(42)
  })
})

describe('workscribe context — old AI settings', () => {
  it('never prints the 2.0 notice, even for a 1.x config — the VS Code extension reads this output', async () => {
    mockReadConfig.mockReturnValue(createTestConfig({ ai: { provider: 'anthropic', apiKey: 'sk-old' } }))
    mockGetRepoContext.mockReturnValue({ repoName: 'myapp', branch: 'main', root: '/Users/dev/myapp', remote: null })
    mockGetRecentSessionsForRepo.mockReturnValue([SAMPLE_SESSION])
    mockGetSessionBranch.mockReturnValue('main')

    await makeProgram().parseAsync(['context', '--json'], { from: 'user' })

    expect(mockLog.notice).not.toHaveBeenCalled()
  })
})

// WOR-118: with git.qualifyRepoName on, shell activity was stored as bare `repo` while context looked up `owner/repo`
describe('workscribe context (repo mode) — both name forms', () => {
  const REMOTE = { owner: 'acme', repo: 'myapp' }

  it('looks up the qualified name and, inside this repo, the bare one', async () => {
    mockReadConfig.mockReturnValue(createTestConfig({ git: { qualifyRepoName: true } }))
    mockGetRepoContext.mockReturnValue({
      repoName: 'acme/myapp',
      branch: 'main',
      root: '/Users/dev/myapp',
      remote: REMOTE,
    })
    mockGetRecentSessionsForRepo.mockReturnValue([])

    await makeProgram().parseAsync(['context'], { from: 'user' })

    expect(mockGetRecentSessionsForRepo).toHaveBeenCalledWith(
      { repoName: 'acme/myapp', otherRepoName: 'myapp', roots: ['/Users/dev/myapp', '/Users/dev/link/myapp'] },
      1
    )
    expect(mockLog.plain).toHaveBeenCalledWith('  No sessions found for acme/myapp')
  })

  it('looks up the bare name and the qualified one when the setting is off', async () => {
    mockGetRepoContext.mockReturnValue({ repoName: 'myapp', branch: 'main', root: '/Users/dev/myapp', remote: REMOTE })
    mockGetRecentSessionsForRepo.mockReturnValue([])

    await makeProgram().parseAsync(['context'], { from: 'user' })

    expect(mockGetRecentSessionsForRepo).toHaveBeenCalledWith(
      { repoName: 'myapp', otherRepoName: 'acme/myapp', roots: ['/Users/dev/myapp', '/Users/dev/link/myapp'] },
      1
    )
  })

  it('looks up only the configured name for an override or a repo without a remote', async () => {
    mockGetRepoContext.mockReturnValue({ repoName: 'my-name', branch: 'main', root: '/Users/dev/myapp', remote: null })
    mockGetRecentSessionsForRepo.mockReturnValue([])

    await makeProgram().parseAsync(['context'], { from: 'user' })

    expect(mockGetRecentSessionsForRepo).toHaveBeenCalledWith(
      { repoName: 'my-name', otherRepoName: null, roots: ['/Users/dev/myapp', '/Users/dev/link/myapp'] },
      1
    )
  })

  it('returns, with --json, a session stored under the bare name before the fix', async () => {
    mockReadConfig.mockReturnValue(createTestConfig({ git: { qualifyRepoName: true } }))
    mockGetRepoContext.mockReturnValue({
      repoName: 'acme/myapp',
      branch: 'main',
      root: '/Users/dev/myapp',
      remote: REMOTE,
    })
    mockGetRecentSessionsForRepo.mockReturnValue([SAMPLE_SESSION]) // repo_name: 'myapp'
    mockGetSessionBranch.mockReturnValue('main')

    await makeProgram().parseAsync(['context', '--json'], { from: 'user' })

    expect(JSON.parse(mockLog.plain.mock.calls[0][0] as string)).toMatchObject({ eventCount: 42, branch: 'main' })
  })

  it("names the folder as reached (like the shell hook's $PWD), so a projects override matches as in capture", async () => {
    const config = createTestConfig({ projects: { '/Users/dev/link/myapp': 'my-name' } })
    mockReadConfig.mockReturnValue(config)
    mockGetRepoContext.mockReturnValue({ repoName: 'my-name', branch: 'main', root: '/Users/dev/myapp', remote: null })
    mockGetRecentSessionsForRepo.mockReturnValue([])

    await makeProgram().parseAsync(['context'], { from: 'user' })

    expect(mockGetRepoContext).toHaveBeenCalledWith('/Users/dev/link/myapp', config)
  })
})
