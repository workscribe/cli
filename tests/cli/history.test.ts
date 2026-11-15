import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('../../src/db/history', () => ({ getProjectEventsSince: vi.fn(() => []) }))
vi.mock('../../src/config', () => ({ readConfig: vi.fn(() => ({})) }))
vi.mock('../../src/capture/git', () => ({ getRepoContext: vi.fn() }))
vi.mock('../../src/utils/working-directory', () => ({ currentDirectory: vi.fn(() => '/repo') }))
// The upgrade gate is tested with the thread commands; here it passes unless a test says so
vi.mock('../../src/cli/thread-day', () => ({ requireThreadData: vi.fn() }))
vi.mock('../../src/cli/fail', () => ({
  fail: vi.fn((message: string) => {
    throw new Error(message)
  }),
}))

import { Command } from 'commander'
import { getRepoContext } from '../../src/capture/git'
import { getProjectEventsSince } from '../../src/db/history'
import { requireThreadData } from '../../src/cli/thread-day'
import { log } from '../../src/utils/logger'
import { registerHistory } from '../../src/cli/history'
import { row as capturedRow } from '../summary/contract/fixtures'

const mockLog = log as Record<string, ReturnType<typeof vi.fn>>
const REPO = {
  repoName: 'api',
  branch: 'main',
  root: '/repo',
  remote: null,
  project: { identity: 'remote:x/api', kind: 'remote' },
}

function run(...args: string[]) {
  const program = new Command()
  program.exitOverride()
  registerHistory(program)
  return program.parseAsync(['history', ...args], { from: 'user' })
}

const printed = () => mockLog.plain.mock.calls.map((call) => call[0] as string).join('\n')

beforeEach(() => {
  vi.mocked(getRepoContext).mockReturnValue(REPO as never)
})

describe('workscribe history', () => {
  it("lists the repo's git commands with their moves and recovery pointers", async () => {
    vi.mocked(getProjectEventsSince).mockReturnValue([
      capturedRow({ command: 'git switch -c feat/x', id: 1, branch: 'feat/x', source: null }),
      capturedRow({ command: 'git reset --hard', id: 2, branch: 'feat/x', source: null }),
      capturedRow({ command: 'git push', id: 3, branch: 'feat/x', source: null, exit_code: 1 }),
    ])

    await run()

    const text = printed()
    expect(text).toContain('History of api')
    expect(text).toContain('git switch -c feat/x')
    expect(text).toContain('Created feat/x')
    expect(text).toContain('Discarded local changes (git reset --hard)')
    expect(text).toContain('git reflog')
    expect(text).toContain('✗1')
  })

  it('asks the database for the repo since the parsed bound, and lists non-git commands only with --all', async () => {
    vi.mocked(getProjectEventsSince).mockReturnValue([capturedRow({ command: 'npm test', id: 1 })])

    await run('--since', '2d')
    expect(vi.mocked(getProjectEventsSince).mock.calls[0].slice(1)).toEqual([
      'remote:x/api',
      expect.stringMatching(/^\d{4}-/),
    ])
    expect(printed()).toContain('No git commands in api since 2d')

    mockLog.plain.mockClear()
    await run('--all')
    expect(printed()).toContain('npm test')
  })

  it('outputs the versioned JSON without any command', async () => {
    vi.mocked(getProjectEventsSince).mockReturnValue([capturedRow({ command: 'git stash', id: 1, source: null })])

    await run('--json')

    const json = JSON.parse(mockLog.plain.mock.calls[0][0] as string)
    expect(json).toMatchObject({ schemaVersion: 1, repo: 'api', leftStashed: ['Left changes stashed (git stash)'] })
    expect(JSON.stringify(json)).not.toContain('git stash"')
  })

  it('says so outside a repo, and with no project yet — null in JSON', async () => {
    vi.mocked(getRepoContext).mockReturnValue({ repoName: null } as never)
    await run()
    expect(printed()).toContain('Not in a git repository')

    mockLog.plain.mockClear()
    await run('--json')
    expect(mockLog.plain).toHaveBeenCalledWith('null')

    vi.mocked(getRepoContext).mockReturnValue({ ...REPO, project: null } as never)
    mockLog.plain.mockClear()
    await run()
    expect(printed()).toContain('No history yet for api')
  })

  it('rejects a bad --since, and stops until data is upgraded', async () => {
    await expect(run('--since', 'soon')).rejects.toThrow(/Invalid --since/)

    vi.mocked(requireThreadData).mockImplementationOnce(() => {
      throw new Error('upgrade needed')
    })
    await expect(run()).rejects.toThrow('upgrade needed')
  })
})
