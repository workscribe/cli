import { describe, it, expect, vi, beforeEach } from 'vitest'

// The db module would load node:sqlite; the thread path's I/O is tested in context-threads-database.test.ts
vi.mock('../../src/db', () => ({}))

// The template summary must tell captured commits only: the VS Code extension gives context 5 s
vi.mock('child_process', () => ({ execFileSync: vi.fn() }))

vi.mock('../../src/config', () => ({
  readConfig: vi.fn(),
}))

// The --file details' I/O (git, the file's saves) is tested in context-file.test.ts
vi.mock('../../src/cli/context-file', () => ({
  getFileDetails: vi.fn(() => null),
}))

// The folder as reached through a symlink
vi.mock('../../src/utils/working-directory', () => ({
  currentDirectory: vi.fn(() => '/Users/dev/link/myapp'),
}))

vi.mock('../../src/capture/git', () => ({
  getRepoContext: vi.fn(),
}))

// Nothing found unless a test says so
vi.mock('../../src/cli/context-threads', () => ({
  lookUpFileThread: vi.fn(() => null),
  lookUpProjectThread: vi.fn(() => null),
}))

import { execFileSync } from 'child_process'
import { Command } from 'commander'
import { readConfig } from '../../src/config'
import { createTestConfig } from '../helpers/config'
import { getRepoContext } from '../../src/capture/git'
import { log } from '../../src/utils/logger'
import { registerContext } from '../../src/cli/context'
import { getFileDetails } from '../../src/cli/context-file'
import { lookUpFileThread, lookUpProjectThread } from '../../src/cli/context-threads'
import { row } from '../summary/contract/fixtures'

const mockGetRepoContext = getRepoContext as ReturnType<typeof vi.fn>
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

const COMMIT_EVENT = row({
  id: 7,
  captured_at: '2026-10-28T12:40:00.000Z',
  command: 'git commit -m "add auth middleware"',
  cwd: '/Users/dev/myapp',
  exit_code: 0,
  duration_ms: 40,
  repo_name: 'workscribe/landing-page',
  branch: 'feature/auth',
  category: 'shipping',
  metadata: '{"message":"add auth middleware"}',
})

// A file's context is its own project's thread, with the projects worked alongside it (WOR-149)
const THREAD_ANSWER = {
  threadId: 12,
  context: {
    repoName: 'workscribe/landing-page',
    date: '2026-10-28',
    startedAt: '2026-10-28T12:31:00.000Z',
    endedAt: '2026-10-28T13:48:00.000Z',
    durationMinutes: 77,
    branch: 'feature/auth',
    eventCount: 3,
    savedSummary: null,
    thread: { key: 'workscribe/landing-page|2026-10-28T12:31:00.000Z', projectId: 3, activeMinutes: 15 },
    block: { startedAt: '2026-10-28T12:09:00.000Z', endedAt: '2026-10-28T13:48:00.000Z', activeMinutes: 80 },
    alongside: [
      {
        repoName: 'workscribe/cli',
        startedAt: '2026-10-28T12:09:00.000Z',
        endedAt: '2026-10-28T13:40:00.000Z',
        eventCount: 89,
        activeMinutes: 70,
      },
      {
        repoName: 'workscribe/vscode',
        startedAt: '2026-10-28T12:15:00.000Z',
        endedAt: '2026-10-28T13:30:00.000Z',
        eventCount: 35,
        activeMinutes: 40,
      },
    ],
  },
  events: [COMMIT_EVENT],
}

const PROJECT_REPO = {
  repoName: 'workscribe/cli',
  branch: 'main',
  root: '/repo',
  remote: null,
  project: { identity: 'remote:github.com/workscribe/cli', kind: 'remote' },
}

function savedAnswer(text: string) {
  return { ...THREAD_ANSWER, context: { ...THREAD_ANSWER.context, savedSummary: text } }
}

function printedJson() {
  return JSON.parse(mockLog.plain.mock.calls[0][0] as string)
}

beforeEach(() => {
  mockReadConfig.mockReturnValue(createTestConfig())
})

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerContext(program)
  return program
}

