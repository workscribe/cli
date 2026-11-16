import fs from 'fs'
import path from 'path'
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

const home = vi.hoisted(() => ({ dir: '' }))
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  const realFs = await vi.importActual<typeof import('fs')>('fs')
  home.dir = realFs.mkdtempSync(`${actual.tmpdir()}/workscribe-agy-`)
  return { ...actual, default: { ...actual, homedir: () => home.dir } }
})
vi.mock('../../src/capture/shell-hook', () => ({ resolveWorkscribeBinary: () => '/usr/local/bin/workscribe' }))
vi.mock('child_process', () => ({ execSync: vi.fn(), execFileSync: vi.fn() }))

import { antigravityIntegration } from '../../src/capture/hooks/antigravity'

const HOOKS_FILE = () => path.join(home.dir, '.gemini', 'config', 'hooks.json')
const readHooks = () => JSON.parse(fs.readFileSync(HOOKS_FILE(), 'utf8'))
const writeHooks = (value: unknown) => {
  fs.mkdirSync(path.dirname(HOOKS_FILE()), { recursive: true })
  fs.writeFileSync(HOOKS_FILE(), typeof value === 'string' ? value : JSON.stringify(value))
}
const OTHER_HOOK = {
  'lint-checker': {
    PostToolUse: [{ matcher: 'run_command', hooks: [{ type: 'command', command: './scripts/lint.sh', timeout: 10 }] }],
  },
  reminder: { enabled: false, PreInvocation: [{ type: 'command', command: './scripts/reminder.sh' }] },
}
const WATCHED = ['run_command', 'edit_file', 'write_file']

beforeEach(() => {
  fs.rmSync(path.join(home.dir, '.gemini'), { recursive: true, force: true })
})

afterAll(() => {
  fs.rmSync(home.dir, { recursive: true, force: true })
})

describe('antigravityIntegration.install', () => {
  it('creates the hooks file with one PostToolUse group per watched tool, each guarded, pinned and with a timeout', () => {
    expect(antigravityIntegration.install()).toBe('installed')

    const groups = readHooks().workscribe.PostToolUse
    expect(groups.map((group: { matcher: string }) => group.matcher)).toEqual(WATCHED)
    for (const group of groups) {
      expect(group.hooks).toEqual([
        expect.objectContaining({
          type: 'command',
          timeout: 10,
          command: expect.stringMatching(/^test -x .* && .*_hook --source antigravity \|\| true$/),
        }),
      ])
    }
  })

  it('keeps every other hook and field, and is idempotent', () => {
    writeHooks({ ...OTHER_HOOK, someSetting: true })

    antigravityIntegration.install()
    const once = readHooks()
    antigravityIntegration.install()

    expect(readHooks()).toEqual(once)
    expect(once['lint-checker']).toEqual(OTHER_HOOK['lint-checker'])
    expect(once.reminder).toEqual(OTHER_HOOK.reminder)
    expect(once.someSetting).toBe(true)
  })

  it('adds to a hook the user already named workscribe, without touching their handlers', () => {
    const theirs = { matcher: 'run_command', hooks: [{ type: 'command', command: './mine.sh' }] }
    writeHooks({ workscribe: { enabled: true, PostToolUse: [theirs] } })

    antigravityIntegration.install()

    const hook = readHooks().workscribe
    expect(hook.enabled).toBe(true)
    expect(hook.PostToolUse[0]).toEqual(theirs)
    expect(hook.PostToolUse).toHaveLength(1 + WATCHED.length)
  })

  it('refuses a file it cannot parse, and leaves it as it was', () => {
    writeHooks('{ not json')

    expect(antigravityIntegration.install()).toBe('unreadable')
    expect(fs.readFileSync(HOOKS_FILE(), 'utf8')).toBe('{ not json')
  })

  it('backs up the file it replaces', () => {
    writeHooks(OTHER_HOOK)

    antigravityIntegration.install()

    const backups = fs.readdirSync(path.dirname(HOOKS_FILE())).filter((name) => name !== 'hooks.json')
    expect(backups.length).toBeGreaterThan(0)
  })
})

