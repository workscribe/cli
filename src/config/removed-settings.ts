// Settings that no longer exist. `config set` refuses them, so a key someone remembers from an older version can't be
// written back into config.json. Pure.

const TELEMETRY_KEY = 'telemetry'

/** Why `config set` refuses `telemetry` and everything under it. */
export const REMOVED_TELEMETRY_SETTING_MESSAGE =
  'Telemetry was removed: Workscribe no longer sends install stats, so there is nothing to configure.'

/** `telemetry` and `telemetry.<anything>`, in any case — the settings `config set` refuses. */
export function isRemovedTelemetrySetting(key: string): boolean {
  const normalizedKey = key.toLowerCase()
  return normalizedKey === TELEMETRY_KEY || normalizedKey.startsWith(`${TELEMETRY_KEY}.`)
}
