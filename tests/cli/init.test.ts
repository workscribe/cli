import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    appendFileSync: vi.fn(),
  },
}))

vi.mock('../../src/db', () => ({ getDb: vi.fn() }))

vi.mock('../../src/config', () => ({
  readConfig: vi.fn(),
  writeConfig: vi.fn(),
}))

vi.mock('../../src/utils/paths', () => ({
  WORKSCRIBE_DIR: '/home/user/.workscribe',
  CONFIG_PATH: '/home/user/.workscribe/config.json',
  PROFILES_DIR: '/home/user/.workscribe/profiles',
  UPDATE_CHECK_PATH: '/home/user/.workscribe/update-check.json',
  REQUIRED_DIRS: ['/home/user/.workscribe'],
}))

vi.mock('../../src/capture/shell-hook', () => ({
  isHookInstalled: vi.fn(),
  isHookOutdated: vi.fn(),
  installHook: vi.fn(),
  updateHook: vi.fn(),
  isCompletionsInstalled: vi.fn(),
  installCompletions: vi.fn(),
  resolveWorkscribeBinary: vi.fn().mockReturnValue(null),
  injectBinaryPath: vi.fn((content: string) => content),
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

vi.mock('../../src/config/registry', () => ({
  loadAIToolRegistry: vi.fn().mockReturnValue([
    { tool: 'claude', displayName: 'Claude Code', pattern: '^claude\\b', hook: 'claude-code', contextSource: 'hook' },
    { tool: 'aider', displayName: 'Aider', pattern: '^aider\\b', hook: 'aider', contextSource: null },
    { tool: 'gemini', displayName: 'Gemini', pattern: '^gemini\\b', hook: null, contextSource: null },
  ]),
}))

vi.mock('../../src/ai/router', () => ({ getProvider: vi.fn() }))

vi.mock('../../src/profiles/fetcher', () => ({
  cacheManifest: vi.fn().mockResolvedValue(undefined),
  installProfile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/profiles/loader', () => ({
  detectProfilesForDirectory: vi.fn().mockReturnValue([]),
}))

vi.mock('prompts', () => ({ default: vi.fn() }))

import fs from 'fs'
import { Command } from 'commander'
import prompts from 'prompts'
import { readConfig } from '../../src/config'
import { isHookInstalled, installHook, isCompletionsInstalled } from '../../src/capture/shell-hook'
import { AI_HOOK_INTEGRATIONS } from '../../src/capture/hooks'
import { getProvider } from '../../src/ai/router'
import { log } from '../../src/utils/logger'
import { registerInit } from '../../src/cli/init'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockPrompts = prompts as ReturnType<typeof vi.fn>
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
const mockIsHookInstalled = isHookInstalled as ReturnType<typeof vi.fn>
const mockInstallHook = installHook as ReturnType<typeof vi.fn>
const mockIsCompletionsInstalled = isCompletionsInstalled as ReturnType<typeof vi.fn>
const mockGetProvider = getProvider as ReturnType<typeof vi.fn>
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
  // Completions already installed — skips the prompt in tests that don't test that flow
  mockIsCompletionsInstalled.mockReturnValue(true)

  // shell hook: already installed and up to date — isolates AI tool step
  mockIsHookInstalled.mockReturnValue(true)

  // AI provider already configured — skips provider prompt
  mockReadConfig.mockReturnValue(BASE_CONFIG)

  // Reset prompts to avoid "once" queue and default value leaking across tests
  mockPrompts.mockReset()

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

describe('workscribe init — step indicators (AC-1)', () => {
  it('prints numbered step headers for all five steps', async () => {
    await makeProgram().parseAsync(['init'], { from: 'user' })
    const allOutput = (mockLog.plain as ReturnType<typeof vi.fn>).mock.calls.flat().join('\n')
    expect(allOutput).toContain('[1/5]')
    expect(allOutput).toContain('[2/5]')
    expect(allOutput).toContain('[3/5]')
    expect(allOutput).toContain('[4/5]')
    expect(allOutput).toContain('[5/5]')
  })
})

describe('workscribe init — hook explanation (AC-2)', () => {
  it('prints explanation text before installing the hook for the first time', async () => {
    mockIsHookInstalled.mockReturnValue(false)
    await makeProgram().parseAsync(['init'], { from: 'user' })
    const allOutput = (mockLog.plain as ReturnType<typeof vi.fn>).mock.calls.flat().join('\n')
    expect(allOutput).toContain('background')
    expect(allOutput).toContain('redacted')
  })

  it('does not print explanation text when the hook is already installed', async () => {
    mockIsHookInstalled.mockReturnValue(true)
    await makeProgram().parseAsync(['init'], { from: 'user' })
    const allOutput = (mockLog.plain as ReturnType<typeof vi.fn>).mock.calls.flat().join('\n')
    expect(allOutput).not.toContain('Credentials and secrets are redacted')
  })

  it('installs the hook without prompting on first run', async () => {
    mockIsHookInstalled.mockReturnValue(false)
    await makeProgram().parseAsync(['init'], { from: 'user' })
    expect(mockInstallHook).toHaveBeenCalled()
  })
})

describe('workscribe init — API key validation (AC-3)', () => {
  // Factory to avoid shared-object mutation: init.ts mutates config.ai.provider in place
  const noProviderConfig = () => ({
    ai: { provider: '', apiKey: '', model: null },
    session: { idleTimeout: 30 },
    capture: { profiles: [] },
  })

  it('calls validate() after a key is entered for a key-based provider', async () => {
    mockReadConfig.mockReturnValue(noProviderConfig())
    const mockValidate = vi.fn().mockResolvedValue(undefined)
    mockGetProvider.mockReturnValue({ validate: mockValidate })
    mockPrompts.mockResolvedValueOnce({ provider: 'anthropic' }).mockResolvedValueOnce({ apiKey: 'sk-test-123' })
    await makeProgram().parseAsync(['init'], { from: 'user' })
    expect(mockValidate).toHaveBeenCalled()
  })

  it('logs success when validation passes', async () => {
    mockReadConfig.mockReturnValue(noProviderConfig())
    mockGetProvider.mockReturnValue({ validate: vi.fn().mockResolvedValue(undefined) })
    mockPrompts.mockResolvedValueOnce({ provider: 'anthropic' }).mockResolvedValueOnce({ apiKey: 'sk-test-123' })
    await makeProgram().parseAsync(['init'], { from: 'user' })
    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining('verified'))
  })

  it('logs a warning and prompts to save anyway when validation fails', async () => {
    mockReadConfig.mockReturnValue(noProviderConfig())
    mockGetProvider.mockReturnValue({ validate: vi.fn().mockRejectedValue(new Error('401 Unauthorized')) })
    mockPrompts
      .mockResolvedValueOnce({ provider: 'anthropic' })
      .mockResolvedValueOnce({ apiKey: 'bad-key' })
      .mockResolvedValueOnce({ retry: false })
    await makeProgram().parseAsync(['init'], { from: 'user' })
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Validation failed'))
    expect(mockPrompts).toHaveBeenCalledWith(expect.objectContaining({ name: 'retry' }))
  })

  it('saves config when user chooses to save despite validation failure', async () => {
    const { writeConfig } = await import('../../src/config')
    const mockWriteConfig = writeConfig as ReturnType<typeof vi.fn>
    mockReadConfig.mockReturnValue(noProviderConfig())
    mockGetProvider.mockReturnValue({ validate: vi.fn().mockRejectedValue(new Error('401')) })
    mockPrompts
      .mockResolvedValueOnce({ provider: 'anthropic' })
      .mockResolvedValueOnce({ apiKey: 'bad-key' })
      .mockResolvedValueOnce({ retry: true })
    await makeProgram().parseAsync(['init'], { from: 'user' })
    expect(mockWriteConfig).toHaveBeenCalled()
  })

  it('skips the API key prompt for ollama and still validates', async () => {
    mockReadConfig.mockReturnValue(noProviderConfig())
    const mockValidate = vi.fn().mockResolvedValue(undefined)
    mockGetProvider.mockReturnValue({ validate: mockValidate })
    mockPrompts.mockResolvedValueOnce({ provider: 'ollama' })
    await makeProgram().parseAsync(['init'], { from: 'user' })
    expect(mockPrompts).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'apiKey' }))
    expect(mockValidate).toHaveBeenCalled()
  })
})

describe('workscribe init — what to do next (AC-4)', () => {
  it('shows workscribe summary as primary CTA when provider is configured', async () => {
    await makeProgram().parseAsync(['init'], { from: 'user' })
    const allOutput = (mockLog.plain as ReturnType<typeof vi.fn>).mock.calls.flat().join('\n')
    expect(allOutput).toContain('workscribe summary')
  })

  it('shows config commands as primary CTA when provider was skipped', async () => {
    mockReadConfig.mockReturnValue({
      ai: { provider: '', apiKey: '', model: null as null },
      session: { idleTimeout: 30 },
      capture: { profiles: [] },
    })
    mockPrompts.mockResolvedValueOnce({ provider: 'skip' })
    await makeProgram().parseAsync(['init'], { from: 'user' })
    const allOutput = (mockLog.plain as ReturnType<typeof vi.fn>).mock.calls.flat().join('\n')
    expect(allOutput).toContain('workscribe config set ai.provider')
  })
})
