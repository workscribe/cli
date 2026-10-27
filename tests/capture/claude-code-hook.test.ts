import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    copyFileSync: vi.fn(),
    accessSync: vi.fn(),
    constants: { X_OK: 1, COPYFILE_EXCL: 1 },
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
// What 2.0.1+ writes: does nothing, silently, if node or the binary is gone
const guarded = (args: string) =>
  `test -x "${process.execPath}" && test -x "${RESOLVED_BIN}" && ${PINNED_PREFIX} ${args} || true`

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

// Pinned but unguarded — what Workscribe ≤ 2.0.0 wrote
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

const SETTINGS_WITH_BOTH_CURRENT_HOOKS = JSON.stringify({
  hooks: {
    PostToolUse: [
      { matcher: 'Bash', hooks: [{ type: 'command', command: guarded('_hook --source claude-code'), async: true }] },
    ],
    UserPromptSubmit: [
      { hooks: [{ type: 'command', command: guarded('_hook --source claude-code --event UserPromptSubmit') }] },
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
  // Pinned paths are executable unless a test says otherwise
  mockFs.accessSync.mockImplementation(() => undefined)
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

  it('returns true when both PostToolUse and UserPromptSubmit commands are present, pinned and guarded', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(SETTINGS_WITH_BOTH_CURRENT_HOOKS)
    expect(claudeCodeIntegration.isHookInstalled()).toBe(true)
  })

  it('returns false for pinned but unguarded commands from Workscribe ≤ 2.0.0, so init offers to update them', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(SETTINGS_WITH_BOTH_PINNED_HOOKS)
    expect(claudeCodeIntegration.isHookInstalled()).toBe(false)
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
    expect(written.hooks.PostToolUse[0].hooks[0].command).toBe(guarded('_hook --source claude-code'))
  })

  it('adds a pinned UserPromptSubmit hook for secret detection', () => {
    mockFs.existsSync.mockReturnValue(false)
    claudeCodeIntegration.install()
    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
    expect(written.hooks.UserPromptSubmit).toHaveLength(1)
    expect(written.hooks.UserPromptSubmit[0].hooks[0].command).toBe(
      guarded('_hook --source claude-code --event UserPromptSubmit')
    )
  })

  it('falls back to a bare command when the workscribe binary cannot be resolved', () => {
    mockExecFileSync.mockImplementation(() => {
      throw new Error('not found')
    })
    mockFs.existsSync.mockReturnValue(false)
    claudeCodeIntegration.install()
    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
    expect(written.hooks.PostToolUse[0].hooks[0].command).toBe(
      'command -v workscribe >/dev/null 2>&1 && workscribe _hook --source claude-code || true'
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
    expect(commands).toContain(guarded('_hook --source claude-code'))
  })

  it('replaces an existing bare workscribe entry with the pinned one, rather than duplicating it', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(SETTINGS_WITH_BOTH_BARE_HOOKS)
    claudeCodeIntegration.install()
    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
    const postToolUseCommands = written.hooks.PostToolUse.flatMap((e: { hooks: { command: string }[] }) =>
      e.hooks.map((hook) => hook.command)
    )
    expect(postToolUseCommands).toEqual([guarded('_hook --source claude-code')])
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
    expect(checkHookHealth()).toEqual({
      installed: false,
      pinned: true,
      guarded: true,
      nodeMissing: false,
      confirmedBroken: null,
    })
  })

  it('reports installed and pinned, with no live probe, when commands are already pinned', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(SETTINGS_WITH_BOTH_PINNED_HOOKS)
    expect(checkHookHealth()).toEqual({
      installed: true,
      pinned: true,
      guarded: false,
      nodeMissing: false,
      confirmedBroken: null,
    })
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
    expect(checkHookHealth()).toMatchObject({ installed: true, pinned: false, guarded: false, confirmedBroken: false })
  })

  it('reports confirmedBroken: true when a bare command is present and currently fails', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(SETTINGS_WITH_BOTH_BARE_HOOKS)
    mockExecFileSync.mockImplementation((command: string) => {
      if (command === 'workscribe') throw new Error('ERR_UNKNOWN_BUILTIN_MODULE')
      return `${RESOLVED_BIN}\n`
    })
    expect(checkHookHealth()).toMatchObject({ installed: true, pinned: false, guarded: false, confirmedBroken: true })
  })
})

