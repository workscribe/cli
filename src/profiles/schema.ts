export interface ProfileRule {
  pattern: string
  category: string
  metadata?: Record<string, string>
}

export interface Profile {
  name: string
  displayName: string
  version: string
  detect?: { files?: string[] }
  rules: ProfileRule[]
  aiContext?: string
}

export interface ManifestEntry {
  name: string
  displayName: string
  tags: string[]
  description: string
  keywords: string[]
  detect?: { files?: string[] }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isValidRule(rule: unknown): boolean {
  if (!rule || typeof rule !== 'object') return false
  const { pattern, category } = rule as Record<string, unknown>
  return isNonEmptyString(pattern) && isNonEmptyString(category)
}

export function isValidProfile(candidate: unknown): candidate is Profile {
  if (!candidate || typeof candidate !== 'object') return false
  const { name, displayName, version, rules } = candidate as Record<string, unknown>
  if (!isNonEmptyString(name) || !isNonEmptyString(displayName) || !isNonEmptyString(version)) return false
  if (!Array.isArray(rules)) return false
  return rules.every(isValidRule)
}

export function isValidManifest(m: unknown): m is ManifestEntry[] {
  return (
    Array.isArray(m) &&
    m.every((e) => e && typeof e === 'object' && typeof (e as Record<string, unknown>).name === 'string')
  )
}
