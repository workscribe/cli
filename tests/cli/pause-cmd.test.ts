import { describe, it, expect, vi } from 'vitest'

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    writeFileSync: vi.fn(),
    rmSync: vi.fn(),
  },
}))

vi.mock('../../src/utils/paths')

import fs from 'fs'
import { Command } from 'commander'
import { log } from '../../src/utils/logger'
import { PAUSE_FLAG_PATH } from '../../src/utils/paths'
import { registerPause } from '../../src/cli/pause'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerPause(program)
  return program
}

describe('workscribe pause', () => {
  it('creates the flag file when not already paused', async () => {
    mockFs.existsSync.mockReturnValue(false)
    await makeProgram().parseAsync(['pause'], { from: 'user' })
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(PAUSE_FLAG_PATH, '', { mode: 0o600 })
  })

  it('logs success when pause is activated', async () => {
    mockFs.existsSync.mockReturnValue(false)
    await makeProgram().parseAsync(['pause'], { from: 'user' })
    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining('paused'))
  })

  it('logs info and does not write file when already paused', async () => {
    mockFs.existsSync.mockReturnValue(true)
    await makeProgram().parseAsync(['pause'], { from: 'user' })
    expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('already paused'))
  })
})

describe('workscribe resume', () => {
  it('removes the flag file when paused', async () => {
    mockFs.existsSync.mockReturnValue(true)
    await makeProgram().parseAsync(['resume'], { from: 'user' })
    expect(mockFs.rmSync).toHaveBeenCalledWith(PAUSE_FLAG_PATH)
  })

  it('logs success when resume is activated', async () => {
    mockFs.existsSync.mockReturnValue(true)
    await makeProgram().parseAsync(['resume'], { from: 'user' })
    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining('resumed'))
  })

  it('logs info and does not delete file when not paused', async () => {
    mockFs.existsSync.mockReturnValue(false)
    await makeProgram().parseAsync(['resume'], { from: 'user' })
    expect(mockFs.rmSync).not.toHaveBeenCalled()
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('not paused'))
  })
})
