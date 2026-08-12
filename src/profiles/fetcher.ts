import fs from 'fs'
import path from 'path'
import { PROFILES_DIR } from '../utils/paths'
import { isValidProfile, isValidManifest } from './schema'
import type { ManifestEntry, Profile } from './schema'
import { debugLog } from '../utils/logger'

const REGISTRY_BASE = 'https://raw.githubusercontent.com/workscribe/profiles/main'

function manifestCachePath(): string {
  return path.join(PROFILES_DIR, 'manifest.json')
}

export async function fetchManifest(): Promise<ManifestEntry[]> {
  const response = await fetch(`${REGISTRY_BASE}/manifest.json`)
  if (!response.ok) throw new Error(`Registry unreachable (${response.status})`)
  const data: unknown = await response.json()
  if (!isValidManifest(data)) throw new Error('Manifest format unrecognised')
  return data
}

export async function fetchProfile(name: string): Promise<Profile> {
  const response = await fetch(`${REGISTRY_BASE}/${name}.json`)
  if (response.status === 404) throw new Error(`Profile "${name}" not found in registry`)
  if (!response.ok) throw new Error(`Registry unreachable (${response.status})`)
  const data: unknown = await response.json()
  if (!isValidProfile(data)) throw new Error(`Profile "${name}" failed schema validation`)
  return data
}

export async function installProfile(name: string): Promise<void> {
  ensureProfilesDir()
  const profile = await fetchProfile(name)
  const dest = path.join(PROFILES_DIR, `${name}.json`)
  fs.writeFileSync(dest, JSON.stringify(profile, null, 2), { encoding: 'utf-8', mode: 0o600 })
  debugLog('profiles', `Installed profile "${name}" to ${dest}`)
}

export async function cacheManifest(): Promise<ManifestEntry[]> {
  ensureProfilesDir()
  const manifest = await fetchManifest()
  fs.writeFileSync(manifestCachePath(), JSON.stringify(manifest, null, 2), { encoding: 'utf-8', mode: 0o600 })
  return manifest
}

export function readCachedManifest(): ManifestEntry[] | null {
  if (!fs.existsSync(manifestCachePath())) return null
  try {
    const data: unknown = JSON.parse(fs.readFileSync(manifestCachePath(), 'utf-8'))
    return isValidManifest(data) ? data : null
  } catch {
    return null
  }
}

function ensureProfilesDir(): void {
  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true, mode: 0o700 })
  }
}
