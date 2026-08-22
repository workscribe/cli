import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/db', () => ({ insertEvent: vi.fn() }))
vi.mock('../../src/capture/git', () => ({ getGitContext: vi.fn() }))

import { Command } from 'commander'
import { insertEvent } from '../../src/db'
import { getGitContext } from '../../src/capture/git'
import { log } from '../../src/utils/logger'
import { registerNote } from '../../src/cli/note'

const mockInsertEvent = insertEvent as ReturnType<typeof vi.fn>
const mockGetGitContext = getGitContext as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerNote(program)
  return program
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetGitContext.mockReturnValue({ repoName: 'my-app', branch: 'main' })
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

  it('sets command to "workscribe note"', () => {
    makeProgram().parse(['note', 'some note'], { from: 'user' })
    expect(mockInsertEvent).toHaveBeenCalledWith(expect.objectContaining({ command: 'workscribe note' }))
  })

  it('attaches git context from cwd', () => {
    makeProgram().parse(['note', 'some note'], { from: 'user' })
    expect(mockInsertEvent).toHaveBeenCalledWith(expect.objectContaining({ repo_name: 'my-app', branch: 'main' }))
  })

  it('works when not in a git repo (null context)', () => {
    mockGetGitContext.mockReturnValue({ repoName: null, branch: null })
    makeProgram().parse(['note', 'some note'], { from: 'user' })
    expect(mockInsertEvent).toHaveBeenCalledWith(expect.objectContaining({ repo_name: null, branch: null }))
  })

  it('confirms success with repo name when in a git repo', () => {
    makeProgram().parse(['note', 'some note'], { from: 'user' })
    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining('my-app'))
  })

  it('confirms success without repo name when outside a git repo', () => {
    mockGetGitContext.mockReturnValue({ repoName: null, branch: null })
    makeProgram().parse(['note', 'some note'], { from: 'user' })
    expect(mockLog.success).toHaveBeenCalledWith('Note saved')
  })

  it('sets exit_code and duration_ms to null', () => {
    makeProgram().parse(['note', 'some note'], { from: 'user' })
    expect(mockInsertEvent).toHaveBeenCalledWith(expect.objectContaining({ exit_code: null, duration_ms: null }))
  })
})
