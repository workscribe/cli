import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs')
vi.mock('../../src/config/ai-tools.json', () => ({
  default: [
    { tool: 'claude', displayName: 'Claude Code', pattern: '^claude\\b', hook: 'claude-code', contextSource: 'hook' },
    { tool: 'aider', displayName: 'Aider', pattern: '^aider\\b', hook: null, contextSource: 'history-file' },
  ],
}))

import fs from 'fs'
import { loadAIToolRegistry } from '../../src/config/registry'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  vi.resetAllMocks()
})

describe('loadAIToolRegistry', () => {
  describe('no user registry', () => {
    it('returns built-in tools when no user file exists', () => {
      mockFs.existsSync.mockReturnValue(false)
      const tools = loadAIToolRegistry()
      expect(tools).toHaveLength(2)
      expect(tools[0].tool).toBe('claude')
      expect(tools[1].tool).toBe('aider')
    })
  })

  describe('user registry with new tools', () => {
    it('merges user tools alongside built-ins', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify([{ tool: 'my-tool', displayName: 'My Tool', pattern: '^my-tool\\b' }])
      )
      const tools = loadAIToolRegistry()
      expect(tools.map((entry) => entry.tool)).toContain('claude')
      expect(tools.map((entry) => entry.tool)).toContain('aider')
      expect(tools.map((entry) => entry.tool)).toContain('my-tool')
    })
  })

  describe('user registry overriding a built-in', () => {
    it('user entry replaces built-in with same tool slug', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify([{ tool: 'aider', displayName: 'Aider (custom)', pattern: '^aider2\\b' }])
      )
      const tools = loadAIToolRegistry()
      const aiderEntries = tools.filter((entry) => entry.tool === 'aider')
      expect(aiderEntries).toHaveLength(1)
      expect(aiderEntries[0].displayName).toBe('Aider (custom)')
      expect(aiderEntries[0].pattern).toBe('^aider2\\b')
    })

    it('still includes non-overridden built-ins', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify([{ tool: 'aider', displayName: 'Aider (custom)', pattern: '^aider2\\b' }])
      )
      const tools = loadAIToolRegistry()
      expect(tools.map((entry) => entry.tool)).toContain('claude')
    })
  })

  describe('malformed user registry', () => {
    it('falls back to built-ins when JSON is invalid', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue('not json {{{')
      const tools = loadAIToolRegistry()
      expect(tools).toHaveLength(2)
      expect(tools[0].tool).toBe('claude')
    })

    it('falls back to built-ins when file contains a non-array', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify({ tool: 'bad' }))
      const tools = loadAIToolRegistry()
      expect(tools).toHaveLength(2)
    })
  })

  describe('user entry validation', () => {
    it('skips entries missing tool or pattern', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(
        JSON.stringify([
          { displayName: 'No Tool Key', pattern: '^foo\\b' },
          { tool: 'valid-tool', displayName: 'Valid', pattern: '^valid\\b' },
        ])
      )
      const tools = loadAIToolRegistry()
      expect(tools.map((entry) => entry.tool)).toContain('valid-tool')
      expect(tools.map((entry) => entry.tool)).not.toContain(undefined)
    })

    it('defaults displayName to tool slug when omitted', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify([{ tool: 'no-display', pattern: '^no-display\\b' }]))
      const tools = loadAIToolRegistry()
      const entry = tools.find((entry) => entry.tool === 'no-display')
      expect(entry?.displayName).toBe('no-display')
    })

    it('defaults hook and contextSource to null when omitted', () => {
      mockFs.existsSync.mockReturnValue(true)
      mockFs.readFileSync.mockReturnValue(JSON.stringify([{ tool: 'minimal', pattern: '^minimal\\b' }]))
      const tools = loadAIToolRegistry()
      const entry = tools.find((entry) => entry.tool === 'minimal')
      expect(entry?.hook).toBeNull()
      expect(entry?.contextSource).toBeNull()
    })
  })
})
