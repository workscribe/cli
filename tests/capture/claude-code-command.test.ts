import { describe, it, expect } from 'vitest'
import { spawnSync } from 'child_process'
import {
  buildHookCommand,
  isGuardedCommand,
  isPinnedCommand,
  pinnedNodePath,
} from '../../src/capture/hooks/claude-code-command'

const PINNED = buildHookCommand({
  nodePath: '/opt/node/bin/node',
  binaryPath: '/opt/bin/workscribe',
  args: '_hook --source claude-code',
})
const BARE = buildHookCommand({ nodePath: '/opt/node/bin/node', binaryPath: null, args: '_hook --source claude-code' })

describe('buildHookCommand', () => {
  it('guards a pinned command on both the Node.js and workscribe paths, and never fails', () => {
    expect(PINNED).toBe(
      'test -x "/opt/node/bin/node" && test -x "/opt/bin/workscribe" && "/opt/node/bin/node" "/opt/bin/workscribe" _hook --source claude-code || true'
    )
  })

  it('guards the bare fallback on workscribe being on PATH', () => {
    expect(BARE).toBe('command -v workscribe >/dev/null 2>&1 && workscribe _hook --source claude-code || true')
  })
})

describe('isPinnedCommand', () => {
  it.each([
    [PINNED, true],
    ['"/opt/node/bin/node" "/opt/bin/workscribe" _hook --source claude-code', true],
    ['/opt/bin/workscribe _hook --source claude-code', true],
    [BARE, false],
    ['workscribe _hook --source claude-code', false],
  ])('%s → %s', (command, expected) => {
    expect(isPinnedCommand(command)).toBe(expected)
  })
})

describe('isGuardedCommand', () => {
  it.each([
    [PINNED, true],
    [BARE, true],
    ['"/opt/node/bin/node" "/opt/bin/workscribe" _hook --source claude-code', false],
    ['workscribe _hook --source claude-code', false],
    ['test -x "/opt/bin/workscribe" && "/opt/bin/workscribe" _hook --source claude-code', false],
  ])('%s → %s', (command, expected) => {
    expect(isGuardedCommand(command)).toBe(expected)
  })
})

describe('pinnedNodePath', () => {
  it('reads the Node.js path from pinned commands, guarded or not', () => {
    expect(pinnedNodePath(PINNED)).toBe('/opt/node/bin/node')
    expect(pinnedNodePath('"/usr/bin/node" "/x/workscribe" _hook')).toBe('/usr/bin/node')
  })

  it('is null for a bare command', () => {
    expect(pinnedNodePath(BARE)).toBeNull()
  })
})

// Claude Code runs hook commands through the shell; with the binary gone they must exit 0 and print nothing
describe('the guarded commands in a real shell', () => {
  it.each([
    [
      'pinned, binary removed',
      buildHookCommand({
        nodePath: process.execPath,
        binaryPath: '/nonexistent/workscribe',
        args: '_hook --source claude-code',
      }),
    ],
    [
      'pinned, Node.js removed',
      buildHookCommand({
        nodePath: '/nonexistent/node',
        binaryPath: '/nonexistent/workscribe',
        args: '_hook --source claude-code',
      }),
    ],
  ])('%s: exits 0 silently', (_name, command) => {
    const result = spawnSync('sh', ['-c', command], { encoding: 'utf-8' })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  it('bare, workscribe not on PATH: exits 0 silently', () => {
    const result = spawnSync('/bin/sh', ['-c', BARE], { encoding: 'utf-8', env: { PATH: '/nonexistent' } })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })

  it('the old unguarded form does fail — the reason for the guard', () => {
    const result = spawnSync(
      'sh',
      ['-c', `"${process.execPath}" "/nonexistent/workscribe" _hook --source claude-code`],
      {
        encoding: 'utf-8',
      }
    )
    expect(result.status).not.toBe(0)
  })
})
