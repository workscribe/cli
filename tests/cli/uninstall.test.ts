import { describe, it, expect, vi, onTestFinished } from 'vitest'

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    rmSync: vi.fn(),
  },
}))

vi.mock('prompts', () => ({ default: vi.fn() }))

vi.mock('../../src/utils/paths', () => ({
  WORKSCRIBE_DIR: '/home/user/.workscribe',
  REQUIRED_DIRS: ['/home/user/.workscribe'],
}))

vi.mock('../../src/capture/shell-hook', () => ({
  isHookInstalled: vi.fn(),
  removeHook: vi.fn(),
  removeCompletions: vi.fn(() => false),
  removeFishCompletions: vi.fn(() => false),
  removeChronicleHook: vi.fn(() => false),
}))

// Mocked whole: the real module imports child_process and reads ~/.claude/settings.json
vi.mock('../../src/capture/hooks/claude-code', () => ({
  claudeCodeIntegration: { isInstalled: vi.fn(() => false), uninstall: vi.fn(() => 'not-installed') },
}))

// fs is mocked above, so the skill installer is too — tests/skills/installer.test.ts covers the real one
vi.mock('../../src/skills/installer', () => ({
  uninstallSkill: vi.fn().mockReturnValue('not-installed'),
  readInstallState: vi.fn(),
  installSkill: vi.fn(),
}))

import fs from 'fs'
import prompts from 'prompts'
import os from 'os'
import { uninstallSkill } from '../../src/skills/installer'
import { log } from '../../src/utils/logger'
import {
  isHookInstalled,
  removeChronicleHook,
  removeHook,
  removeCompletions,
  removeFishCompletions,
} from '../../src/capture/shell-hook'
import { claudeCodeIntegration } from '../../src/capture/hooks/claude-code'
import { Command } from 'commander'
import { registerUninstall } from '../../src/cli/uninstall'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockPrompts = prompts as ReturnType<typeof vi.fn>
const mockIsHookInstalled = isHookInstalled as ReturnType<typeof vi.fn>
const mockRemoveHook = removeHook as ReturnType<typeof vi.fn>

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerUninstall(program)
  return program
}

describe('workscribe uninstall', () => {
  describe('shell hook removal', () => {
    it('reports no hooks found when none are installed', async () => {
      mockFs.existsSync.mockReturnValue(false)
      mockIsHookInstalled.mockReturnValue(false)
      mockPrompts.mockResolvedValue({ deleteData: false })

      await makeProgram().parseAsync(['uninstall'], { from: 'user' })

      expect(mockRemoveHook).not.toHaveBeenCalled()
    })

    it('calls removeHook for each rc file that has the hook installed', async () => {
      // existsSync: rc files exist, WORKSCRIBE_DIR does not
      mockFs.existsSync.mockImplementation((p: string) => {
        if (p.endsWith('.zshrc') || p.endsWith('.bashrc') || p.endsWith('.bash_profile')) return true
        return false
      })
      mockIsHookInstalled.mockReturnValue(true)
      mockPrompts.mockResolvedValue({ deleteData: false })

      await makeProgram().parseAsync(['uninstall'], { from: 'user' })

      expect(mockRemoveHook).toHaveBeenCalled()
    })

    it('only removes hooks from files that have them installed', async () => {
      mockFs.existsSync.mockImplementation((p: string) => p.endsWith('.zshrc'))
      mockIsHookInstalled.mockImplementation((p: string) => p.endsWith('.zshrc'))
      mockPrompts.mockResolvedValue({ deleteData: false })

      await makeProgram().parseAsync(['uninstall'], { from: 'user' })

      expect(mockRemoveHook).toHaveBeenCalledTimes(1)
      expect(mockRemoveHook).toHaveBeenCalledWith(expect.stringContaining('.zshrc'))
    })
  })

  describe('data directory', () => {
    it('prompts to delete data when ~/.workscribe exists', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockIsHookInstalled.mockReturnValue(false)
      mockPrompts.mockResolvedValue({ deleteData: false })

      await makeProgram().parseAsync(['uninstall'], { from: 'user' })

      expect(mockPrompts).toHaveBeenCalledWith(expect.objectContaining({ name: 'deleteData' }))
    })

    it('deletes the data directory when user confirms', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockIsHookInstalled.mockReturnValue(false)
      mockPrompts.mockResolvedValue({ deleteData: true })

      await makeProgram().parseAsync(['uninstall'], { from: 'user' })

      expect(mockFs.rmSync).toHaveBeenCalledWith('/home/user/.workscribe', { recursive: true, force: true })
    })

    it('keeps the data directory when user declines', async () => {
      mockFs.existsSync.mockReturnValue(true)
      mockIsHookInstalled.mockReturnValue(false)
      mockPrompts.mockResolvedValue({ deleteData: false })

      await makeProgram().parseAsync(['uninstall'], { from: 'user' })

      expect(mockFs.rmSync).not.toHaveBeenCalled()
    })

    it('does not prompt when ~/.workscribe does not exist', async () => {
      mockFs.existsSync.mockReturnValue(false)
      mockIsHookInstalled.mockReturnValue(false)

      await makeProgram().parseAsync(['uninstall'], { from: 'user' })

      expect(mockPrompts).not.toHaveBeenCalled()
    })
  })
})

