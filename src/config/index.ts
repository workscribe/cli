import crypto from 'crypto'
import fs from 'fs'
import path from 'path'
import { CONFIG_PATH } from '../utils/paths'
import { debugLog } from '../utils/logger'

export interface WorkscribeConfig {
  ai: {
    provider: string // 'anthropic' | 'openai' | 'ollama' | 'openai-compatible'
    apiKey: string
    model: string
    baseUrl: string
  }
  session: {
    idleTimeout: number // minutes
  }
  git: {
    // When true, repo_name is "owner/repo" instead of bare "repo". Off by
    // default — bare names are nicer for the common case of one repo per
    // name. Turn on if you work across repos whose bare names collide
    // (e.g. an org that names plugin repos after the tool they target:
    // workscribe/vscode, workscribe/nvim, ...).
    qualifyRepoName: boolean
  }
  capture: {
    ignore: string[]
    aiTools: boolean
    includeAiderPrompt: boolean
    profiles: string[]
  }
  redact: {
    extra: string[]
  }
  summary: {
    format: 'markdown' | 'json'
    // Categories re-included in the AI payload (overrides built-in exclusions).
    // Excluded by default: exploring, other, linting.
    // Example: ["linting"] to include lint pass/fail in summaries.
    includeCategories?: string[]
  }
  projects?: Record<string, string> // absolute path → display name override
  integrations?: {
    slackWebhook?: string
    webhook?: string
  }
  telemetry: {
    enabled: boolean
    installId: string
  }
}

const DEFAULTS: WorkscribeConfig = {
  ai: {
    provider: '',
    apiKey: '',
    model: '',
    baseUrl: '',
  },
  session: {
    idleTimeout: 30,
  },
  git: {
    qualifyRepoName: false,
  },
  capture: {
    ignore: ['cd', 'ls', 'll', 'la', 'ls -la', 'ls -l', 'ls -a', 'pwd', 'clear', 'exit', 'history', 'man'],
    aiTools: true,
    includeAiderPrompt: true,
    profiles: [],
  },
  redact: {
    extra: [],
  },
  summary: {
    format: 'markdown',
  },
  telemetry: {
    enabled: true,
    installId: '',
  },
}

export function readConfig(): WorkscribeConfig {
  if (!fs.existsSync(CONFIG_PATH)) return deepMerge(DEFAULTS, {})
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    const parsed = JSON.parse(raw)
    return deepMerge(DEFAULTS, parsed)
  } catch {
    return deepMerge(DEFAULTS, {})
  }
}

export function writeConfig(config: WorkscribeConfig): void {
  // Previously safe to assume — writeConfig was only ever called after `init`
  // created the data directories, or by `config set` where init had already
  // run. CLI-05's fallback can now call this as the very first filesystem
  // touch for a user who skipped init entirely, so it can't assume the dir exists.
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true, mode: 0o700 })
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 })
  // Enforce permissions on existing files (mode only applies on creation above)
  try {
    fs.chmodSync(CONFIG_PATH, 0o600)
  } catch {
    /* ignore */
  }
}

// Generates and persists telemetry.installId on first use. Covers both a
// fresh install and an existing user upgrading — deepMerge already backfills
// the telemetry key itself, this just fills in the empty installId.
export function ensureInstallId(config: WorkscribeConfig): string {
  if (config.telemetry.installId) return config.telemetry.installId

  const installId = crypto.randomUUID()
  writeConfig({ ...config, telemetry: { ...config.telemetry, installId } })
  return installId
}

// Fallback for users who skip `init` entirely — which is exactly what an
// existing user upgrading will typically do, since they never re-run it.
// Presence of installId is the only state tracked; no separate "notice
// shown" flag is needed since this is a no-op once installId is set.
export function ensureTelemetryFallback(): void {
  // Unlike init's explicit telemetry step, this runs unannounced ahead of
  // every command — it must never throw, however it fails, or a disk issue
  // (read-only $HOME, full disk, a locked-down CI sandbox) would crash the
  // user's actual command before it even starts.
  try {
    const config = readConfig()
    if (config.telemetry.installId) return

    config.telemetry.enabled = true
    config.telemetry.installId = ensureInstallId(config)

    process.stderr.write(
      '\n  Workscribe collects anonymous install stats (install ID, CLI version, platform, Node version).\n  Opt out: workscribe config set telemetry.enabled false\n\n'
    )
  } catch (error) {
    debugLog('ensureTelemetryFallback', error)
  }
}

export function getConfigValue(config: WorkscribeConfig, key: string): unknown {
  const parts = key.split('.')
  let cur: unknown = config
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[part]
  }
  return cur
}

export function setConfigValue(config: WorkscribeConfig, key: string, value: string): WorkscribeConfig {
  const parts = key.split('.')
  const result = JSON.parse(JSON.stringify(config)) as WorkscribeConfig
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
  // structuredClone, not a shallow spread — any key overrides doesn't touch
  // (e.g. a config file written before a newer top-level key existed) must
  // still be an independent copy, not a shared reference back into the
  // caller's `defaults` object. A shallow spread here previously let any
  // caller that mutates a nested field on the returned config (e.g.
  // ensureTelemetryFallback) silently corrupt the module-level DEFAULTS
  // singleton for the rest of the process.
  const result = structuredClone(defaults)
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
