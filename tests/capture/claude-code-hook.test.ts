import { describe, it, expect, vi } from 'vitest'

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}))

vi.mock('child_process', () => ({ execSync: vi.fn() }))

import fs from 'fs'
import { claudeCodeIntegration } from '../../src/capture/hooks/claude-code'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>

const SETTINGS_WITH_BOTH_HOOKS = JSON.stringify({
  hooks: {
    PostToolUse: [
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'workscribe _hook --source claude-code', async: true }],
      },
    ],
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: 'command',
            command: 'workscribe _hook --source claude-code --event UserPromptSubmit',
          },
        ],
      },
    ],
  },
})

const SETTINGS_WITH_POST_TOOL_ONLY = JSON.stringify({
  hooks: {
    PostToolUse: [
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'workscribe _hook --source claude-code', async: true }],
      },
    ],
  },
})

const SETTINGS_WITHOUT_HOOK = JSON.stringify({
  hooks: {
    PostToolUse: [
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: 'some-other-tool' }],
      },
    ],
  },
})

describe('claudeCodeIntegration.isHookInstalled', () => {
  it('returns false when settings file does not exist', () => {
    mockFs.existsSync.mockReturnValue(false)
    expect(claudeCodeIntegration.isHookInstalled()).toBe(false)
  })

  it('returns false when settings file has no hooks', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({}))
    expect(claudeCodeIntegration.isHookInstalled()).toBe(false)
  })

  it('returns false when PostToolUse hooks do not include workscribe', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(SETTINGS_WITHOUT_HOOK)
    expect(claudeCodeIntegration.isHookInstalled()).toBe(false)
  })

  it('returns false when only PostToolUse is present but UserPromptSubmit is missing', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(SETTINGS_WITH_POST_TOOL_ONLY)
    expect(claudeCodeIntegration.isHookInstalled()).toBe(false)
  })

  it('returns true when both PostToolUse and UserPromptSubmit workscribe hooks are present', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(SETTINGS_WITH_BOTH_HOOKS)
    expect(claudeCodeIntegration.isHookInstalled()).toBe(true)
  })

  it('returns false when settings file contains invalid JSON', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('not-json')
    expect(claudeCodeIntegration.isHookInstalled()).toBe(false)
  })
})

describe('claudeCodeIntegration.install', () => {
  it('creates settings file when none exists', () => {
    mockFs.existsSync.mockReturnValue(false)
    claudeCodeIntegration.install()
    expect(mockFs.writeFileSync).toHaveBeenCalledOnce()
    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
    expect(written.hooks.PostToolUse).toHaveLength(1)
    expect(written.hooks.PostToolUse[0].hooks[0].command).toBe('workscribe _hook --source claude-code')
  })

  it('adds UserPromptSubmit hook for secret detection', () => {
    mockFs.existsSync.mockReturnValue(false)
    claudeCodeIntegration.install()
    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
    expect(written.hooks.UserPromptSubmit).toHaveLength(1)
    expect(written.hooks.UserPromptSubmit[0].hooks[0].command).toBe(
      'workscribe _hook --source claude-code --event UserPromptSubmit'
    )
  })

  it('merges with existing PostToolUse hooks without overwriting them', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(SETTINGS_WITHOUT_HOOK)
    claudeCodeIntegration.install()
    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
    expect(written.hooks.PostToolUse).toHaveLength(2)
    const commands = written.hooks.PostToolUse.flatMap((e: { hooks: { command: string }[] }) =>
      e.hooks.map((hook) => hook.command)
    )
    expect(commands).toContain('some-other-tool')
    expect(commands).toContain('workscribe _hook --source claude-code')
  })

  it('preserves other hook types (Stop, PreToolUse) when installing', () => {
    const existingSettings = JSON.stringify({
      hooks: {
        Stop: [{ matcher: '', hooks: [{ type: 'command', command: 'echo done' }] }],
        PostToolUse: [],
      },
    })
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(existingSettings)
    claudeCodeIntegration.install()
    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
    expect(written.hooks.Stop).toBeDefined()
    expect(written.hooks.Stop[0].hooks[0].command).toBe('echo done')
  })

  it('sets async: true on the PostToolUse hook', () => {
    mockFs.existsSync.mockReturnValue(false)
    claudeCodeIntegration.install()
    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
    expect(written.hooks.PostToolUse[0].hooks[0].async).toBe(true)
  })

  it('sets Bash as the matcher', () => {
    mockFs.existsSync.mockReturnValue(false)
    claudeCodeIntegration.install()
    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
    expect(written.hooks.PostToolUse[0].matcher).toBe('Bash')
  })
})
