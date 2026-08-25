import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({
  default: { existsSync: vi.fn() },
}))

import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveOpencodePaths } from '../../../src/capture/resolvers/opencode'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>

const MACOS_DB = path.join(os.homedir(), 'Library', 'Application Support', 'opencode', 'opencode.db')
const LINUX_DB = path.join(os.homedir(), '.local', 'share', 'opencode', 'opencode.db')
const XDG_DB = '/custom/data/opencode/opencode.db'

beforeEach(() => {
  mockFs.existsSync.mockReturnValue(false)
  delete process.env.XDG_DATA_HOME
})

describe('resolveOpencodePaths', () => {
  it('returns empty array when database file does not exist', () => {
    expect(resolveOpencodePaths()).toEqual([])
  })

  it('returns macOS Application Support path on darwin', () => {
    vi.stubEnv('XDG_DATA_HOME', '')
    Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true })
    mockFs.existsSync.mockImplementation((p: string) => p === MACOS_DB)
    expect(resolveOpencodePaths()).toEqual([MACOS_DB])
  })

  it('returns ~/.local/share path on linux when XDG_DATA_HOME is not set', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    delete process.env.XDG_DATA_HOME
    mockFs.existsSync.mockImplementation((p: string) => p === LINUX_DB)
    expect(resolveOpencodePaths()).toEqual([LINUX_DB])
  })

  it('uses XDG_DATA_HOME on linux when set', () => {
    Object.defineProperty(process, 'platform', { value: 'linux', configurable: true })
    process.env.XDG_DATA_HOME = '/custom/data'
    mockFs.existsSync.mockImplementation((p: string) => p === XDG_DB)
    expect(resolveOpencodePaths()).toEqual([XDG_DB])
    delete process.env.XDG_DATA_HOME
  })
})
