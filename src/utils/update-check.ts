import fs from 'fs'
import os from 'os'
import { UPDATE_CHECK_PATH } from './paths'
import { readConfig, WorkscribeConfig } from '../config'
import { debugLog } from './logger'

export interface TelemetryPayload {
  installId: string
  cliVersion: string
  platform: string
  nodeVersion: string
}

declare const __WORKSCRIBE_VERSION__: string

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

interface UpdateCache {
  lastChecked: number
  latestVersion: string
  lastTelemetryPing?: number
}

function readCache(): UpdateCache | null {
  try {
    return JSON.parse(fs.readFileSync(UPDATE_CHECK_PATH, 'utf-8')) as UpdateCache
  } catch {
    return null
  }
}

// Merges with whatever's already on disk rather than overwriting — checkForUpdate()
// and pingTelemetry() each own one field in the same cache file and must not
// silently wipe out the other's value when they write.
function writeCache(updates: Partial<UpdateCache>): void {
  try {
    const current = readCache() ?? {}
    fs.writeFileSync(UPDATE_CHECK_PATH, JSON.stringify({ ...current, ...updates }), { mode: 0o600 })
  } catch {
    // Not critical — silently skip if the data dir doesn't exist yet
  }
}

function isNewer(latest: string, current: string): boolean {
  const parse = (version: string) => version.replace(/^v/, '').split('.').map(Number)
  const [latestMajor, latestMinor, latestPatch] = parse(latest)
  const [currentMajor, currentMinor, currentPatch] = parse(current)
  if (latestMajor !== currentMajor) return latestMajor > currentMajor
  if (latestMinor !== currentMinor) return latestMinor > currentMinor
  return latestPatch > currentPatch
}

export function checkForUpdate(): void {
  const current = __WORKSCRIBE_VERSION__
  const cache = readCache()

  if (cache && isNewer(cache.latestVersion, current)) {
    process.stderr.write(
      `\n  Update available ${current} → ${cache.latestVersion}\n  Run: npm install -g @workscribe/cli\n\n`
    )
  }

  const now = Date.now()
  if (!cache || now - cache.lastChecked > CHECK_INTERVAL_MS) {
    fetch('https://registry.npmjs.org/@workscribe/cli/latest')
      .then((response) => response.json())
      .then((data: unknown) => {
        const latest = (data as { version?: string }).version
        if (latest) writeCache({ lastChecked: now, latestVersion: latest })
      })
      .catch(() => {
        // Network unavailable — will retry next run
      })
  }
}

export function buildTelemetryPayload(config: WorkscribeConfig): TelemetryPayload {
  return {
    installId: config.telemetry.installId,
    cliVersion: __WORKSCRIBE_VERSION__,
    platform: os.platform(),
    nodeVersion: process.version,
  }
}

export function pingTelemetry(): void {
  const config = readConfig()
  if (!config.telemetry.enabled || !config.telemetry.installId) return

  const cache = readCache()
  const now = Date.now()
  if (cache?.lastTelemetryPing && now - cache.lastTelemetryPing <= CHECK_INTERVAL_MS) return

  fetch('https://workscribe.co/api/telemetry/ping', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(buildTelemetryPayload(config)),
  })
    .then((response) => {
      // fetch() only rejects on network failure — a 4xx/5xx still resolves,
      // so without this check a server-side outage would silently look like
      // a successful ping and get throttled for a full day.
      if (!response.ok) {
        debugLog('pingTelemetry', new Error(`Ping failed with HTTP ${response.status}`))
        return
      }
      writeCache({ lastTelemetryPing: now })
    })
    .catch((error) => {
      debugLog('pingTelemetry', error)
    })
}
