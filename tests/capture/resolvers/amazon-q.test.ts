import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({
  default: { existsSync: vi.fn(), readdirSync: vi.fn() },
}))

import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveAmazonQPaths } from '../../../src/capture/resolvers/amazon-q'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>

const DEFAULT_HISTORY_DIR = path.join(os.homedir(), '.aws', 'amazonq', 'history')

beforeEach(() => {
  mockFs.existsSync.mockReturnValue(false)
  mockFs.readdirSync.mockReturnValue([])
})

describe('resolveAmazonQPaths', () => {
  it('returns empty array when history directory does not exist', () => {
    expect(resolveAmazonQPaths()).toEqual([])
  })

  it('returns chat-history-*.json files from the default directory', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readdirSync.mockReturnValue([
      'chat-history-2026-08-01.json',
      'chat-history-2026-08-02.json',
    ] as unknown as string[])
    expect(resolveAmazonQPaths()).toEqual([
      path.join(DEFAULT_HISTORY_DIR, 'chat-history-2026-08-01.json'),
      path.join(DEFAULT_HISTORY_DIR, 'chat-history-2026-08-02.json'),
    ])
  })

  it('excludes files that do not match the chat-history-*.json pattern', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readdirSync.mockReturnValue([
      'chat-history-2026-08-01.json',
      'index.json',
      'settings.json',
    ] as unknown as string[])
    const result = resolveAmazonQPaths()
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('chat-history-2026-08-01.json')
  })

  it('returns empty array when directory exists but contains no matching files', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readdirSync.mockReturnValue(['index.json'] as unknown as string[])
    expect(resolveAmazonQPaths()).toEqual([])
  })
})
