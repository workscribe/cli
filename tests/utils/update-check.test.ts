import { describe, it, expect } from 'vitest'
import { buildTelemetryPayload } from '../../src/utils/update-check'
import { createTestConfig } from '../helpers/config'

describe('buildTelemetryPayload', () => {
  it('includes the installId from config', () => {
    const config = createTestConfig({ telemetry: { enabled: true, installId: 'abc-123' } })
    expect(buildTelemetryPayload(config).installId).toBe('abc-123')
  })

  it('includes cliVersion, platform, and nodeVersion', () => {
    const config = createTestConfig()
    const payload = buildTelemetryPayload(config)
    expect(typeof payload.cliVersion).toBe('string')
    expect(payload.platform).toBe(process.platform)
    expect(payload.nodeVersion).toBe(process.version)
  })

  it('sends exactly these four fields — nothing else from config leaks in', () => {
    const config = createTestConfig({ telemetry: { enabled: true, installId: 'abc-123' } })
    const payload = buildTelemetryPayload(config)
    expect(Object.keys(payload).sort()).toEqual(['cliVersion', 'installId', 'nodeVersion', 'platform'])
  })
})
