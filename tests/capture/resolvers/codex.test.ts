import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({
  default: { existsSync: vi.fn(), readdirSync: vi.fn() },
}))

import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveCodexPaths } from '../../../src/capture/resolvers/codex'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  mockFs.existsSync.mockReturnValue(false)
  mockFs.readdirSync.mockReturnValue([])
})

describe('resolveCodexPaths', () => {
  it('returns empty array when sessions directory does not exist', () => {
    expect(resolveCodexPaths()).toEqual([])
  })

  it('returns all .jsonl files in the sessions directory', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readdirSync.mockReturnValue(['abc123.jsonl', 'def456.jsonl'] as unknown as string[])
    const sessionsDir = path.join(os.homedir(), '.codex', 'sessions')
    expect(resolveCodexPaths()).toEqual([
      path.join(sessionsDir, 'abc123.jsonl'),
      path.join(sessionsDir, 'def456.jsonl'),
    ])
  })

  it('excludes non-jsonl files', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readdirSync.mockReturnValue(['session.jsonl', 'notes.txt', 'config.json'] as unknown as string[])
    const result = resolveCodexPaths()
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('session.jsonl')
  })

  it('returns empty array when directory exists but contains no jsonl files', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readdirSync.mockReturnValue(['readme.md'] as unknown as string[])
    expect(resolveCodexPaths()).toEqual([])
  })
})
