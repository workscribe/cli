import { describe, it, expect, beforeAll, vi } from 'vitest'
import { execFileSync, spawnSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { injectBinaryPath } from '../../src/capture/shell-hook'

// The real hook templates, run in real shells against a stub `workscribe` that writes each argument it gets on its
// own line — so a flag and its value arriving as one argument (zsh doesn't word-split ${x:+--flag "$x"}) shows.
const TEMPLATES = path.join(__dirname, '..', '..', 'shell')
// The shell exits in milliseconds, but its background job can take seconds to write: over 400 runs on an idle Mac the
// median was 359 ms and the slowest 2.8 s. It's a limit, not a delay: a capture returns as soon as it's written
const CAPTURE_WAIT_MS = 15_000
// How long a test waits before believing nothing was captured, the one case that always waits this out
const NO_CAPTURE_WAIT_MS = 2000
vi.setConfig({ testTimeout: CAPTURE_WAIT_MS + 5000 })
// No rc files: zsh -f loads no framework (so no zsh/datetime either), bash --norc reads no ~/.bashrc
const PLAIN_ZSH = ['zsh', '-f', '-c']
const PLAIN_BASH = ['bash', '--norc', '-c']

function hasShell(shell: string): boolean {
  return spawnSync(shell, ['-c', 'exit 0']).status === 0
}

function bashHasEpochRealtime(): boolean {
  return spawnSync('bash', ['-c', '[[ -n "${EPOCHREALTIME:-}" ]]']).status === 0
}

interface Sandbox {
  /** A git repo with one commit, to run commands in */
  repo: string
  head: string
  /** Where the stub writes the arguments it was called with */
  callsFile: string
  /** A folder holding the stub `workscribe`, to put first on PATH */
  binDir: string
  /** The shell's home: with an alert pending in the real one, the hook's `alerts --check` would overwrite the calls */
  home: string
}

function makeSandbox(): Sandbox {
  // The real path: on macOS the temp folder is behind a symlink, and the shell reports $PWD resolved
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-hooks-')))
  const repo = path.join(root, 'repo')
  const binDir = path.join(root, 'bin')
  const home = path.join(root, 'home')
  fs.mkdirSync(repo)
  fs.mkdirSync(binDir)
  fs.mkdirSync(home)
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf-8' }).trim()
  git('init', '-q')
  git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '--allow-empty', '-m', 'init')
  const callsFile = path.join(root, 'calls')
  // Written aside and moved into place, so a test polling for the file never reads only the first few arguments
  const stub = `#!/bin/sh\nfor argument in "$@"; do printf '%s\\n' "$argument"; done > '${callsFile}.tmp'\nmv '${callsFile}.tmp' '${callsFile}'\n`
  fs.writeFileSync(path.join(binDir, 'workscribe'), stub, { mode: 0o755 })
  return { repo, head: git('rev-parse', 'HEAD'), callsFile, binDir, home }
}

/** The hook as `init` writes it, pinned to a Node stub — `[[ -x <binary> ]]`, then `node <binary> _capture`. */
function writePinnedHook(sandbox: Sandbox, template: string): string {
  const stub = path.join(sandbox.binDir, 'workscribe-pinned.js')
  const script = `require('fs').writeFileSync(${JSON.stringify(sandbox.callsFile)}, process.argv.slice(2).join('\\n') + '\\n')`
  fs.writeFileSync(stub, script, { mode: 0o755 })
  const pinned = path.join(sandbox.binDir, `pinned-${template}`)
  const hookContent = fs.readFileSync(path.join(TEMPLATES, template), 'utf-8')
  fs.writeFileSync(pinned, injectBinaryPath(hookContent, stub, process.execPath))
  return pinned
}

/** The arguments the stub got, once the hook's background job has written them; empty when it never ran. */
function waitForCalls(callsFile: string, waitMs: number): string[] {
  const deadline = Date.now() + waitMs
  while (Date.now() < deadline) {
    if (fs.existsSync(callsFile)) {
      const content = fs.readFileSync(callsFile, 'utf-8')
      if (content.endsWith('\n')) return content.slice(0, -1).split('\n')
    }
    // A short synchronous pause: the shell has exited, and only its disowned capture job is still writing
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25)
  }
  return []
}

interface Run {
  sandbox: Sandbox
  shell: string[]
  script: string
  /** Folders put first on PATH — the stub's by default */
  binDirs?: string[]
  waitMs?: number
}

function runIn({ sandbox, shell, script, binDirs = [sandbox.binDir], waitMs = CAPTURE_WAIT_MS }: Run): string[] {
  fs.rmSync(sandbox.callsFile, { force: true })
  const result = spawnSync(shell[0], [...shell.slice(1), script], {
    cwd: sandbox.repo,
    env: { ...process.env, HOME: sandbox.home, PATH: [...binDirs, process.env.PATH].join(':') },
    encoding: 'utf-8',
  })
  expect(result.stderr).toBe('')
  return waitForCalls(sandbox.callsFile, waitMs)
}

/** The value after a flag, or undefined when the flag isn't there. */
function valueOf(calls: string[], flag: string): string | undefined {
  const index = calls.indexOf(flag)
  return index === -1 ? undefined : calls[index + 1]
}

