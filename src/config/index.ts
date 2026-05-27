import fs from 'fs'
import { CONFIG_PATH } from '../utils/paths'

export interface ChronicleConfig {
  ai: {
    provider: string   // 'anthropic' | 'openai' | 'ollama' | 'openai-compatible'
    apiKey: string
    model: string
    baseUrl: string
  }
  session: {
    idleTimeout: number  // minutes
  }
  capture: {
    ignore: string[]
  }
  redact: {
    extra: string[]
  }
  summary: {
    format: 'markdown' | 'json'
  }
}

const DEFAULTS: ChronicleConfig = {
  ai: {
    provider: '',
    apiKey: '',
    model: '',
    baseUrl: '',
  },
  session: {
    idleTimeout: 30,
  },
  capture: {
    ignore: ['cd', 'ls', 'll', 'la', 'ls -la', 'ls -l', 'ls -a', 'pwd', 'clear', 'exit', 'history', 'man'],
  },
  redact: {
    extra: [],
  },
  summary: {
    format: 'markdown',
  },
}

export function readConfig(): ChronicleConfig {
  if (!fs.existsSync(CONFIG_PATH)) return { ...DEFAULTS }
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    return deepMerge(DEFAULTS, parsed)
  } catch {
    return { ...DEFAULTS }
  }
}

export function writeConfig(config: ChronicleConfig): void {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 })
  // Enforce permissions on existing files (mode only applies on creation above)
  try { fs.chmodSync(CONFIG_PATH, 0o600) } catch { /* ignore */ }
}

export function getConfigValue(config: ChronicleConfig, key: string): unknown {
  const parts = key.split('.')
  let cur: unknown = config
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

export function setConfigValue(config: ChronicleConfig, key: string, value: string): ChronicleConfig {
  const parts = key.split('.')
  const result = JSON.parse(JSON.stringify(config)) as ChronicleConfig
  let cur = result as unknown as Record<string, unknown>
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]
    if (cur[part] == null || typeof cur[part] !== 'object') {
      cur[part] = {}
    }
    cur = cur[part] as Record<string, unknown>
  }
  const lastKey = parts[parts.length - 1]
  // Coerce value type
  if (value === 'true') cur[lastKey] = true
  else if (value === 'false') cur[lastKey] = false
  else if (!isNaN(Number(value))) cur[lastKey] = Number(value)
  else cur[lastKey] = value
  return result
}

function deepMerge<T extends object>(defaults: T, overrides: Partial<T>): T {
  const result = { ...defaults }
  for (const key of Object.keys(overrides) as (keyof T)[]) {
    const val = overrides[key]
    if (val !== null && typeof val === 'object' && !Array.isArray(val) && typeof defaults[key] === 'object') {
      result[key] = deepMerge(defaults[key] as object, val as object) as T[keyof T]
    } else if (val !== undefined) {
      result[key] = val as T[keyof T]
    }
  }
  return result
}
