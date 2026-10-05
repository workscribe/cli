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
import { ensureTelemetryFallback } from '../../src/config'
import { createTestConfig } from '../helpers/config'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>

function mockStoredConfig(overrides: Parameters<typeof createTestConfig>[0] = {}) {
  mockFs.existsSync.mockReturnValue(true)
  mockFs.readFileSync.mockReturnValue(JSON.stringify(createTestConfig(overrides)))
}

beforeEach(() => {
  mockFs.existsSync.mockReturnValue(false)
  mockFs.readFileSync.mockReset()
  mockFs.writeFileSync.mockReset()
})

describe('ensureTelemetryFallback', () => {
  it('does nothing when installId is already present', () => {
    mockStoredConfig({ telemetry: { enabled: true, installId: 'existing-install-id' } })
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    ensureTelemetryFallback()

    expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    expect(stderrSpy).not.toHaveBeenCalled()
    stderrSpy.mockRestore()
  })

  it('generates installId, persists it, and prints a one-time notice when missing (fresh install)', () => {
    // existsSync returns false by default in beforeEach — readConfig() falls
    // back to DEFAULTS, where telemetry.installId is ''.
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    ensureTelemetryFallback()

    expect(mockFs.writeFileSync).toHaveBeenCalledOnce()
    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
    expect(written.telemetry.enabled).toBe(true)
    expect(written.telemetry.installId).toMatch(/^[0-9a-f-]{36}$/)
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('Opt out: workscribe config set telemetry.enabled false')
    )
    stderrSpy.mockRestore()
  })

  it('forces telemetry.enabled to true even if a stored config somehow had it false', () => {
    mockStoredConfig({ telemetry: { enabled: false, installId: '' } })
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

    ensureTelemetryFallback()

    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
    expect(written.telemetry.enabled).toBe(true)
    stderrSpy.mockRestore()
  })
})