describe('workscribe uninstall — agent skills', () => {
  const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

  function prepare() {
    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue('/Users/dev')
    onTestFinished(() => homeSpy.mockRestore())
    mockFs.existsSync.mockReturnValue(false)
    mockIsHookInstalled.mockReturnValue(false)
    mockPrompts.mockResolvedValue({ deleteData: false })
  }

  it('removes Workscribe-installed skills from every skills folder on a full uninstall', async () => {
    prepare()
    vi.mocked(uninstallSkill).mockImplementation((folder: string) =>
      folder.endsWith('.claude/skills') ? 'removed' : 'not-installed'
    )

    await makeProgram().parseAsync(['uninstall'], { from: 'user' })

    expect(vi.mocked(uninstallSkill).mock.calls.map(([folder]) => folder)).toEqual([
      '/Users/dev/.claude/skills',
      '/Users/dev/.agents/skills',
      '/Users/dev/.cursor/skills',
    ])
    expect(mockLog.success).toHaveBeenCalledWith(
      'Removed the Workscribe skill from Claude Code (~/.claude/skills/workscribe)'
    )
    // folders that never had the skill stay quiet
    expect(mockLog.info).not.toHaveBeenCalledWith(expect.stringContaining("isn't installed"))
  })

  it('warns and still offers to delete data when a skill cannot be removed', async () => {
    prepare()
    mockFs.existsSync.mockReturnValue(true)
    vi.mocked(uninstallSkill).mockImplementation(() => {
      throw new Error('EPERM: operation not permitted')
    })

    await makeProgram().parseAsync(['uninstall'], { from: 'user' })

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining("Couldn't remove the Workscribe skill"))
    expect(mockPrompts).toHaveBeenCalledWith(expect.objectContaining({ name: 'deleteData' }))
  })

  it('never removes skills with --hooks-only, which npm can run during an upgrade', async () => {
    prepare()

    await makeProgram().parseAsync(['uninstall', '--hooks-only'], { from: 'user' })

    expect(uninstallSkill).not.toHaveBeenCalled()
  })
})

describe('workscribe uninstall — completions and the Claude Code hook (WOR-120)', () => {
  const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

  function prepare() {
    const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue('/Users/dev')
    onTestFinished(() => homeSpy.mockRestore())
    mockFs.existsSync.mockReturnValue(false)
    mockIsHookInstalled.mockReturnValue(false)
    mockPrompts.mockResolvedValue({ deleteData: false })
    vi.mocked(removeCompletions).mockReturnValue(false)
    vi.mocked(claudeCodeIntegration.uninstall!).mockReturnValue('not-installed')
  }

  it('removes a leftover Chronicle hook from the rc files 0.2.1 wrote it to', async () => {
    prepare()
    vi.mocked(removeChronicleHook).mockImplementation((rcFile: string) => rcFile.endsWith('.zshrc'))

    await makeProgram().parseAsync(['uninstall'], { from: 'user' })

    expect(vi.mocked(removeChronicleHook).mock.calls.map(([rcFile]) => rcFile)).toEqual([
      '/Users/dev/.zshrc',
      '/Users/dev/.bashrc',
    ])
    expect(mockLog.success).toHaveBeenCalledWith('Old Chronicle hook removed from /Users/dev/.zshrc')
  })

  it('removes the completions block from every rc file that has one, even without the shell hook', async () => {
    prepare()
    vi.mocked(removeCompletions).mockImplementation((rcFile: string) => rcFile.endsWith('.bashrc'))

    await makeProgram().parseAsync(['uninstall'], { from: 'user' })

    expect(vi.mocked(removeCompletions).mock.calls.map(([rcFile]) => rcFile)).toEqual([
      '/Users/dev/.zshrc',
      '/Users/dev/.bashrc',
      '/Users/dev/.bash_profile',
    ])
    expect(mockLog.success).toHaveBeenCalledWith('Shell completions removed from /Users/dev/.bashrc')
    expect(removeFishCompletions).toHaveBeenCalled()
  })

  it('removes the Claude Code hook even when Claude Code is no longer on PATH', async () => {
    prepare()
    vi.mocked(claudeCodeIntegration.uninstall!).mockReturnValue('removed')

    await makeProgram().parseAsync(['uninstall'], { from: 'user' })

    expect(claudeCodeIntegration.uninstall).toHaveBeenCalled()
    expect(claudeCodeIntegration.isInstalled).not.toHaveBeenCalled()
    expect(mockLog.success).toHaveBeenCalledWith('Claude Code session hook removed from ~/.claude/settings.json')
  })

  it('warns, with what to do, when settings.json cannot be read', async () => {
    prepare()
    vi.mocked(claudeCodeIntegration.uninstall!).mockReturnValue('unreadable')

    await makeProgram().parseAsync(['uninstall'], { from: 'user' })

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('workscribe uninstall --hooks-only'))
  })

  it('removes completions and the Claude Code hook with --hooks-only too', async () => {
    prepare()

    await makeProgram().parseAsync(['uninstall', '--hooks-only'], { from: 'user' })

    expect(removeCompletions).toHaveBeenCalledTimes(3)
    expect(claudeCodeIntegration.uninstall).toHaveBeenCalled()
  })
})