describe('workscribe context --file', () => {
  it('answers from the thread, keeping every field the extension reads and adding the thread ones', async () => {
    vi.mocked(lookUpFileThread).mockReturnValueOnce(THREAD_ANSWER)

    await makeProgram().parseAsync(['context', '--file', '/repo/README.md', '--json'], { from: 'user' })

    const parsed = printedJson()
    expect(parsed).toMatchObject({
      repoName: 'workscribe/landing-page',
      date: '2026-10-28',
      startedAt: '2026-10-28T12:31:00.000Z',
      endedAt: '2026-10-28T13:48:00.000Z',
      durationMinutes: 77,
      branch: 'feature/auth',
      eventCount: 3,
      schemaVersion: 1,
      thread: THREAD_ANSWER.context.thread,
      block: THREAD_ANSWER.context.block,
      alongside: THREAD_ANSWER.context.alongside,
      file: null,
    })
    expect(typeof parsed.summary).toBe('string')
    expect(typeof parsed.timeAgo).toBe('string')
  })

  it('prints null with --json, and says so without it, when no work touched the file', async () => {
    await makeProgram().parseAsync(['context', '--file', 'src/auth.ts', '--json'], { from: 'user' })
    await makeProgram().parseAsync(['context', '--file', 'src/auth.ts'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenNthCalledWith(1, 'null')
    expect(mockLog.plain).toHaveBeenNthCalledWith(2, expect.stringContaining('No recent work found touching'))
  })

  it("renders the template from the thread's captured commits when nothing was saved for it, never asking git", async () => {
    vi.mocked(lookUpFileThread).mockReturnValueOnce(THREAD_ANSWER)

    await makeProgram().parseAsync(['context', '--file', '/repo/README.md', '--json'], { from: 'user' })

    expect(printedJson().summary).toContain('add auth middleware')
    expect(execFileSync).not.toHaveBeenCalled()
  })

  it('shows the summary saved for the thread instead of the template', async () => {
    vi.mocked(lookUpFileThread).mockReturnValueOnce(savedAnswer('## landing-page — 15m\n- Rewrote the README'))

    await makeProgram().parseAsync(['context', '--file', '/repo/README.md', '--json'], { from: 'user' })

    expect(printedJson().summary).toBe('## landing-page — 15m\n- Rewrote the README')
  })

  it("builds the file details from the thread's own events", async () => {
    const save = { ...COMMIT_EVENT, id: 4, category: 'code_edit', file_path: '/repo/README.md' }
    vi.mocked(lookUpFileThread).mockReturnValueOnce({ ...THREAD_ANSWER, events: [save] })

    await makeProgram().parseAsync(['context', '--file', '/repo/README.md', '--json'], { from: 'user' })

    expect(getFileDetails).toHaveBeenCalledWith('/repo/README.md', {
      events: [save],
      branch: 'feature/auth',
      startedAt: '2026-10-28T12:31:00.000Z',
      endedAt: '2026-10-28T13:48:00.000Z',
    })
  })

  it('adds the file details to --json, keeping every existing field', async () => {
    const details = { path: '/repo/README.md', relativePath: 'README.md', saveCount: 3 }
    vi.mocked(getFileDetails).mockReturnValueOnce(details as never)
    vi.mocked(lookUpFileThread).mockReturnValueOnce(THREAD_ANSWER)

    await makeProgram().parseAsync(['context', '--file', '/repo/README.md', '--json'], { from: 'user' })

    expect(Object.keys(printedJson())).toEqual(
      expect.arrayContaining(['repoName', 'date', 'startedAt', 'timeAgo', 'summary', 'schemaVersion', 'file'])
    )
    expect(printedJson().file).toEqual(details)
  })

  it('never looks up the file details in the human-readable output', async () => {
    vi.mocked(lookUpFileThread).mockReturnValueOnce(THREAD_ANSWER)

    await makeProgram().parseAsync(['context', '--file', '/repo/README.md'], { from: 'user' })

    expect(getFileDetails).not.toHaveBeenCalled()
  })

  it('prints the heading, the projects worked alongside and the summary in the text output', async () => {
    vi.mocked(lookUpFileThread).mockReturnValueOnce(savedAnswer('- Rewrote the README'))

    await makeProgram().parseAsync(['context', '--file', '/repo/README.md'], { from: 'user' })

    const lines = mockLog.plain.mock.calls.map((call) => call[0] as string)
    expect(lines.some((line) => line.includes('Last worked on README.md'))).toBe(true)
    expect(lines.some((line) => line.includes('Alongside') && line.includes('workscribe/cli, workscribe/vscode'))).toBe(
      true
    )
    expect(lines).toContain('  - Rewrote the README')
  })
})

describe('workscribe context (repo mode)', () => {
  it("answers from the repo's latest thread, by its project identity", async () => {
    mockGetRepoContext.mockReturnValue(PROJECT_REPO)
    vi.mocked(lookUpProjectThread).mockReturnValueOnce(THREAD_ANSWER)

    await makeProgram().parseAsync(['context', '--json'], { from: 'user' })

    expect(lookUpProjectThread).toHaveBeenCalledWith('remote:github.com/workscribe/cli')
    expect(printedJson()).toMatchObject({ schemaVersion: 1, eventCount: 3, repoName: 'workscribe/landing-page' })
    expect(printedJson()).not.toHaveProperty('file')
  })

  it('prints null with --json when not in a git repository', async () => {
    mockGetRepoContext.mockReturnValue({ repoName: null, branch: null, root: null, remote: null })

    await makeProgram().parseAsync(['context', '--json'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenCalledWith('null')
    expect(lookUpProjectThread).not.toHaveBeenCalled()
  })

  it('prints null with --json when no work was found for the repo', async () => {
    mockGetRepoContext.mockReturnValue(PROJECT_REPO)

    await makeProgram().parseAsync(['context', '--json'], { from: 'user' })

    expect(mockLog.plain).toHaveBeenCalledWith('null')
  })

  it('finds nothing for a repo without a project identity, without looking anything up', async () => {
    mockGetRepoContext.mockReturnValue({ ...PROJECT_REPO, project: undefined })

    await makeProgram().parseAsync(['context'], { from: 'user' })

    expect(lookUpProjectThread).not.toHaveBeenCalled()
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('No recent work found for workscribe/cli'))
  })

  it("names the folder as reached (like the shell hook's $PWD), so a projects override matches as in capture", async () => {
    const config = createTestConfig({ projects: { '/Users/dev/link/myapp': 'my-name' } })
    mockReadConfig.mockReturnValue(config)
    mockGetRepoContext.mockReturnValue(PROJECT_REPO)

    await makeProgram().parseAsync(['context'], { from: 'user' })

    expect(mockGetRepoContext).toHaveBeenCalledWith('/Users/dev/link/myapp', config)
  })

  it('never prints the 2.0 notice, even for a 1.x config — the VS Code extension reads this output', async () => {
    mockReadConfig.mockReturnValue(createTestConfig({ ai: { provider: 'anthropic', apiKey: 'sk-old' } }))
    mockGetRepoContext.mockReturnValue(PROJECT_REPO)
    vi.mocked(lookUpProjectThread).mockReturnValueOnce(THREAD_ANSWER)

    await makeProgram().parseAsync(['context', '--json'], { from: 'user' })

    expect(mockLog.notice).not.toHaveBeenCalled()
  })
})
