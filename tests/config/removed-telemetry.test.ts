import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    renameSync: vi.fn(),
  },
}))

vi.mock('../../src/utils/paths', () => ({
  CONFIG_PATH: '/home/user/.config/workscribe/config.json',
}))

import fs from 'fs'
import { readConfig } from '../../src/config'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>

const LEGACY_CONFIG = {
  session: { idleTimeout: 45 },
  telemetry: { enabled: false, installId: 'old-install-id' },
}

beforeEach(() => {
  mockFs.existsSync.mockReturnValue(true)
  mockFs.readFileSync.mockReset()
  mockFs.writeFileSync.mockReset()
})

describe('a config written before telemetry was removed (WOR-181)', () => {
  it('reads without the telemetry block, and so without the install ID', () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify(LEGACY_CONFIG))

    const config = readConfig()

    expect(config).not.toHaveProperty('telemetry')
    expect(JSON.stringify(config)).not.toContain('old-install-id')
  })

  it('keeps the other settings', () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify(LEGACY_CONFIG))

    expect(readConfig().session.idleTimeout).toBe(45)
  })

  it('writes nothing when it reads: the key leaves the file with the next save', () => {
    mockFs.readFileSync.mockReturnValue(JSON.stringify(LEGACY_CONFIG))

    readConfig()

    expect(mockFs.writeFileSync).not.toHaveBeenCalled()
  })

  it('has no telemetry block for a fresh install either', () => {
    mockFs.existsSync.mockReturnValue(false)

    expect(readConfig()).not.toHaveProperty('telemetry')
  })
})
