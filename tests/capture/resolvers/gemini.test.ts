import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({
  default: { existsSync: vi.fn(), readdirSync: vi.fn() },
}))

import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveGeminiPaths } from '../../../src/capture/resolvers/gemini'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>

const TMP_DIR = path.join(os.homedir(), '.gemini', 'tmp')

beforeEach(() => {
  mockFs.existsSync.mockReturnValue(false)
  mockFs.readdirSync.mockReturnValue([])
})

describe('resolveGeminiPaths', () => {
  it('returns empty array when tmp directory does not exist', () => {
    expect(resolveGeminiPaths()).toEqual([])
  })

  it('returns logs.json paths for each hash directory that has one', () => {
    mockFs.existsSync.mockImplementation((p: string) => {
      if (p === TMP_DIR) return true
      return p.endsWith('logs.json')
    })
    mockFs.readdirSync.mockReturnValue(['abc123', 'def456'] as unknown as string[])
    expect(resolveGeminiPaths()).toEqual([
      path.join(TMP_DIR, 'abc123', 'logs.json'),
      path.join(TMP_DIR, 'def456', 'logs.json'),
    ])
  })

  it('skips hash directories that do not contain logs.json', () => {
    mockFs.existsSync.mockImplementation((p: string) => {
      if (p === TMP_DIR) return true
      return p.includes('abc123') && p.endsWith('logs.json')
    })
    mockFs.readdirSync.mockReturnValue(['abc123', 'def456'] as unknown as string[])
    const result = resolveGeminiPaths()
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('abc123')
  })

  it('returns empty array when tmp directory exists but is empty', () => {
    mockFs.existsSync.mockImplementation((p: string) => p === TMP_DIR)
    mockFs.readdirSync.mockReturnValue([] as unknown as string[])
    expect(resolveGeminiPaths()).toEqual([])
  })
})
