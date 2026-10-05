import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    chmodSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}))

vi.mock('../../src/utils/paths', () => ({
  CONFIG_PATH: '/home/user/.config/workscribe/config.json',
}))

import fs from 'fs'
import { readConfig, ensureInstallId } from '../../src/config'
import { createTestConfig } from '../helpers/config'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>

beforeEach(() => {
  mockFs.existsSync.mockReturnValue(false)
  mockFs.readFileSync.mockReset()
  mockFs.writeFileSync.mockReset()
})

describe('telemetry config defaults (CLI-01)', () => {
  it('defaults telemetry.enabled to true for a fresh install', () => {
    expect(readConfig().telemetry.enabled).toBe(true)
  })

  it('defaults telemetry.installId to an empty string, not null', () => {
    expect(readConfig().telemetry.installId).toBe('')
  })

  it('backfills telemetry for an existing config predating the telemetry key', () => {
    mockFs.existsSync.mockReturnValue(true)
    const preTelemetryConfig = createTestConfig()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (preTelemetryConfig as any).telemetry
    mockFs.readFileSync.mockReturnValue(JSON.stringify(preTelemetryConfig))

    const config = readConfig()

    expect(config.telemetry).toEqual({ enabled: true, installId: '' })
  })

  it('preserves an existing installId rather than overwriting it on read', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(
      JSON.stringify(createTestConfig({ telemetry: { enabled: false, installId: 'already-set' } }))
    )

    const config = readConfig()

    expect(config.telemetry).toEqual({ enabled: false, installId: 'already-set' })
  })
})

describe('ensureInstallId (CLI-02)', () => {
  it('generates a uuid when installId is empty', () => {
    const config = createTestConfig({ telemetry: { enabled: true, installId: '' } })
    const installId = ensureInstallId(config)
    expect(installId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('persists the generated id via writeConfig', () => {
    const config = createTestConfig({ telemetry: { enabled: true, installId: '' } })
    ensureInstallId(config)
    expect(mockFs.writeFileSync).toHaveBeenCalledOnce()
    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
    expect(written.telemetry.installId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('returns the existing id unchanged without writing, when already set', () => {
    const config = createTestConfig({ telemetry: { enabled: true, installId: 'existing-id' } })
    const result = ensureInstallId(config)
    expect(result).toBe('existing-id')
    expect(mockFs.writeFileSync).not.toHaveBeenCalled()
  })

  it('does not mutate its argument — callers must sync the returned id back themselves', () => {
    const config = createTestConfig({ telemetry: { enabled: true, installId: '' } })
    ensureInstallId(config)
    expect(config.telemetry.installId).toBe('')
  })

  it('is idempotent once the caller syncs the returned id back onto config', () => {
    const config = createTestConfig({ telemetry: { enabled: true, installId: '' } })
    config.telemetry.installId = ensureInstallId(config)
    const second = ensureInstallId(config)
    expect(second).toBe(config.telemetry.installId)
  })
})