describe.skipIf(!hasShell('zsh'))('the zsh hook', () => {
  let sandbox: Sandbox
  beforeAll(() => {
    sandbox = makeSandbox()
  })
  const hook = path.join(TEMPLATES, 'hook.zsh')
  const run = (script: string, binDirs?: string[]) => runIn({ sandbox, shell: PLAIN_ZSH, script, binDirs })

  it('captures a command in a git repo in plain zsh, every flag and value its own argument', () => {
    const calls = run(`source '${hook}'; _workscribe_preexec 'vercel --prod'; _workscribe_precmd`)

    expect(calls.slice(0, 7)).toEqual(['_capture', '--cmd', 'vercel --prod', '--cwd', sandbox.repo, '--exit', '0'])
    expect(valueOf(calls, '--duration')).toMatch(/^\d+$/)
    expect(valueOf(calls, '--git-before')).toBe(sandbox.head)
  })

  it('records the exit code of the command, not of the hook', () => {
    const calls = run(`source '${hook}'; _workscribe_preexec 'npm test'; (exit 3); _workscribe_precmd`)

    expect(valueOf(calls, '--exit')).toBe('3')
  })

  it('captures the command without a duration when it was never timed', () => {
    const calls = run(`source '${hook}'; _workscribe_cmd='npm login'; _workscribe_precmd`)

    expect(valueOf(calls, '--cmd')).toBe('npm login')
    expect(calls).not.toContain('--duration')
  })

  it('captures through the pinned form init writes', () => {
    const pinned = writePinnedHook(sandbox, 'hook.zsh')

    const calls = run(`source '${pinned}'; _workscribe_preexec 'git push'; _workscribe_precmd`, [])

    expect(valueOf(calls, '--cmd')).toBe('git push')
    expect(valueOf(calls, '--git-before')).toBe(sandbox.head)
  })
})

describe.skipIf(!hasShell('bash'))('the bash hook', () => {
  let sandbox: Sandbox
  let bsdDateDir: string
  beforeAll(() => {
    sandbox = makeSandbox()
    // macOS's BSD date has no %N: `date +%s%3N` prints the seconds then a literal 3N
    bsdDateDir = path.join(path.dirname(sandbox.binDir), 'bsd-date')
    fs.mkdirSync(bsdDateDir)
    const fakeDate = '#!/bin/sh\ncase "$1" in *%N*) echo "$(/bin/date +%s)3N" ;; *) exec /bin/date "$@" ;; esac\n'
    fs.writeFileSync(path.join(bsdDateDir, 'date'), fakeDate, { mode: 0o755 })
  })
  const hook = path.join(TEMPLATES, 'hook.bash')
  const run = (script: string, binDirs?: string[]) => runIn({ sandbox, shell: PLAIN_BASH, script, binDirs })
  // A shell's first prompt, then a command at the next one, which the DEBUG trap records
  const promptSession = (hookFile: string, command: string) =>
    `unset EPOCHREALTIME; source '${hookFile}'; _workscribe_precmd; ${command}; _workscribe_precmd`

  it('captures a command with BSD date and no $EPOCHREALTIME (macOS bash 3.2), in a git repo', () => {
    const calls = run(promptSession(hook, 'true vercel-check'), [sandbox.binDir, bsdDateDir])

    expect(calls.slice(0, 7)).toEqual(['_capture', '--cmd', 'true vercel-check', '--cwd', sandbox.repo, '--exit', '0'])
    expect(valueOf(calls, '--duration')).toMatch(/^\d+$/)
    expect(valueOf(calls, '--git-before')).toBe(sandbox.head)
  })

  it('ignores the rc lines that run before the first prompt', () => {
    // Before the first prompt the DEBUG trap only sees rc-file lines — none of them is the user's command
    const script = `unset EPOCHREALTIME; source '${hook}'; export AFTER_THE_HOOK=1; _workscribe_precmd`
    const calls = runIn({ sandbox, shell: PLAIN_BASH, script, waitMs: NO_CAPTURE_WAIT_MS })

    expect(calls).toEqual([])
  })

  it.skipIf(!bashHasEpochRealtime())('captures with $EPOCHREALTIME when bash has it (bash 5)', () => {
    const calls = run(`source '${hook}'; _workscribe_precmd; true npm-check; _workscribe_precmd`)

    expect(valueOf(calls, '--cmd')).toBe('true npm-check')
    expect(valueOf(calls, '--duration')).toMatch(/^\d+$/)
  })

  it('captures the command without a duration when it was never timed', () => {
    const script = `source '${hook}'; trap - DEBUG; _workscribe_cmd_start=''; _workscribe_last_cmd='npm login'; _workscribe_precmd`
    const calls = run(script)

    expect(valueOf(calls, '--cmd')).toBe('npm login')
    expect(calls).not.toContain('--duration')
  })

  it('captures through the pinned form init writes', () => {
    const pinned = writePinnedHook(sandbox, 'hook.bash')

    const calls = run(promptSession(pinned, 'true git-push'), [bsdDateDir])

    expect(valueOf(calls, '--cmd')).toBe('true git-push')
    expect(valueOf(calls, '--duration')).toMatch(/^\d+$/)
  })
})
