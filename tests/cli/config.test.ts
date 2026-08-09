import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/config', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
  getConfigValue: vi.fn(),
  setConfigValue: vi.fn(),
}))

import { Command } from 'commander'
import { readConfig, writeConfig, getConfigValue, setConfigValue } from '../../src/config'
import { log } from '../../src/utils/logger'
import { registerConfig } from '../../src/cli/config'

const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
const mockWriteConfig = writeConfig as ReturnType<typeof vi.fn>
const mockGetConfigValue = getConfigValue as ReturnType<typeof vi.fn>
const mockSetConfigValue = setConfigValue as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

const BASE_CONFIG = {
  ai: { provider: 'anthropic', apiKey: 'sk-ant-abc123456789', model: null },
  session: { idleTimeout: 30 },
}

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerConfig(program)
  return program
}

beforeEach(() => {
  mockReadConfig.mockReturnValue(BASE_CONFIG)
  mockSetConfigValue.mockReturnValue(BASE_CONFIG)
})

describe('workscribe config', () => {
  describe('config (list view)', () => {
    it('calls readConfig and prints all keys', async () => {
      await makeProgram().parseAsync(['config'], { from: 'user' })
      expect(mockReadConfig).toHaveBeenCalledOnce()
      expect(mockLog.plain).toHaveBeenCalled()
    })

    it('masks apiKey values in the list view', async () => {
      await makeProgram().parseAsync(['config'], { from: 'user' })
      const calls = mockLog.plain.mock.calls.map((c: unknown[]) => c[0] as string)
      expect(calls.some((c) => c.includes('sk-ant-abc123456789'))).toBe(false)
    })
  })

  describe('config get <key>', () => {
    it('prints the value for a non-sensitive key', async () => {
      mockGetConfigValue.mockReturnValue('anthropic')
      await makeProgram().parseAsync(['config', 'get', 'ai.provider'], { from: 'user' })
      expect(mockGetConfigValue).toHaveBeenCalledWith(BASE_CONFIG, 'ai.provider')
      expect(mockLog.plain).toHaveBeenCalledWith('anthropic')
    })

    it('masks the value for the apiKey key', async () => {
      mockGetConfigValue.mockReturnValue('sk-ant-abc123456789')
      await makeProgram().parseAsync(['config', 'get', 'ai.apiKey'], { from: 'user' })
      const calls = mockLog.plain.mock.calls.map((c: unknown[]) => c[0] as string)
      expect(calls.some((c) => c.includes('sk-ant-abc123456789'))).toBe(false)
      expect(calls.some((c) => c.includes('****'))).toBe(true)
    })

    it('logs a warning when the key is not found', async () => {
      mockGetConfigValue.mockReturnValue(undefined)
      await makeProgram().parseAsync(['config', 'get', 'ai.unknown'], { from: 'user' })
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Key not found'))
    })
  })

  describe('config set <key> <value>', () => {
    it('calls setConfigValue and writeConfig', async () => {
      await makeProgram().parseAsync(['config', 'set', 'ai.provider', 'openai'], { from: 'user' })
      expect(mockSetConfigValue).toHaveBeenCalledWith(BASE_CONFIG, 'ai.provider', 'openai')
      expect(mockWriteConfig).toHaveBeenCalledOnce()
    })

    it('logs success for a non-sensitive key', async () => {
      await makeProgram().parseAsync(['config', 'set', 'ai.provider', 'openai'], { from: 'user' })
      expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining('ai.provider'))
    })

    it('shows [set] instead of the value for sensitive keys', async () => {
      await makeProgram().parseAsync(['config', 'set', 'ai.apiKey', 'sk-secret-key'], { from: 'user' })
      const calls = mockLog.success.mock.calls.map((c: unknown[]) => c[0] as string)
      expect(calls.some((c) => c.includes('[set]'))).toBe(true)
      expect(calls.some((c) => c.includes('sk-secret-key'))).toBe(false)
    })
  })
})
