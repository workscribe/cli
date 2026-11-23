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

vi.mock('../../src/capture/shell-hook', async (importOriginal) => ({
  // The real one: it only reads $SHELL
  detectShell: (await importOriginal<typeof import('../../src/capture/shell-hook')>()).detectShell,
  hasChronicleHook: vi.fn(() => false),
  removeChronicleHook: vi.fn(),
  isHookInstalled: vi.fn(),
  isHookOutdated: vi.fn(),
  installHook: vi.fn(),
  updateHook: vi.fn(),
  isCompletionsInstalled: vi.fn(),
  installCompletions: vi.fn(),
  isCompletionsOutdated: vi.fn(() => false),
  updateCompletions: vi.fn(),
  writeCompletionScript: vi.fn(),
  resolveWorkscribeBinary: vi.fn().mockReturnValue(null),
  injectBinaryPath: vi.fn((content: string) => content),
}))

vi.mock('../../src/capture/hooks', () => ({
  AI_HOOK_INTEGRATIONS: {
    'claude-code': {
      displayName: 'Claude Code',
      settingsPath: '~/.claude/settings.json',
      isInstalled: vi.fn(),
      isHookInstalled: vi.fn(),
      isHookOutdated: vi.fn(() => false),
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

vi.mock('../../src/profiles/fetcher', () => ({
  cacheManifest: vi.fn().mockResolvedValue(undefined),
  installProfile: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('../../src/profiles/loader', () => ({
  detectProfilesForDirectory: vi.fn().mockReturnValue([]),
}))

vi.mock('prompts', () => ({ default: vi.fn() }))

// fs is mocked above, so the skill modules must be too — by default no coding agents are detected
vi.mock('../../src/skills/detect', () => ({ detectAgents: vi.fn().mockReturnValue([]) }))
vi.mock('../../src/skills/installer', () => ({ installSkill: vi.fn(), readInstallState: vi.fn() }))
vi.mock('../../src/skills/package-path', () => ({ resolvePackagedSkillDir: vi.fn(() => '/pkg/skills/workscribe') }))

import fs from 'fs'
import { Command } from 'commander'
import prompts from 'prompts'
import { readConfig } from '../../src/config'
import {
  hasChronicleHook,
  removeChronicleHook,
  isHookInstalled,
  installHook,
  isCompletionsInstalled,
  isCompletionsOutdated,
  updateCompletions,
  writeCompletionScript,
} from '../../src/capture/shell-hook'
import { AI_HOOK_INTEGRATIONS } from '../../src/capture/hooks'
import { log } from '../../src/utils/logger'
import { registerInit } from '../../src/cli/init'
import { createTestConfig } from '../helpers/config'
import { detectAgents } from '../../src/skills/detect'
import { installSkill, readInstallState } from '../../src/skills/installer'
import { resolvePackagedSkillDir } from '../../src/skills/package-path'
import { skillAgent as agent } from '../helpers/skill-agents'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockPrompts = prompts as ReturnType<typeof vi.fn>
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
const mockIsHookInstalled = isHookInstalled as ReturnType<typeof vi.fn>
const mockInstallHook = installHook as ReturnType<typeof vi.fn>
const mockIsCompletionsInstalled = isCompletionsInstalled as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>
const claudeIntegration = AI_HOOK_INTEGRATIONS['claude-code'] as Record<string, ReturnType<typeof vi.fn>>
const aiderIntegration = AI_HOOK_INTEGRATIONS['aider'] as Record<string, ReturnType<typeof vi.fn>>

// init.ts can mutate the config it reads in place — always generate a fresh object per test rather than sharing
// one, or a mutation from one test would leak into the next.
const legacyAiConfig = () =>
  createTestConfig({ ai: { provider: 'anthropic', apiKey: 'sk-old', model: '', baseUrl: '' } })

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerInit(program)
  return program
}

// prompts() is called many times across one `init` run (shell hook,
// completions, per-AI-tool, AI provider, apiKey, retry, ...) — routing by the
// prompt's `name` rather than call position means adding a new prompt anywhere
// in the flow can't silently shift every other test's
// positional mockResolvedValueOnce queue out of sync. Pass an array per name
// for tests that need a different answer on each successive call to that name
// (e.g. two different AI tools both prompting `install`); a single-value array
// repeats forever.
function mockPromptAnswers(overrides: Record<string, unknown[]> = {}) {
  const defaults: Record<string, unknown[]> = {
    update: [true],
    installComps: [true],
    updateShellCompletions: [true],
    updateAiHook: [true],
    install: [false],
    installSkill: [false],
    removeLegacyAi: [true],
    removeChronicle: [true],
  }
  const queues: Record<string, unknown[]> = {}
  for (const name of Object.keys(defaults)) {
    queues[name] = [...(overrides[name] ?? defaults[name])]
  }
  mockPrompts.mockImplementation(async (options: { name: string }) => {
    const queue = queues[options.name] ?? []
    const value = queue.length > 1 ? queue.shift() : queue[0]
    return { [options.name]: value }
  })
}

beforeEach(() => {
  // filesystem: workscribe dir exists, shell rc exists, hook template exists, config exists
  mockFs.existsSync.mockReturnValue(true)
  mockFs.readFileSync.mockReturnValue('# hook content')
  // Completions already installed — skips the prompt in tests that don't test that flow
  mockIsCompletionsInstalled.mockReturnValue(true)

  // shell hook: already installed and up to date — isolates AI tool step
  mockIsHookInstalled.mockReturnValue(true)

  // A 2.0 config (no old AI settings) — skips the legacy-cleanup prompt
  mockReadConfig.mockReturnValue(createTestConfig())

  mockPrompts.mockReset()
  mockPromptAnswers()

  // All hookable tools: not installed by default — each test overrides as needed
  claudeIntegration.isInstalled.mockReturnValue(false)
  claudeIntegration.isHookInstalled.mockReturnValue(false)
  claudeIntegration.install.mockReset()
  claudeIntegration.isHookOutdated.mockReturnValue(false)
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
      mockPromptAnswers({ install: [false] })
      await makeProgram().parseAsync(['init'], { from: 'user' })
      expect(mockPrompts).toHaveBeenCalledWith(expect.objectContaining({ name: 'install', initial: false }))
    })

    it('installs hook and logs success when user opts in', async () => {
      claudeIntegration.isInstalled.mockReturnValue(true)
      claudeIntegration.isHookInstalled.mockReturnValue(false)
      mockPromptAnswers({ install: [true] })
      await makeProgram().parseAsync(['init'], { from: 'user' })
      expect(claudeIntegration.install).toHaveBeenCalledOnce()
      expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining('session hook installed'))
    })

    it("never says the hook is installed when its settings file couldn't be read", async () => {
      claudeIntegration.isInstalled.mockReturnValue(true)
      claudeIntegration.isHookInstalled.mockReturnValue(false)
      claudeIntegration.install.mockReturnValue('unreadable')
      mockPromptAnswers({ install: [true] })

      await makeProgram().parseAsync(['init'], { from: 'user' })

      expect(mockLog.success).not.toHaveBeenCalledWith(expect.stringContaining('session hook installed'))
      expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('~/.claude/settings.json'))
    })

    it('logs skipped and does not install when user declines', async () => {
      claudeIntegration.isInstalled.mockReturnValue(true)
      claudeIntegration.isHookInstalled.mockReturnValue(false)
      mockPromptAnswers({ install: [false] })
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
      mockPromptAnswers({ install: [true] })
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
      mockPromptAnswers({ install: [true, false] }) // Claude Code — yes, Aider — no
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
    for (const stepNumber of [1, 2, 3, 4, 5]) expect(allOutput).toContain(`[${stepNumber}/5]`)
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

describe('workscribe init — what to do next (AC-4)', () => {
  it('points to workscribe summary and the agent skill, never to an AI provider', async () => {
    await makeProgram().parseAsync(['init'], { from: 'user' })
    const allOutput = (mockLog.plain as ReturnType<typeof vi.fn>).mock.calls.flat().join('\n')
    expect(allOutput).toContain('workscribe summary')
    expect(allOutput).toContain('workscribe skill install')
    expect(allOutput).not.toMatch(/ai\.provider|API key/)
  })
})

describe('workscribe init — no AI provider step (2.0)', () => {
  it('never asks for a provider or an API key', async () => {
    await makeProgram().parseAsync(['init'], { from: 'user' })
    const promptNames = mockPrompts.mock.calls.map(([options]) => options.name)
    expect(promptNames).not.toContain('provider')
    expect(promptNames).not.toContain('apiKey')
    expect(promptNames).not.toContain('removeLegacyAi')
  })

  it('removes 1.x AI settings, including the API key, when the user agrees', async () => {
    mockReadConfig.mockReturnValue(legacyAiConfig())
    const { writeConfig } = await import('../../src/config')
    const mockWriteConfig = writeConfig as ReturnType<typeof vi.fn>

    await makeProgram().parseAsync(['init'], { from: 'user' })

    expect(mockPrompts).toHaveBeenCalledWith(expect.objectContaining({ name: 'removeLegacyAi', initial: true }))
    const [savedConfig] = mockWriteConfig.mock.calls[0]
    expect(savedConfig).not.toHaveProperty('ai')
    expect(mockLog.success).toHaveBeenCalledWith('Removed the old AI provider settings from your config')
  })

  it('keeps 1.x AI settings when the user says no', async () => {
    mockReadConfig.mockReturnValue(legacyAiConfig())
    mockPromptAnswers({ removeLegacyAi: [false] })
    const { writeConfig } = await import('../../src/config')
    const mockWriteConfig = writeConfig as ReturnType<typeof vi.fn>

    await makeProgram().parseAsync(['init'], { from: 'user' })

    for (const [savedConfig] of mockWriteConfig.mock.calls) expect(savedConfig).toHaveProperty('ai')
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('Kept the old AI settings'))
  })
})

describe('workscribe init — agent skill step', () => {
  const skillPrompts = () => mockPrompts.mock.calls.filter(([options]) => options.name === 'installSkill')

  beforeEach(() => {
    vi.mocked(detectAgents).mockReturnValue([agent('claude-code'), agent('codex'), agent('copilot')])
    vi.mocked(readInstallState).mockReturnValue({ kind: 'not-installed' })
    vi.mocked(installSkill).mockReturnValue('installed')
  })

  it('asks once per skills folder, defaulting to yes, and installs on yes', async () => {
    mockPromptAnswers({ installSkill: [true] })

    await makeProgram().parseAsync(['init'], { from: 'user' })

    expect(skillPrompts().map(([options]) => [options.message, options.initial])).toEqual([
      ['Install the Workscribe skill for Claude Code? Lets Claude Code summarize your work when you ask', true],
      [
        'Install the Workscribe skill for Codex and GitHub Copilot? Lets Codex and GitHub Copilot summarize your work when you ask',
        true,
      ],
    ])
    expect(installSkill).toHaveBeenCalledTimes(2)
  })

  it('installs nothing when the user says no', async () => {
    mockPromptAnswers({ installSkill: [false] })

    await makeProgram().parseAsync(['init'], { from: 'user' })

    expect(installSkill).not.toHaveBeenCalled()
    expect(mockLog.info).toHaveBeenCalledWith('Skill skipped for Claude Code — run workscribe skill install any time')
  })

  it('does not ask again when the skill is up to date, so re-running init never duplicates it', async () => {
    vi.mocked(readInstallState).mockReturnValue({ kind: 'installed', version: '0.0.0-test' })
    mockPromptAnswers({ installSkill: [true] })

    await makeProgram().parseAsync(['init'], { from: 'user' })

    expect(skillPrompts()).toHaveLength(0)
    expect(installSkill).not.toHaveBeenCalled()
  })

  it('offers an update for an outdated copy and leaves a folder it does not own alone', async () => {
    vi.mocked(readInstallState).mockImplementation((folder: string) =>
      folder.endsWith('.claude/skills') ? { kind: 'outdated', version: '1.9.0' } : { kind: 'not-ours' }
    )
    mockPromptAnswers({ installSkill: [true] })

    await makeProgram().parseAsync(['init'], { from: 'user' })

    expect(skillPrompts().map(([options]) => options.message)).toEqual([
      'Update the Workscribe skill for Claude Code? Lets Claude Code summarize your work when you ask',
    ])
    expect(installSkill).toHaveBeenCalledTimes(1)
  })

  it('warns and finishes setup when an install fails', async () => {
    mockPromptAnswers({ installSkill: [true] })
    vi.mocked(installSkill).mockImplementation(() => {
      throw new Error('EACCES: permission denied')
    })

    await makeProgram().parseAsync(['init'], { from: 'user' })

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("Couldn't install the Workscribe skill"))
    const allOutput = mockLog.plain.mock.calls.flat().join('\n')
    expect(allOutput).toContain('Setup complete!')
  })

  it('tells people, before anything is captured, that old data is removed, and how to keep it (WOR-179)', async () => {
    await makeProgram().parseAsync(['init'], { from: 'user' })

    const allOutput = mockLog.plain.mock.calls.flat().join('\n')
    expect(allOutput).toContain('Captured events are removed after 100 days')
    expect(allOutput).toContain('your summaries stay')
    expect(allOutput).toContain('workscribe config set retention.keepForever true')
  })

  it('says the limit the person has set, not the default', async () => {
    mockReadConfig.mockReturnValue(createTestConfig({ retention: { days: 30, keepForever: false, summaryDays: null } }))

    await makeProgram().parseAsync(['init'], { from: 'user' })

    expect(mockLog.plain.mock.calls.flat().join('\n')).toContain('Captured events are removed after 30 days')
  })

  it('warns and finishes setup when the skill files are missing from the install', async () => {
    vi.mocked(resolvePackagedSkillDir).mockImplementationOnce(() => {
      throw new Error('The Workscribe skill files are missing from this install.')
    })

    await makeProgram().parseAsync(['init'], { from: 'user' })

    expect(mockLog.warn).toHaveBeenCalledWith('The Workscribe skill files are missing from this install.')
    expect(skillPrompts()).toHaveLength(0)
    expect(mockLog.plain.mock.calls.flat().join('\n')).toContain('Setup complete!')
  })

  it('tells the user how to install later when no coding agents are detected', async () => {
    vi.mocked(detectAgents).mockReturnValue([])

    await makeProgram().parseAsync(['init'], { from: 'user' })

    expect(mockLog.info).toHaveBeenCalledWith(
      'No coding agents detected — run workscribe skill install after installing one'
    )
  })
})

describe('workscribe init — shell completions repair (WOR-120)', () => {
  beforeEach(() => {
    vi.mocked(isCompletionsOutdated).mockReturnValue(false)
  })

  it('refreshes the completion script without asking when completions are current', async () => {
    await makeProgram().parseAsync(['init'], { from: 'user' })

    expect(writeCompletionScript).toHaveBeenCalled()
    expect(mockPrompts).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'updateShellCompletions' }))
    expect(mockLog.info).toHaveBeenCalledWith('Shell completions already installed')
  })

  it('offers to update an older unguarded block, defaulting to yes, and updates it', async () => {
    vi.mocked(isCompletionsOutdated).mockReturnValue(true)

    await makeProgram().parseAsync(['init'], { from: 'user' })

    expect(mockPrompts).toHaveBeenCalledWith(expect.objectContaining({ name: 'updateShellCompletions', initial: true }))
    expect(updateCompletions).toHaveBeenCalled()
  })

  it('leaves the block alone when the user declines', async () => {
    vi.mocked(isCompletionsOutdated).mockReturnValue(true)
    mockPromptAnswers({ updateShellCompletions: [false] })

    await makeProgram().parseAsync(['init'], { from: 'user' })

    expect(updateCompletions).not.toHaveBeenCalled()
    expect(mockLog.info).toHaveBeenCalledWith('Shell completions update skipped')
  })
})

describe('workscribe init — outdated AI tool hook (WOR-120)', () => {
  beforeEach(() => {
    claudeIntegration.isInstalled.mockReturnValue(true)
    claudeIntegration.isHookInstalled.mockReturnValue(false)
    claudeIntegration.isHookOutdated.mockReturnValue(true)
  })

  it('offers to update an outdated hook, defaulting to yes, and updates it', async () => {
    await makeProgram().parseAsync(['init'], { from: 'user' })

    expect(mockPrompts).toHaveBeenCalledWith(expect.objectContaining({ name: 'updateAiHook', initial: true }))
    expect(mockPrompts).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'install' }))
    expect(claudeIntegration.install).toHaveBeenCalled()
    expect(mockLog.success).toHaveBeenCalledWith('Claude Code session hook updated')
  })

  it('keeps the hook as it is when the user declines', async () => {
    mockPromptAnswers({ updateAiHook: [false] })

    await makeProgram().parseAsync(['init'], { from: 'user' })

    expect(claudeIntegration.install).not.toHaveBeenCalled()
  })

  it('still asks the opt-in first-install question (default no) when there is no hook at all', async () => {
    claudeIntegration.isHookOutdated.mockReturnValue(false)

    await makeProgram().parseAsync(['init'], { from: 'user' })

    expect(mockPrompts).toHaveBeenCalledWith(expect.objectContaining({ name: 'install', initial: false }))
  })
})

describe('workscribe init — a leftover Chronicle hook (WOR-153)', () => {
  it('offers to remove it, defaulting to yes, and removes it', async () => {
    vi.mocked(hasChronicleHook).mockReturnValue(true)

    await makeProgram().parseAsync(['init'], { from: 'user' })

    expect(mockPrompts).toHaveBeenCalledWith(expect.objectContaining({ name: 'removeChronicle', initial: true }))
    expect(removeChronicleHook).toHaveBeenCalledWith(expect.stringMatching(/\.(zshrc|bashrc)$/))
  })

  it('leaves it when the user declines, and never asks when there is none', async () => {
    vi.mocked(hasChronicleHook).mockReturnValue(true)
    mockPromptAnswers({ removeChronicle: [false] })
    await makeProgram().parseAsync(['init'], { from: 'user' })
    expect(removeChronicleHook).not.toHaveBeenCalled()

    vi.mocked(hasChronicleHook).mockReturnValue(false)
    mockPrompts.mockClear()
    await makeProgram().parseAsync(['init'], { from: 'user' })
    expect(mockPrompts).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'removeChronicle' }))
  })
})
