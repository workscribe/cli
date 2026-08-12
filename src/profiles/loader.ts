import fs from 'fs'
import path from 'path'
import { PROFILES_DIR } from '../utils/paths'
import { readConfig } from '../config'
import { isValidProfile } from './schema'
import type { Profile, ManifestEntry, ProfileRule } from './schema'
import { readCachedManifest } from './fetcher'
import { debugLog } from '../utils/logger'

// Matches the Rule interface in patterns.ts — structural compatibility without circular import
interface CompiledRule {
  match(cmd: string): { category: string; metadata: Record<string, unknown> } | null
}

function compileRule(profileName: string, rule: ProfileRule): CompiledRule | null {
  let regex: RegExp
  try {
    regex = new RegExp(rule.pattern)
  } catch {
    debugLog('profiles', `Profile "${profileName}": invalid pattern "${rule.pattern}" — skipping rule`)
    return null
  }

  return {
    match(cmd: string) {
      const match = cmd.match(regex)
      if (!match) return null
      const metadata: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(rule.metadata ?? {})) {
        metadata[key] = value.replace(/\$(\d+)/g, (_, index: string) => match[Number(index)] ?? '')
      }
      return { category: rule.category, metadata }
    },
  }
}

function loadProfileFromDisk(name: string): Profile | null {
  const filePath = path.join(PROFILES_DIR, `${name}.json`)
  if (!fs.existsSync(filePath)) {
    debugLog('profiles', `Profile "${name}" not found in cache — run: workscribe profile add ${name}`)
    return null
  }
  let candidate: unknown
  try {
    candidate = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch {
    debugLog('profiles', `Profile "${name}" contains invalid JSON — skipping`)
    return null
  }
  if (!isValidProfile(candidate)) {
    debugLog('profiles', `Profile "${name}" failed schema validation — skipping`)
    return null
  }
  return candidate
}

function loadUserProfiles(): Profile[] {
  if (!fs.existsSync(PROFILES_DIR)) return []
  const activeNames = new Set(readConfig().capture.profiles)
  return fs
    .readdirSync(PROFILES_DIR)
    .filter((file) => file.endsWith('.json') && file !== 'manifest.json')
    .filter((file) => {
      const name = file.replace(/\.json$/, '')
      return !activeNames.has(name) // avoid double-loading names already in config
    })
    .flatMap((file) => {
      const candidate = loadProfileFromDisk(file.replace(/\.json$/, ''))
      return candidate ? [candidate] : []
    })
    .filter((profile) => fs.existsSync(path.join(PROFILES_DIR, `${profile.name}.json`)))
}

export function getActiveProfileRules(): CompiledRule[] {
  const activeNames = readConfig().capture.profiles
  if (activeNames.length === 0) return []

  return activeNames.flatMap((name) => {
    const profile = loadProfileFromDisk(name)
    if (!profile) return []
    return profile.rules.flatMap((rule) => {
      const compiled = compileRule(profile.name, rule)
      return compiled ? [compiled] : []
    })
  })
}

export function getActiveProfileAiContexts(): string[] {
  const activeNames = readConfig().capture.profiles
  if (activeNames.length === 0) return []

  return activeNames.flatMap((name) => {
    const profile = loadProfileFromDisk(name)
    return profile?.aiContext ? [profile.aiContext] : []
  })
}

export function getCachedProfiles(): Profile[] {
  if (!fs.existsSync(PROFILES_DIR)) return []
  return fs
    .readdirSync(PROFILES_DIR)
    .filter((file) => file.endsWith('.json') && file !== 'manifest.json')
    .flatMap((file) => {
      const profile = loadProfileFromDisk(file.replace(/\.json$/, ''))
      return profile ? [profile] : []
    })
}

export function detectProfilesForDirectory(dir: string): ManifestEntry[] {
  const manifest = readCachedManifest()
  if (!manifest) return []

  const activeNames = new Set(readConfig().capture.profiles)

  return manifest.filter((entry) => {
    if (activeNames.has(entry.name)) return false
    const indicatorFiles = entry.detect?.files ?? []
    return indicatorFiles.length > 0 && indicatorFiles.every((file) => fs.existsSync(path.join(dir, file)))
  })
}

export { loadUserProfiles }
