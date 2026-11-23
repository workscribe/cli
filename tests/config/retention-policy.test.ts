import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
  },
}))
vi.mock('../../src/utils/paths', () => ({ CONFIG_PATH: '/home/user/.config/workscribe/config.json' }))

import fs from 'fs'
import { readConfig, readRetentionPolicy } from '../../src/config'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  mockFs.existsSync.mockReturnValue(true)
  mockFs.readFileSync.mockReset()
})

describe('readRetentionPolicy: the setting removal reads (WOR-179)', () => {
  it('has the defaults for a fresh install, which has no config file yet', () => {
    mockFs.existsSync.mockReturnValue(false)
    expect(readRetentionPolicy()).toEqual({
      status: 'ok',
      retention: { days: 100, keepForever: false, summaryDays: null },
    })
  })

  it('reads what the file says', () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ retention: { days: 30, keepForever: true } }))
    expect(readRetentionPolicy()).toMatchObject({ status: 'ok', retention: { days: 30, keepForever: true } })
  })

  it('is unreadable, not the defaults, when the file is not JSON', () => {
    mockFs.readFileSync.mockReturnValue('{ "retention": ')
    expect(readRetentionPolicy().status).toBe('unreadable')
    // readConfig reads the same file as the defaults, which is why removal does not use it
    expect(readConfig().retention.keepForever).toBe(false)
  })

  it('is unreadable when the file cannot be read', () => {
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error('EACCES')
    })
    expect(readRetentionPolicy().status).toBe('unreadable')
  })

  it('is unreadable when retention is not an object', () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ retention: 'keep' }))
    expect(readRetentionPolicy().status).toBe('unreadable')
  })
})

describe('the config a person gets', () => {
  it('has the retention defaults without a retention block, and the saved values with one', () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ session: { idleTimeout: 30 } }))
    expect(readConfig().retention).toEqual({ days: 100, keepForever: false, summaryDays: null })

    mockFs.readFileSync.mockReturnValue(JSON.stringify({ retention: { days: 60, summaryDays: 365 } }))
    expect(readConfig().retention).toEqual({ days: 60, keepForever: false, summaryDays: 365 })
  })
})
