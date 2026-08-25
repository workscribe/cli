import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({
  default: { existsSync: vi.fn(), readFileSync: vi.fn() },
}))

import fs from 'fs'
import { resolveAiderPaths } from '../../../src/capture/resolvers/aider'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  mockFs.existsSync.mockReturnValue(false)
  mockFs.readFileSync.mockImplementation(() => {
    throw new Error('ENOENT')
  })
})

describe('resolveAiderPaths', () => {
  it('returns empty array when default history file does not exist', () => {
    expect(resolveAiderPaths('/repo')).toEqual([])
  })

  it('returns the default history file path when it exists', () => {
    mockFs.existsSync.mockImplementation((p: string) => p.endsWith('.aider.chat.history.md'))
    const result = resolveAiderPaths('/repo')
    expect(result).toEqual(['/repo/.aider.chat.history.md'])
  })

  it('uses custom path from .aider.conf.yml in cwd when present', () => {
    mockFs.readFileSync.mockImplementation((p: string) => {
      if (p === '/repo/.aider.conf.yml') return 'chat-history-file: /custom/history.md\n'
      throw new Error('ENOENT')
    })
    mockFs.existsSync.mockImplementation((p: string) => p === '/custom/history.md')
    const result = resolveAiderPaths('/repo')
    expect(result).toEqual(['/custom/history.md'])
  })

  it('uses relative custom path resolved against cwd', () => {
    mockFs.readFileSync.mockImplementation((p: string) => {
      if (p === '/repo/.aider.conf.yml') return 'chat-history-file: logs/chat.md\n'
      throw new Error('ENOENT')
    })
    mockFs.existsSync.mockImplementation((p: string) => p === '/repo/logs/chat.md')
    const result = resolveAiderPaths('/repo')
    expect(result).toEqual(['/repo/logs/chat.md'])
  })

  it('strips quotes from the config value', () => {
    mockFs.readFileSync.mockImplementation((p: string) => {
      if (p === '/repo/.aider.conf.yml') return 'chat-history-file: "/custom/history.md"\n'
      throw new Error('ENOENT')
    })
    mockFs.existsSync.mockImplementation((p: string) => p === '/custom/history.md')
    expect(resolveAiderPaths('/repo')).toEqual(['/custom/history.md'])
  })

  it('falls back to default when custom path from config does not exist', () => {
    mockFs.readFileSync.mockImplementation((p: string) => {
      if (p === '/repo/.aider.conf.yml') return 'chat-history-file: /missing/history.md\n'
      throw new Error('ENOENT')
    })
    mockFs.existsSync.mockReturnValue(false)
    expect(resolveAiderPaths('/repo')).toEqual([])
  })

  it('returns empty array when custom path exists in config but file is missing', () => {
    mockFs.readFileSync.mockImplementation((p: string) => {
      if (p === '/repo/.aider.conf.yml') return 'chat-history-file: /gone/history.md\n'
      throw new Error('ENOENT')
    })
    mockFs.existsSync.mockReturnValue(false)
    expect(resolveAiderPaths('/repo')).toEqual([])
  })
})