describe('checkHookHealth — guarded hooks (WOR-120)', () => {
  it('reports a current hook as pinned and guarded', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(SETTINGS_WITH_BOTH_CURRENT_HOOKS)
    expect(checkHookHealth()).toMatchObject({ installed: true, pinned: true, guarded: true, nodeMissing: false })
  })

  it('reports when the pinned Node.js is gone — the guard keeps the hook quiet, so status has to say it', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(SETTINGS_WITH_BOTH_CURRENT_HOOKS)
    mockFs.accessSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    expect(checkHookHealth()).toMatchObject({ pinned: true, nodeMissing: true })
  })
})

describe('claudeCodeIntegration.isHookOutdated', () => {
  it.each([
    ['pinned but unguarded hooks from ≤ 2.0.0', SETTINGS_WITH_BOTH_PINNED_HOOKS, true],
    ['bare hooks', SETTINGS_WITH_BOTH_BARE_HOOKS, true],
    ['a half-installed hook (PostToolUse only)', SETTINGS_WITH_POST_TOOL_ONLY, true],
    ['current hooks', SETTINGS_WITH_BOTH_CURRENT_HOOKS, false],
    ['no workscribe hook at all', SETTINGS_WITHOUT_HOOK, false],
  ])('%s → %s', (_name, settings, expected) => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(settings)
    expect(claudeCodeIntegration.isHookOutdated?.()).toBe(expected)
  })
})

describe('a current hook pinned to a Node.js that has since been removed', () => {
  it('is outdated, not installed — so init offers to repair it instead of saying "already installed"', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(SETTINGS_WITH_BOTH_CURRENT_HOOKS)
    mockFs.accessSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    expect(claudeCodeIntegration.isHookInstalled()).toBe(false)
    expect(claudeCodeIntegration.isHookOutdated?.()).toBe(true)
  })
})

describe('claudeCodeIntegration.uninstall', () => {
  const written = () => JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)

  it("removes only Workscribe's entries, keeps other hooks and settings, and backs up first", () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify({
        model: 'opus',
        hooks: {
          ...JSON.parse(SETTINGS_WITH_BOTH_CURRENT_HOOKS).hooks,
          Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }],
        },
      })
    )

    expect(claudeCodeIntegration.uninstall?.()).toBe('removed')

    expect(mockFs.copyFileSync).toHaveBeenCalledWith(
      expect.stringContaining('settings.json'),
      expect.stringContaining('.workscribe-backup-'),
      1
    )
    expect(written()).toEqual({
      model: 'opus',
      hooks: { Stop: [{ hooks: [{ type: 'command', command: 'echo done' }] }] },
    })
  })

  it('drops empty event arrays and an emptied hooks key', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ model: 'opus', ...JSON.parse(SETTINGS_WITH_BOTH_BARE_HOOKS) }))

    expect(claudeCodeIntegration.uninstall?.()).toBe('removed')

    expect(written()).toEqual({ model: 'opus' })
  })

  it('does not write when there is nothing of Workscribe to remove', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(SETTINGS_WITHOUT_HOOK)

    expect(claudeCodeIntegration.uninstall?.()).toBe('not-installed')
    expect(mockFs.writeFileSync).not.toHaveBeenCalled()
  })

  it('leaves an unparseable settings.json untouched rather than overwriting it', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('{ "hooks": { oops')

    expect(claudeCodeIntegration.uninstall?.()).toBe('unreadable')
    expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    expect(mockFs.copyFileSync).not.toHaveBeenCalled()
  })

  it('has nothing to do when there is no settings.json', () => {
    mockFs.existsSync.mockReturnValue(false)
    expect(claudeCodeIntegration.uninstall?.()).toBe('not-installed')
  })
})
