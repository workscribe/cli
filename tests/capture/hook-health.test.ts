import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({ default: { accessSync: vi.fn(), constants: { X_OK: 1 } } }))
vi.mock('child_process', () => ({ execFileSync: vi.fn() }))

import fs from 'fs'
import { execFileSync } from 'child_process'
import { healthOfCommands } from '../../src/capture/hooks/hook-health'
import { buildHookCommand } from '../../src/capture/hooks/hook-command'

const mockAccess = vi.mocked(fs.accessSync)
const mockExec = vi.mocked(execFileSync)

const GUARDED = buildHookCommand({
  nodePath: '/opt/node/bin/node',
  binaryPath: '/opt/bin/workscribe',
  args: '_hook --source claude-code',
})
const BARE = buildHookCommand({ nodePath: '/opt/node/bin/node', binaryPath: null, args: '_hook --source claude-code' })
const UNGUARDED = '"/opt/node/bin/node" "/opt/bin/workscribe" _hook --source claude-code'

beforeEach(() => {
  mockAccess.mockImplementation(() => undefined)
})

describe('healthOfCommands', () => {
  it('is not installed with no commands, and probes nothing', () => {
    expect(healthOfCommands([])).toEqual({
      installed: false,
      pinned: true,
      guarded: true,
      nodeMissing: false,
      confirmedBroken: null,
    })
    expect(mockExec).not.toHaveBeenCalled()
  })

  it('is healthy when every command is pinned and guarded and Node is there, with no live probe', () => {
    expect(healthOfCommands([GUARDED])).toEqual({
      installed: true,
      pinned: true,
      guarded: true,
      nodeMissing: false,
      confirmedBroken: null,
    })
    expect(mockExec).not.toHaveBeenCalled()
  })

  it('says the Node.js a pinned hook runs is gone', () => {
    mockAccess.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    expect(healthOfCommands([GUARDED])).toMatchObject({ pinned: true, nodeMissing: true })
  })

  it('says a hook from before the guard was added is unguarded', () => {
    expect(healthOfCommands([UNGUARDED])).toMatchObject({ pinned: true, guarded: false })
  })

  it('probes a bare command, and says whether it is broken right now', () => {
    expect(healthOfCommands([BARE])).toMatchObject({ pinned: false, confirmedBroken: false })

    mockExec.mockImplementation(() => {
      throw new Error('not found')
    })
    expect(healthOfCommands([BARE])).toMatchObject({ pinned: false, confirmedBroken: true })
  })
})
