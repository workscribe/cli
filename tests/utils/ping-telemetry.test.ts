import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({
  default: {
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}))

vi.mock('../../src/utils/paths', () => ({
  UPDATE_CHECK_PATH: '/home/user/.local/state/workscribe/update-check.json',
  DEBUG_LOG_PATH: '/home/user/.local/state/workscribe/debug.log',
}))

vi.mock('../../src/config', () => ({
  readConfig: vi.fn(),
}))

vi.mock('../../src/utils/logger', () => ({
  debugLog: vi.fn(),
}))

import fs from 'fs'
import { pingTelemetry } from '../../src/utils/update-check'
import { readConfig } from '../../src/config'
import { debugLog } from '../../src/utils/logger'
import { createTestConfig } from '../helpers/config'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
const mockDebugLog = debugLog as ReturnType<typeof vi.fn>

async function flushMicrotasks() {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

beforeEach(() => {
  mockFs.readFileSync.mockReset().mockImplementation(() => {
    throw new Error('ENOENT')
  })
  mockFs.writeFileSync.mockReset()
  mockReadConfig.mockReset().mockReturnValue(createTestConfig())
  mockDebugLog.mockReset()
  vi.stubGlobal('fetch', vi.fn())
})

describe('pingTelemetry', () => {
  it('writes the throttle cache on a successful (2xx) response', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: true, status: 200 })

    pingTelemetry()
    await flushMicrotasks()

    expect(mockFs.writeFileSync).toHaveBeenCalledOnce()
    const written = JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
    expect(written.lastTelemetryPing).toBeTypeOf('number')
    expect(mockDebugLog).not.toHaveBeenCalled()
  })

  it('does not write the throttle cache on a non-2xx response, so the next run retries', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false, status: 500 })

    pingTelemetry()
    await flushMicrotasks()

    expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    expect(mockDebugLog).toHaveBeenCalledWith(
      'pingTelemetry',
      expect.objectContaining({ message: expect.stringContaining('500') })
    )
  })

  it('does not write the throttle cache when the network request itself fails', async () => {
    ;(fetch as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('network unreachable'))

    pingTelemetry()
    await flushMicrotasks()

    expect(mockFs.writeFileSync).not.toHaveBeenCalled()
    expect(mockDebugLog).toHaveBeenCalledWith(
      'pingTelemetry',
      expect.objectContaining({ message: 'network unreachable' })
    )
  })

  it('does not ping at all when telemetry is disabled', async () => {
    mockReadConfig.mockReturnValue(createTestConfig({ telemetry: { enabled: false, installId: 'abc' } }))

    pingTelemetry()
    await flushMicrotasks()

    expect(fetch).not.toHaveBeenCalled()
  })
})
