import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest'

vi.mock('../../src/skills/detect', () => ({ detectAgents: vi.fn() }))
vi.mock('../../src/skills/installer', () => ({
  installSkill: vi.fn(),
  readInstallState: vi.fn(),
  uninstallSkill: vi.fn(),
}))
vi.mock('../../src/skills/package-path', () => ({ resolvePackagedSkillDir: vi.fn(() => '/pkg/skills/workscribe') }))

import os from 'os'
import { Command } from 'commander'
import { detectAgents } from '../../src/skills/detect'
import { installSkill, readInstallState, uninstallSkill } from '../../src/skills/installer'
import { resolvePackagedSkillDir } from '../../src/skills/package-path'
import { skillAgent as agent } from '../helpers/skill-agents'
import { log } from '../../src/utils/logger'
import { registerSkill } from '../../src/cli/skill'

const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

function run(...args: string[]) {
  const program = new Command()
  program.exitOverride()
  registerSkill(program)
  return program.parseAsync(['skill', ...args], { from: 'user' })
}

function stubExit() {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('exit')
  }) as never)
  onTestFinished(() => exitSpy.mockRestore())
}

beforeEach(() => {
  const homeSpy = vi.spyOn(os, 'homedir').mockReturnValue('/Users/dev')
  onTestFinished(() => homeSpy.mockRestore())
  vi.mocked(detectAgents).mockReturnValue([agent('claude-code'), agent('codex'), agent('copilot')])
  vi.mocked(installSkill).mockReturnValue('installed')
  vi.mocked(uninstallSkill).mockReturnValue('removed')
  vi.mocked(readInstallState).mockReturnValue({ kind: 'installed', version: '0.0.0-test' })
})

describe('workscribe skill install', () => {
  it('installs once per skills folder, sharing ~/.agents/skills between Codex and Copilot', async () => {
    await run('install')

    expect(installSkill).toHaveBeenCalledTimes(2)
    expect(installSkill).toHaveBeenCalledWith({
      sourceDir: '/pkg/skills/workscribe',
      skillsFolder: '/Users/dev/.claude/skills',
      version: '0.0.0-test',
      force: undefined,
    })
    expect(installSkill).toHaveBeenCalledWith(expect.objectContaining({ skillsFolder: '/Users/dev/.agents/skills' }))
    expect(mockLog.success).toHaveBeenCalledWith(
      'Installed the Workscribe skill for Codex and GitHub Copilot (~/.agents/skills/workscribe)'
    )
  })

  it('only installs for the agents named with --agent, even if not detected', async () => {
    await run('install', '--agent', 'cursor')

    expect(installSkill).toHaveBeenCalledTimes(1)
    expect(installSkill).toHaveBeenCalledWith(expect.objectContaining({ skillsFolder: '/Users/dev/.cursor/skills' }))
  })

  it('passes --force through and explains a skipped folder', async () => {
    vi.mocked(installSkill).mockReturnValue('skipped-not-ours')

    await run('install', '--agent', 'claude-code')

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('workscribe skill install --force'))

    await run('install', '--agent', 'claude-code', '--force')
    expect(installSkill).toHaveBeenLastCalledWith(expect.objectContaining({ force: true }))
  })

  it('rejects an unknown agent and lists the valid ones', async () => {
    stubExit()

    await expect(run('install', '--agent', 'vim')).rejects.toThrow('exit')

    expect(mockLog.error).toHaveBeenCalledWith(
      'Unknown agent: vim. Choose from: claude-code, codex, copilot, cursor. For example: workscribe skill install --agent claude-code'
    )
    expect(installSkill).not.toHaveBeenCalled()
  })

  it('says which agents are supported when none are detected', async () => {
    vi.mocked(detectAgents).mockReturnValue([])

    await run('install')

    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('workscribe skill install --agent claude-code'))
    expect(installSkill).not.toHaveBeenCalled()
  })

  it('explains a broken install when the packaged skill is missing', async () => {
    vi.mocked(resolvePackagedSkillDir).mockImplementationOnce(() => {
      throw new Error('The Workscribe skill files are missing from this install.')
    })
    stubExit()

    await expect(run('install')).rejects.toThrow('exit')

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('missing from this install'))
  })

  it('warns and carries on with the next folder when one install fails', async () => {
    vi.mocked(installSkill).mockImplementationOnce(() => {
      throw new Error('EACCES: permission denied')
    })

    await run('install')

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('(EACCES: permission denied)'))
    expect(installSkill).toHaveBeenCalledTimes(2)
  })
})

describe('workscribe skill status', () => {
  it('shows every supported agent, with the state and fix for detected ones', async () => {
    vi.mocked(readInstallState).mockImplementation((folder: string) =>
      folder.endsWith('.claude/skills') ? { kind: 'outdated', version: '1.9.0' } : { kind: 'not-installed' }
    )

    await run('status')

    const output = mockLog.plain.mock.calls.map(([line]) => String(line)).join('\n')
    expect(output).toContain('outdated (1.9.0; this CLI is 0.0.0-test) — run workscribe skill install')
    expect(output).toContain('not installed — run workscribe skill install')
    expect(output).toMatch(/Cursor\s+not detected/)
  })
})

describe('workscribe skill uninstall', () => {
  it('removes from every skills folder by default and reports each', async () => {
    await run('uninstall')

    expect(uninstallSkill).toHaveBeenCalledTimes(3)
    expect(mockLog.success).toHaveBeenCalledWith(
      'Removed the Workscribe skill from Claude Code (~/.claude/skills/workscribe)'
    )
  })

  it('leaves a skill Workscribe did not install alone', async () => {
    vi.mocked(uninstallSkill).mockReturnValue('skipped-not-ours')

    await run('uninstall', '--agent', 'cursor')

    expect(mockLog.warn).toHaveBeenCalledWith(
      "Left ~/.cursor/skills/workscribe alone — that workscribe skill wasn't installed by Workscribe."
    )
  })
})

describe('workscribe skill — shared skills folder', () => {
  it('says Copilot is affected too when only Codex is named', async () => {
    await run('uninstall', '--agent', 'codex')

    expect(mockLog.success).toHaveBeenCalledWith(
      'Removed the Workscribe skill from Codex (folder shared with GitHub Copilot) (~/.agents/skills/workscribe)'
    )
  })

  it('warns and carries on when a folder cannot be removed', async () => {
    vi.mocked(uninstallSkill).mockImplementationOnce(() => {
      throw new Error('EPERM: operation not permitted')
    })

    await run('uninstall')

    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('rm -rf ~/.claude/skills/workscribe'))
    expect(uninstallSkill).toHaveBeenCalledTimes(3)
  })
})
