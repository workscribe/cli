import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('child_process', () => ({ execSync: vi.fn() }))

import { execSync } from 'child_process'
import { isCommandInstalled } from '../src/capture/hooks/utils'

const mockExecSync = execSync as ReturnType<typeof vi.fn>

beforeEach(() => vi.clearAllMocks())

describe('isCommandInstalled', () => {
  it('returns true when the command is found on PATH', () => {
    mockExecSync.mockReturnValue(Buffer.from('/usr/bin/git\n'))
    expect(isCommandInstalled('git')).toBe(true)
    expect(mockExecSync).toHaveBeenCalledWith('which git', { stdio: 'ignore' })
  })

  it('returns false when the command is not found', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not found') })
    expect(isCommandInstalled('nonexistent-tool')).toBe(false)
  })

  it('returns false when execSync throws a non-zero exit error', () => {
    const err = Object.assign(new Error('Command failed'), { status: 1 })
    mockExecSync.mockImplementation(() => { throw err })
    expect(isCommandInstalled('claude')).toBe(false)
  })

  it('passes the command name to which', () => {
    mockExecSync.mockReturnValue(Buffer.from('/usr/local/bin/node\n'))
    isCommandInstalled('node')
    expect(mockExecSync).toHaveBeenCalledWith('which node', { stdio: 'ignore' })
  })
})
