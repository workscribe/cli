import fs from 'fs'
import { UPDATE_CHECK_PATH } from './paths'

declare const __WORKSCRIBE_VERSION__: string

const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000

interface UpdateCache {
  lastChecked: number
  latestVersion: string
}

function readCache(): UpdateCache | null {
  try {
    return JSON.parse(fs.readFileSync(UPDATE_CHECK_PATH, 'utf-8')) as UpdateCache
  } catch {
    return null
  }
}

function writeCache(cache: UpdateCache): void {
  try {
    fs.writeFileSync(UPDATE_CHECK_PATH, JSON.stringify(cache), { mode: 0o600 })
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
