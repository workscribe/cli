import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
  },
}))

vi.mock('child_process', () => ({ execSync: vi.fn(), execFileSync: vi.fn() }))

import fs from 'fs'
import { execFileSync } from 'child_process'
import { claudeCodeIntegration, checkHookHealth } from '../../src/capture/hooks/claude-code'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockExecFileSync = execFileSync as unknown as ReturnType<typeof vi.fn>

const RESOLVED_BIN = '/usr/local/bin/workscribe'
const PINNED_PREFIX = `"${process.execPath}" "${RESOLVED_BIN}"`

const SETTINGS_WITH_BOTH_BARE_HOOKS = JSON.stringify({
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

const SETTINGS_WITH_BOTH_PINNED_HOOKS = JSON.stringify({
  hooks: {
    PostToolUse: [
      {
        matcher: 'Bash',
        hooks: [{ type: 'command', command: `${PINNED_PREFIX} _hook --source claude-code`, async: true }],
      },
    ],
    UserPromptSubmit: [
      {
        hooks: [
          {
            type: 'command',
            command: `${PINNED_PREFIX} _hook --source claude-code --event UserPromptSubmit`,
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

beforeEach(() => {
  // which workscribe resolves successfully by default — tests that need the
  // fallback (resolution fails) override this explicitly.
  mockExecFileSync.mockReturnValue(`${RESOLVED_BIN}\n`)
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

  it('returns false when both events are present but the commands are bare (unpinned) — not safely installed', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(SETTINGS_WITH_BOTH_BARE_HOOKS)
    expect(claudeCodeIntegration.isHookInstalled()).toBe(false)
  })

  it('returns true when both PostToolUse and UserPromptSubmit commands are present and pinned', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(SETTINGS_WITH_BOTH_PINNED_HOOKS)
    expect(claudeCodeIntegration.isHookInstalled()).toBe(true)
  })

  it('returns false when settings file contains invalid JSON', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('not-json')
    expect(claudeCodeIntegration.isHookInstalled()).toBe(false)
  })
})

describe('claudeCodeIntegration.install', () => {
  it('creates settings file when none exists, pinning node and binary path', () => {
    mockFs.existsSync.mockReturnValue(false)
    claudeCodeIntegration.install()
    expect(mockFs.writeFileSync).toHaveBeenCalledOnce()
    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
    expect(written.hooks.PostToolUse).toHaveLength(1)
    expect(written.hooks.PostToolUse[0].hooks[0].command).toBe(`${PINNED_PREFIX} _hook --source claude-code`)
  })

  it('adds a pinned UserPromptSubmit hook for secret detection', () => {
    mockFs.existsSync.mockReturnValue(false)
    claudeCodeIntegration.install()
    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
    expect(written.hooks.UserPromptSubmit).toHaveLength(1)
    expect(written.hooks.UserPromptSubmit[0].hooks[0].command).toBe(
      `${PINNED_PREFIX} _hook --source claude-code --event UserPromptSubmit`
    )
  })

  it('falls back to a bare command when the workscribe binary cannot be resolved', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found')
    })
    mockFs.existsSync.mockReturnValue(false)
    claudeCodeIntegration.install()
    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
    expect(written.hooks.PostToolUse[0].hooks[0].command).toBe('workscribe _hook --source claude-code')
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
    expect(commands).toContain(`${PINNED_PREFIX} _hook --source claude-code`)
  })

  it('replaces an existing bare workscribe entry with the pinned one, rather than duplicating it', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(SETTINGS_WITH_BOTH_BARE_HOOKS)
    claudeCodeIntegration.install()
    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
    const postToolUseCommands = written.hooks.PostToolUse.flatMap((e: { hooks: { command: string }[] }) =>
      e.hooks.map((hook) => hook.command)
    )
    expect(postToolUseCommands).toEqual([`${PINNED_PREFIX} _hook --source claude-code`])
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

describe('checkHookHealth', () => {
  it('reports not installed when no hook is present', () => {
    mockFs.existsSync.mockReturnValue(false)
    expect(checkHookHealth()).toEqual({ installed: false, pinned: true, confirmedBroken: null })
  })

  it('reports installed and pinned, with no live probe, when commands are already pinned', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(SETTINGS_WITH_BOTH_PINNED_HOOKS)
    expect(checkHookHealth()).toEqual({ installed: true, pinned: true, confirmedBroken: null })
    // Pinned commands are trusted without a live probe.
    expect(mockExecFileSync).not.toHaveBeenCalledWith('workscribe', ['--version'], expect.anything())
  })

  it('reports confirmedBroken: false when a bare command is present but currently invokable', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(SETTINGS_WITH_BOTH_BARE_HOOKS)
    mockExecFileSync.mockImplementation((command: string) => {
      if (command === 'workscribe') return ''
      return `${RESOLVED_BIN}\n`
    })
    expect(checkHookHealth()).toEqual({ installed: true, pinned: false, confirmedBroken: false })
  })

  it('reports confirmedBroken: true when a bare command is present and currently fails', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(SETTINGS_WITH_BOTH_BARE_HOOKS)
    mockExecFileSync.mockImplementation((command: string) => {
      if (command === 'workscribe') throw new Error('ERR_UNKNOWN_BUILTIN_MODULE')
      return `${RESOLVED_BIN}\n`
    })
    expect(checkHookHealth()).toEqual({ installed: true, pinned: false, confirmedBroken: true })
  })
})
