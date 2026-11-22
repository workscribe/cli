import { describe, it, expect } from 'vitest'
import { isRemovedTelemetrySetting } from '../../src/config/removed-settings'

describe('isRemovedTelemetrySetting', () => {
  it.each(['telemetry', 'telemetry.enabled', 'telemetry.installId', 'Telemetry.Enabled', 'TELEMETRY'])(
    'says %s is a removed setting',
    (key) => {
      expect(isRemovedTelemetrySetting(key)).toBe(true)
    }
  )

  it.each(['telemetryX', 'session.telemetry', 'tickets.pattern', 'capture.ignore'])(
    'says %s is not a removed setting',
    (key) => {
      expect(isRemovedTelemetrySetting(key)).toBe(false)
    }
  )
})
