import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}))

vi.mock('../../src/db', () => ({ getDb: vi.fn() }))

vi.mock('../../src/config', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
}))

vi.mock('../../src/utils/paths')

vi.mock('../../src/capture/shell-hook', () => ({
  isHookInstalled: vi.fn(),
  isHookOutdated: vi.fn(),
  installHook: vi.fn(),
  updateHook: vi.fn(),
}))

vi.mock('../../src/capture/hooks', () => ({
  AI_HOOK_INTEGRATIONS: {
    'claude-code': {
      displayName: 'Claude Code',
      isInstalled: vi.fn(),
      isHookInstalled: vi.fn(),
      install: vi.fn(),
    },
    aider: {
      displayName: 'Aider',
      isInstalled: vi.fn(),
      isHookInstalled: vi.fn(),
      install: vi.fn(),
    },
  },
}))

vi.mock('../../src/config/ai-tools.json', () => ({
  default: [
    { tool: 'claude', displayName: 'Claude Code', pattern: '^claude\\b', hook: 'claude-code', contextSource: 'hook' },
    { tool: 'aider', displayName: 'Aider', pattern: '^aider\\b', hook: 'aider', contextSource: null },
    { tool: 'gemini', displayName: 'Gemini', pattern: '^gemini\\b', hook: null, contextSource: null },
  ],
}))

vi.mock('prompts', () => ({ default: vi.fn() }))

import fs from 'fs'
import { Command } from 'commander'
import prompts from 'prompts'
import { readConfig } from '../../src/config'
import { isHookInstalled } from '../../src/capture/shell-hook'
import { AI_HOOK_INTEGRATIONS } from '../../src/capture/hooks'
import { log } from '../../src/utils/logger'
import { registerInit } from '../../src/cli/init'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockPrompts = prompts as ReturnType<typeof vi.fn>
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
const mockIsHookInstalled = isHookInstalled as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>
const claudeIntegration = AI_HOOK_INTEGRATIONS['claude-code'] as Record<string, ReturnType<typeof vi.fn>>
const aiderIntegration = AI_HOOK_INTEGRATIONS['aider'] as Record<string, ReturnType<typeof vi.fn>>

const BASE_CONFIG = { ai: { provider: 'anthropic', apiKey: 'sk-test', model: null }, session: { idleTimeout: 30 } }

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerInit(program)
  return program
}

beforeEach(() => {
  // filesystem: workscribe dir exists, shell rc exists, hook template exists, config exists
  mockFs.existsSync.mockReturnValue(true)
  mockFs.readFileSync.mockReturnValue('# hook content')

  // shell hook: already installed and up to date — isolates AI tool step
  mockIsHookInstalled.mockReturnValue(true)

  // AI provider already configured — skips provider prompt
  mockReadConfig.mockReturnValue(BASE_CONFIG)

  // All hookable tools: not installed by default — each test overrides as needed
  claudeIntegration.isInstalled.mockReturnValue(false)
  claudeIntegration.isHookInstalled.mockReturnValue(false)
  claudeIntegration.install.mockReset()
  aiderIntegration.isInstalled.mockReturnValue(false)
  aiderIntegration.isHookInstalled.mockReturnValue(false)
  aiderIntegration.install.mockReset()
})

