import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/config', () => ({ readConfig: vi.fn(), writeConfig: vi.fn() }))
vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})) }))
vi.mock('../../src/db/path-events', () => ({ countEventsUnderFolder: vi.fn() }))
vi.mock('../../src/utils/working-directory', () => ({ currentDirectory: vi.fn(() => '/Users/dev/work') }))
vi.mock('../../src/cli/fail', () => ({
  fail: vi.fn((message: string) => {
    throw new Error(message)
  }),
}))

import { Command } from 'commander'
import { readConfig, writeConfig } from '../../src/config'
import { countEventsUnderFolder } from '../../src/db/path-events'
import { log } from '../../src/utils/logger'
import { createTestConfig } from '../helpers/config'
import { registerExclude } from '../../src/cli/exclude'

const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
const mockWriteConfig = writeConfig as ReturnType<typeof vi.fn>
const mockCountEventsUnderFolder = countEventsUnderFolder as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

function configExcluding(excludePaths: string[]) {
  const config = createTestConfig()
  return { ...config, capture: { ...config.capture, excludePaths } }
}

function run(...args: string[]): Promise<Command> {
  const program = new Command()
  program.exitOverride()
  registerExclude(program)
  return program.parseAsync(['exclude', ...args], { from: 'user' })
}

function savedExcludePaths(): string[] {
  return mockWriteConfig.mock.calls[0][0].capture.excludePaths
}

beforeEach(() => {
  mockReadConfig.mockReturnValue(configExcluding([]))
  mockCountEventsUnderFolder.mockReturnValue(0)
})

describe('workscribe exclude <path>', () => {
  it('stores the absolute path, relative to where you are', async () => {
    await run('client')

    expect(savedExcludePaths()).toEqual(['/Users/dev/work/client'])
    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining('/Users/dev/work/client'))
  })

  it('keeps the folders already excluded', async () => {
    mockReadConfig.mockReturnValue(configExcluding(['/Users/dev/other']))

    await run('client')

    expect(savedExcludePaths()).toEqual(['/Users/dev/other', '/Users/dev/work/client'])
  })

  it('says so, and writes nothing, when the folder is already excluded', async () => {
    mockReadConfig.mockReturnValue(configExcluding(['/Users/dev/work/client']))

    await run('client/')

    expect(mockWriteConfig).not.toHaveBeenCalled()
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('already excluded'))
  })

  it('reports how many earlier events were kept, and that nothing was deleted', async () => {
    mockCountEventsUnderFolder.mockReturnValue(142)

    await run('client')

    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('142 events already recorded'))
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining("doesn't delete"))
  })

  it('says nothing about kept events when there are none', async () => {
    await run('client')

    expect(mockLog.plain).not.toHaveBeenCalledWith(expect.stringContaining('already recorded'))
  })

  it('allows a folder that does not exist yet', async () => {
    await run('~/later/project')

    expect(mockWriteConfig).toHaveBeenCalled()
  })

  it('refuses the root and the home folder, and points to pause', async () => {
    await expect(run('/')).rejects.toThrow('workscribe pause')
    await expect(run(`${process.env.HOME}`)).rejects.toThrow('workscribe pause')
    expect(mockWriteConfig).not.toHaveBeenCalled()
  })

  it('asks for a folder when none is given', async () => {
    await expect(run()).rejects.toThrow('Give a directory')
  })
})

describe('workscribe exclude --list', () => {
  it('prints each excluded folder', async () => {
    mockReadConfig.mockReturnValue(configExcluding(['/a', '/b']))

    await run('--list')

    expect(mockLog.plain).toHaveBeenCalledWith('/a')
    expect(mockLog.plain).toHaveBeenCalledWith('/b')
  })

  it('says when there are none', async () => {
    await run('--list')

    expect(mockLog.plain).toHaveBeenCalledWith('No excluded paths.')
  })
})

describe('workscribe exclude --remove', () => {
  it('takes the folder off the list however it is written', async () => {
    mockReadConfig.mockReturnValue(configExcluding(['/Users/dev/work/client', '/Users/dev/other']))

    await run('--remove', 'client/')

    expect(savedExcludePaths()).toEqual(['/Users/dev/other'])
  })

  it('says so, and writes nothing, for a folder that is not excluded', async () => {
    await run('--remove', 'client')

    expect(mockWriteConfig).not.toHaveBeenCalled()
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('is not excluded'))
  })
})
