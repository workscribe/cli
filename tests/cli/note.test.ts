import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db', () => ({ insertEvent: vi.fn() }))
vi.mock('../../src/capture/git', () => ({ getRepoContext: vi.fn() }))
vi.mock('../../src/config', () => ({ readConfig: vi.fn() }))
vi.mock('../../src/utils/working-directory', () => ({ currentDirectory: vi.fn(() => '/Users/dev/link/my-app') }))

import { Command } from 'commander'
import { insertEvent } from '../../src/db'
import { getRepoContext } from '../../src/capture/git'
import { readConfig } from '../../src/config'
import { createTestConfig } from '../helpers/config'
import { log } from '../../src/utils/logger'
import { registerNote } from '../../src/cli/note'

const mockInsertEvent = insertEvent as ReturnType<typeof vi.fn>
const mockGetRepoContext = getRepoContext as ReturnType<typeof vi.fn>
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerNote(program)
  return program
}

beforeEach(() => {
  mockReadConfig.mockReturnValue(createTestConfig())
  mockGetRepoContext.mockReturnValue({ repoName: 'my-app', branch: 'main', root: '/repo', remote: null })
})

describe('workscribe note', () => {
  it('inserts an event with category "note"', () => {
    makeProgram().parse(['note', 'Fixed race condition in auth middleware'], { from: 'user' })
    expect(mockInsertEvent).toHaveBeenCalledWith(expect.objectContaining({ category: 'note' }))
  })

  it('stores the note text in metadata', () => {
    makeProgram().parse(['note', 'Fixed race condition in auth middleware'], { from: 'user' })
    const call = mockInsertEvent.mock.calls[0][0] as Record<string, unknown>
    const metadata = JSON.parse(call.metadata as string) as { text: string }
    expect(metadata.text).toBe('Fixed race condition in auth middleware')
  })

  it('redacts a secret in the note, with the configured patterns too', () => {
    mockReadConfig.mockReturnValue(createTestConfig({ redact: { extra: ['INTERNAL'] } }))

    makeProgram().parse(['note', 'rotated it: --password=FAKEVALUE on INTERNAL'], { from: 'user' })

    const call = mockInsertEvent.mock.calls[0][0] as Record<string, unknown>
    const metadata = JSON.parse(call.metadata as string) as { text: string }
    expect(metadata.text).toBe('rotated it: --password=[REDACTED] on [REDACTED]')
  })

  it('sets command to "workscribe note"', () => {
    makeProgram().parse(['note', 'some note'], { from: 'user' })
    expect(mockInsertEvent).toHaveBeenCalledWith(expect.objectContaining({ command: 'workscribe note' }))
  })

  it('attaches git context from cwd', () => {
    makeProgram().parse(['note', 'some note'], { from: 'user' })
    expect(mockInsertEvent).toHaveBeenCalledWith(expect.objectContaining({ repo_name: 'my-app', branch: 'main' }))
  })

  it("links the note to the repo's project and branch", () => {
    mockGetRepoContext.mockReturnValue({
      repoName: 'my-app',
      branch: 'main',
      root: '/repo',
      remote: null,
      project: { identity: 'remote:github.com/acme/my-app', kind: 'remote' },
    })

    makeProgram().parse(['note', 'some note'], { from: 'user' })

    expect(mockInsertEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        dimensions: {
          project: { identity: 'remote:github.com/acme/my-app', kind: 'remote', name: 'my-app', root: '/repo' },
          branch: 'main',
          file: null,
        },
      })
    )
  })

  it('works when not in a git repo (null context)', () => {
    mockGetRepoContext.mockReturnValue({ repoName: null, branch: null, root: null, remote: null })
    makeProgram().parse(['note', 'some note'], { from: 'user' })
    expect(mockInsertEvent).toHaveBeenCalledWith(expect.objectContaining({ repo_name: null, branch: null }))
  })

  it('confirms success with repo name when in a git repo', () => {
    makeProgram().parse(['note', 'some note'], { from: 'user' })
    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining('my-app'))
  })

  it('confirms success without repo name when outside a git repo', () => {
    mockGetRepoContext.mockReturnValue({ repoName: null, branch: null, root: null, remote: null })
    makeProgram().parse(['note', 'some note'], { from: 'user' })
    expect(mockLog.success).toHaveBeenCalledWith('Note saved')
  })

  it('sets exit_code and duration_ms to null', () => {
    makeProgram().parse(['note', 'some note'], { from: 'user' })
    expect(mockInsertEvent).toHaveBeenCalledWith(expect.objectContaining({ exit_code: null, duration_ms: null }))
  })
})

describe('workscribe note — repo naming (WOR-118)', () => {
  it('names the repo from the config, so notes land in the same session as shell and IDE activity', () => {
    const config = createTestConfig({ git: { qualifyRepoName: true } })
    mockReadConfig.mockReturnValue(config)

    makeProgram().parse(['note', 'some note'], { from: 'user' })

    expect(mockGetRepoContext).toHaveBeenCalledWith('/Users/dev/link/my-app', config)
  })

  it('stores the folder as reached, like the shell hook does', () => {
    makeProgram().parse(['note', 'some note'], { from: 'user' })
    expect(mockInsertEvent).toHaveBeenCalledWith(expect.objectContaining({ cwd: '/Users/dev/link/my-app' }))
  })
})

describe('workscribe note in an excluded folder', () => {
  it('saves nothing and says so', () => {
    mockReadConfig.mockReturnValue(
      createTestConfig({ capture: { ...createTestConfig().capture, excludePaths: ['/Users/dev/link/my-app'] } })
    )

    makeProgram().parse(['note', 'something private'], { from: 'user' })

    expect(mockInsertEvent).not.toHaveBeenCalled()
    expect(mockGetRepoContext).not.toHaveBeenCalled()
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('excluded'))
  })
})
