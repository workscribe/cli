import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({
  default: { existsSync: vi.fn(), readdirSync: vi.fn() },
}))

import fs from 'fs'
import os from 'os'
import path from 'path'
import { resolveCopilotPaths } from '../../../src/capture/resolvers/copilot'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>

const SESSION_STATE_DIR = path.join(os.homedir(), '.copilot', 'session-state')

beforeEach(() => {
  mockFs.existsSync.mockReturnValue(false)
  mockFs.readdirSync.mockReturnValue([])
})

describe('resolveCopilotPaths', () => {
  it('returns empty array when session-state directory does not exist', () => {
    expect(resolveCopilotPaths()).toEqual([])
  })

  it('returns events.jsonl paths for each session that has one', () => {
    mockFs.existsSync.mockImplementation((p: string) => {
      if (p === SESSION_STATE_DIR) return true
      return p.endsWith('events.jsonl')
    })
    mockFs.readdirSync.mockReturnValue(['session-a', 'session-b'] as unknown as string[])
    expect(resolveCopilotPaths()).toEqual([
      path.join(SESSION_STATE_DIR, 'session-a', 'events.jsonl'),
      path.join(SESSION_STATE_DIR, 'session-b', 'events.jsonl'),
    ])
  })

  it('skips sessions where events.jsonl does not exist', () => {
    mockFs.existsSync.mockImplementation((p: string) => {
      if (p === SESSION_STATE_DIR) return true
      return p.includes('session-a') && p.endsWith('events.jsonl')
    })
    mockFs.readdirSync.mockReturnValue(['session-a', 'session-b'] as unknown as string[])
    const result = resolveCopilotPaths()
    expect(result).toHaveLength(1)
    expect(result[0]).toContain('session-a')
  })

  it('returns empty array when no sessions have events.jsonl', () => {
    mockFs.existsSync.mockImplementation((p: string) => p === SESSION_STATE_DIR)
    mockFs.readdirSync.mockReturnValue(['session-a'] as unknown as string[])
    expect(resolveCopilotPaths()).toEqual([])
  })
})
