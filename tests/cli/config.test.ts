import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest'

vi.mock('../../src/config', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
  getConfigValue: vi.fn(),
  setConfigValue: vi.fn(),
}))

vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('../../src/db/jobs/ticket-refs', () => ({ requestTicketRelink: vi.fn() }))
vi.mock('../../src/db/agent-sessions', () => ({ clearAgentMessages: vi.fn() }))

import { Command } from 'commander'
import { readConfig, writeConfig, getConfigValue, setConfigValue } from '../../src/config'
import { requestTicketRelink } from '../../src/db/jobs/ticket-refs'
import { clearAgentMessages } from '../../src/db/agent-sessions'
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
      const calls = mockLog.plain.mock.calls.map((call: unknown[]) => call[0] as string)
      expect(calls.some((call) => call.includes('sk-ant-abc123456789'))).toBe(false)
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
      const calls = mockLog.plain.mock.calls.map((call: unknown[]) => call[0] as string)
      expect(calls.some((call) => call.includes('sk-ant-abc123456789'))).toBe(false)
      expect(calls.some((call) => call.includes('****'))).toBe(true)
    })

    it('logs a warning when the key is not found', async () => {
      mockGetConfigValue.mockReturnValue(undefined)
      await makeProgram().parseAsync(['config', 'get', 'ai.unknown'], { from: 'user' })
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Key not found'))
    })
  })

  describe('config set <key> <value>', () => {
    it('calls setConfigValue and writeConfig', async () => {
      await makeProgram().parseAsync(['config', 'set', 'session.idleTimeout', '45'], { from: 'user' })
      expect(mockSetConfigValue).toHaveBeenCalledWith(BASE_CONFIG, 'session.idleTimeout', '45')
      expect(mockWriteConfig).toHaveBeenCalledWith(BASE_CONFIG)
    })

    it('logs success for a non-sensitive key', async () => {
      await makeProgram().parseAsync(['config', 'set', 'session.idleTimeout', '45'], { from: 'user' })
      expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining('session.idleTimeout'))
    })

    it.each([
      ['ai.provider', 'openai'],
      ['ai.apiKey', 'sk-new'],
      ['summary.engine', 'ollama'],
    ])('refuses the removed AI setting %s without reading or writing the config', async (key, value) => {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('exit')
      }) as never)
      onTestFinished(() => exitSpy.mockRestore())

      await expect(makeProgram().parseAsync(['config', 'set', key, value], { from: 'user' })).rejects.toThrow('exit')

      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('AI providers were removed in Workscribe 2.0'))
      expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('workscribe skill install'))
      expect(exitSpy).toHaveBeenCalledWith(1)
      expect(mockReadConfig).not.toHaveBeenCalled()
      expect(mockWriteConfig).not.toHaveBeenCalled()
    })

    it('shows [set] instead of the value for sensitive keys', async () => {
      await makeProgram().parseAsync(['config', 'set', 'integrations.token', 'tok-secret'], { from: 'user' })
      const calls = mockLog.success.mock.calls.map((call: unknown[]) => call[0] as string)
      expect(calls.some((call) => call.includes('[set]'))).toBe(true)
      expect(calls.some((call) => call.includes('tok-secret'))).toBe(false)
    })
  })

  describe('config set tickets.pattern', () => {
    function stubExit() {
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
        throw new Error('exit')
      }) as never)
      onTestFinished(() => exitSpy.mockRestore())
    }

    it('stores the pattern in the database first, then as a string in config.json — never coerced', async () => {
      const order: string[] = []
      vi.mocked(requestTicketRelink).mockImplementationOnce(() => {
        order.push('database')
      })
      mockWriteConfig.mockImplementationOnce(() => {
        order.push('config')
      })

      await makeProgram().parseAsync(['config', 'set', 'tickets.pattern', '123'], { from: 'user' })

      expect(order).toEqual(['database', 'config'])
      expect(requestTicketRelink).toHaveBeenCalledWith({}, '123')
      expect(mockWriteConfig).toHaveBeenCalledWith(expect.objectContaining({ tickets: { pattern: '123' } }))
      expect(mockSetConfigValue).not.toHaveBeenCalled()
      expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('re-linked'))
    })

    it.each([['('], ['.*'], ['(A+)+-\\d+']])(
      'refuses %s without touching the database or config.json',
      async (pattern) => {
        stubExit()

        await expect(
          makeProgram().parseAsync(['config', 'set', 'tickets.pattern', pattern], { from: 'user' })
        ).rejects.toThrow('exit')

        expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining("That ticket pattern can't be used"))
        expect(requestTicketRelink).not.toHaveBeenCalled()
        expect(mockWriteConfig).not.toHaveBeenCalled()
      }
    )

    it('leaves config.json alone when the database refuses, as a held lock would', async () => {
      vi.mocked(requestTicketRelink).mockImplementationOnce(() => {
        throw new Error('database is locked')
      })

      await expect(
        makeProgram().parseAsync(['config', 'set', 'tickets.pattern', '[A-Z]+-\\d+'], { from: 'user' })
      ).rejects.toThrow('database is locked')

      expect(mockWriteConfig).not.toHaveBeenCalled()
    })
  })

  describe('config set capture.agentMessages', () => {
    const setTo = (value: boolean) => {
      mockReadConfig.mockReturnValue(BASE_CONFIG)
      mockSetConfigValue.mockReturnValue({ ...BASE_CONFIG, capture: { agentMessages: value } })
      return makeProgram().parseAsync(['config', 'set', 'capture.agentMessages', String(value)], { from: 'user' })
    }

    it('forgets the stored recaps, in the database before config.json, when turned off', async () => {
      const order: string[] = []
      vi.mocked(clearAgentMessages).mockImplementationOnce(() => {
        order.push('database')
      })
      mockWriteConfig.mockImplementationOnce(() => {
        order.push('config')
      })

      await setTo(false)

      expect(order).toEqual(['database', 'config'])
    })

    it('keeps them when turned on', async () => {
      await setTo(true)

      expect(clearAgentMessages).not.toHaveBeenCalled()
      expect(mockWriteConfig).toHaveBeenCalled()
    })
  })
})