describe('workscribe init — AI tool hook integration', () => {
  describe('no AI tools installed', () => {
    it('logs a no-tools-detected message', async () => {
      claudeIntegration.isInstalled.mockReturnValue(false)
      await makeProgram().parseAsync(['init'], { from: 'user' })
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('No AI coding tools detected'))
    })

    it('does not prompt the user', async () => {
      claudeIntegration.isInstalled.mockReturnValue(false)
      await makeProgram().parseAsync(['init'], { from: 'user' })
      expect(mockPrompts).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'install' }))
    })
  })

  describe('tool installed, hook already present', () => {
    it('logs "already installed" without prompting', async () => {
      claudeIntegration.isInstalled.mockReturnValue(true)
      claudeIntegration.isHookInstalled.mockReturnValue(true)
      await makeProgram().parseAsync(['init'], { from: 'user' })
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('already installed'))
      expect(mockPrompts).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'install' }))
    })

    it('does not call install', async () => {
      claudeIntegration.isInstalled.mockReturnValue(true)
      claudeIntegration.isHookInstalled.mockReturnValue(true)
      await makeProgram().parseAsync(['init'], { from: 'user' })
      expect(claudeIntegration.install).not.toHaveBeenCalled()
    })
  })

  describe('tool installed, hook not present', () => {
    it('prompts with initial: false (opt-in default)', async () => {
      claudeIntegration.isInstalled.mockReturnValue(true)
      claudeIntegration.isHookInstalled.mockReturnValue(false)
      mockPrompts.mockResolvedValue({ install: false })
      await makeProgram().parseAsync(['init'], { from: 'user' })
      expect(mockPrompts).toHaveBeenCalledWith(expect.objectContaining({ name: 'install', initial: false }))
    })

    it('installs hook and logs success when user opts in', async () => {
      claudeIntegration.isInstalled.mockReturnValue(true)
      claudeIntegration.isHookInstalled.mockReturnValue(false)
      mockPrompts.mockResolvedValue({ install: true })
      await makeProgram().parseAsync(['init'], { from: 'user' })
      expect(claudeIntegration.install).toHaveBeenCalledOnce()
      expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining('session hook installed'))
    })

    it('logs skipped and does not install when user declines', async () => {
      claudeIntegration.isInstalled.mockReturnValue(true)
      claudeIntegration.isHookInstalled.mockReturnValue(false)
      mockPrompts.mockResolvedValue({ install: false })
      await makeProgram().parseAsync(['init'], { from: 'user' })
      expect(claudeIntegration.install).not.toHaveBeenCalled()
      expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('skipped'))
    })
  })

  describe('multiple hookable tools installed', () => {
    it('prompts for each installed tool independently', async () => {
      claudeIntegration.isInstalled.mockReturnValue(true)
      claudeIntegration.isHookInstalled.mockReturnValue(false)
      aiderIntegration.isInstalled.mockReturnValue(true)
      aiderIntegration.isHookInstalled.mockReturnValue(false)
      mockPrompts.mockResolvedValue({ install: true })
      await makeProgram().parseAsync(['init'], { from: 'user' })
      const installPromptCalls = mockPrompts.mock.calls.filter(
        (call) => (call[0] as Record<string, unknown>).name === 'install'
      )
      expect(installPromptCalls).toHaveLength(2)
    })

    it('installs only the tools the user opts into', async () => {
      claudeIntegration.isInstalled.mockReturnValue(true)
      claudeIntegration.isHookInstalled.mockReturnValue(false)
      aiderIntegration.isInstalled.mockReturnValue(true)
      aiderIntegration.isHookInstalled.mockReturnValue(false)
      mockPrompts
        .mockResolvedValueOnce({ install: true }) // Claude Code — yes
        .mockResolvedValueOnce({ install: false }) // Aider — no
      await makeProgram().parseAsync(['init'], { from: 'user' })
      expect(claudeIntegration.install).toHaveBeenCalledOnce()
      expect(aiderIntegration.install).not.toHaveBeenCalled()
    })
  })

  describe('non-hookable tool (hook: null)', () => {
    it('never prompts or installs for tools without hook support', async () => {
      // Gemini has hook: null in the registry — should be completely ignored
      // even if somehow its isInstalled were true
      claudeIntegration.isInstalled.mockReturnValue(false)
      aiderIntegration.isInstalled.mockReturnValue(false)
      await makeProgram().parseAsync(['init'], { from: 'user' })
      // only the "no tools detected" path fires — no install prompts
      expect(mockPrompts).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'install' }))
    })
  })
})