describe('antigravityIntegration.install: what is not ours', () => {
  it('refuses a workscribe entry that is not a hook object, or whose PostToolUse is not a list', () => {
    writeHooks({ workscribe: 'mine' })
    expect(antigravityIntegration.install()).toBe('unreadable')
    expect(readHooks()).toEqual({ workscribe: 'mine' })

    writeHooks({ workscribe: { PostToolUse: 'mine' } })
    expect(antigravityIntegration.install()).toBe('unreadable')
    expect(readHooks()).toEqual({ workscribe: { PostToolUse: 'mine' } })
  })

  it('turns a disabled workscribe hook back on', () => {
    antigravityIntegration.install()
    const disabled = readHooks()
    disabled.workscribe.enabled = false
    writeHooks(disabled)
    expect(antigravityIntegration.isHookOutdated?.()).toBe(true)

    antigravityIntegration.install()

    expect(readHooks().workscribe).not.toHaveProperty('enabled')
    expect(antigravityIntegration.isHookOutdated?.()).toBe(false)
  })

  it('leaves what the user keeps in a hook holding ours: odd entries and empty lists', () => {
    const mine = {
      PreInvocation: [],
      PostToolUse: ['a note', { matcher: 'run_command', hooks: ['a note', { type: 'command', command: './mine.sh' }] }],
    }
    writeHooks({ other: mine })
    antigravityIntegration.install()
    const withOurs = readHooks()
    withOurs.other.PostToolUse.push({
      matcher: 'edit_file',
      hooks: [{ type: 'command', command: '"/usr/bin/node" "/x/workscribe" _hook --source antigravity' }],
    })
    writeHooks(withOurs)

    antigravityIntegration.uninstall()

    expect(readHooks()).toEqual({ other: mine })
  })
})

describe('antigravityIntegration.uninstall', () => {
  it('removes only Workscribe, leaving the other hooks as they were', () => {
    writeHooks(OTHER_HOOK)
    antigravityIntegration.install()

    expect(antigravityIntegration.uninstall()).toBe('removed')

    expect(readHooks()).toEqual(OTHER_HOOK)
  })

  it('removes Workscribe from a hook the user named workscribe, keeping their handlers', () => {
    const theirs = { matcher: 'run_command', hooks: [{ type: 'command', command: './mine.sh' }] }
    writeHooks({ workscribe: { PostToolUse: [theirs] } })
    antigravityIntegration.install()

    antigravityIntegration.uninstall()

    expect(readHooks()).toEqual({ workscribe: { PostToolUse: [theirs] } })
  })

  it('says not-installed for a missing file or one with no Workscribe hook, and unreadable for a corrupt one', () => {
    expect(antigravityIntegration.uninstall()).toBe('not-installed')
    writeHooks(OTHER_HOOK)
    expect(antigravityIntegration.uninstall()).toBe('not-installed')
    writeHooks('{ not json')
    expect(antigravityIntegration.uninstall()).toBe('unreadable')
  })
})

describe('antigravityIntegration health', () => {
  it('is current after install, so init offers no update', () => {
    antigravityIntegration.install()

    expect(antigravityIntegration.isHookInstalled()).toBe(true)
    expect(antigravityIntegration.isHookOutdated?.()).toBe(false)
    expect(antigravityIntegration.checkHealth()).toMatchObject({ installed: true, pinned: true, guarded: true })
  })

  it('is not installed with no file, and has nothing to update', () => {
    expect(antigravityIntegration.isHookInstalled()).toBe(false)
    expect(antigravityIntegration.isHookOutdated?.()).toBe(false)
    expect(antigravityIntegration.checkHealth().installed).toBe(false)
  })

  it('is outdated when a watched tool has no group, or a group matches something else', () => {
    antigravityIntegration.install()
    const hooks = readHooks()
    hooks.workscribe.PostToolUse = hooks.workscribe.PostToolUse.filter(
      (group: { matcher: string }) => group.matcher !== 'write_file'
    )
    writeHooks(hooks)
    expect(antigravityIntegration.isHookOutdated?.()).toBe(true)

    antigravityIntegration.install()
    const widened = readHooks()
    widened.workscribe.PostToolUse[0].matcher = '*'
    writeHooks(widened)
    expect(antigravityIntegration.isHookOutdated?.()).toBe(true)
  })

  it('is outdated when the hook is disabled or lacks its timeout', () => {
    antigravityIntegration.install()
    const disabled = readHooks()
    disabled.workscribe.enabled = false
    writeHooks(disabled)
    expect(antigravityIntegration.isHookOutdated?.()).toBe(true)

    antigravityIntegration.install()
    const noTimeout = readHooks()
    delete noTimeout.workscribe.PostToolUse[0].hooks[0].timeout
    writeHooks(noTimeout)
    expect(antigravityIntegration.isHookOutdated?.()).toBe(true)
  })

  it('is outdated when a command is unpinned, and install repairs it', () => {
    writeHooks({
      workscribe: {
        PostToolUse: WATCHED.map((matcher) => ({
          matcher,
          hooks: [{ type: 'command', command: 'workscribe _hook --source antigravity' }],
        })),
      },
    })
    expect(antigravityIntegration.isHookOutdated?.()).toBe(true)
    expect(antigravityIntegration.checkHealth()).toMatchObject({ installed: true, pinned: false })

    antigravityIntegration.install()

    expect(antigravityIntegration.isHookOutdated?.()).toBe(false)
    expect(readHooks().workscribe.PostToolUse).toHaveLength(WATCHED.length)
  })
})
