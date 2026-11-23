import fs from 'fs'
import path from 'path'
import { CONFIG_PATH } from '../utils/paths'
import { DEFAULT_TICKET_PATTERN } from '../capture/tickets'
import { DEFAULT_RETENTION, retentionPolicyOf, type RetentionConfig, type RetentionPolicy } from './retention'

/**
 * AI provider settings from Workscribe 1.x. 2.0 removed AI providers, so nothing writes these any more — they're
 * read only to tell 1.x users (see src/summary/legacy-ai.ts) and to keep a stored API key out of bug reports.
 */
export interface LegacyAiConfig {
  provider?: string
  apiKey?: string
  model?: string
  baseUrl?: string
}

export interface WorkscribeConfig {
  ai?: LegacyAiConfig
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
    // Coding agents' file edits: the path and line counts, never the text. On by default, like editor saves
    agentEdits: boolean
    // Coding agents' own recaps and compaction summaries: free text, so off by default; redacted and capped when on
    agentMessages: boolean
    // Directories never recorded: an event run in, or editing a file under, one is dropped before it is stored
    excludePaths: string[]
  }
  skill: {
    // Whether `sessions --json` gives the agent skill the agents' recaps, which are free text. Off by default; it
    // only matters while capture.agentMessages keeps them
    includeAgentMessages: boolean
  }
  redact: {
    extra: string[]
  }
  summary: {
    format: 'markdown' | 'json' | 'text'
    // Categories re-included in summaries (overrides built-in exclusions).
    // Excluded by default: exploring, other, linting.
    // Example: ["linting"] to include lint pass/fail in summaries.
    includeCategories?: string[]
    // 1.x setting ("template" | "ollama" | "provider"). 2.0 always uses the template; read only to detect
    // old configs (src/summary/legacy-ai.ts).
    engine?: string
  }
  projects?: Record<string, string> // absolute path → display name override
  integrations?: {
    slackWebhook?: string
    webhook?: string
  }
  tickets: {
    // What a ticket key looks like in branch names and commit messages (a regular expression). Change it with
    // `workscribe config set tickets.pattern`, which also re-links the history.
    pattern: string
  }
  // How long captured events are kept before they are removed (WOR-179); see `src/config/retention.ts`
  retention: RetentionConfig
}

const DEFAULTS: WorkscribeConfig = {
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
    agentEdits: true,
    agentMessages: false,
    excludePaths: [],
  },
  skill: {
    includeAgentMessages: false,
  },
  redact: {
    extra: [],
  },
  summary: {
    format: 'markdown',
  },
  tickets: {
    pattern: DEFAULT_TICKET_PATTERN,
  },
  retention: DEFAULT_RETENTION,
}

export function readConfig(): WorkscribeConfig {
  if (!fs.existsSync(CONFIG_PATH)) return deepMerge(DEFAULTS, {})
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8')
    // `telemetry` was removed (WOR-181): a config written before that still holds it, with its install ID. It is
    // dropped here, so it never reaches `config list` or a bug report, and leaves the file with the next save.
    const { telemetry: _removedTelemetry, ...parsed } = JSON.parse(raw)
    return deepMerge(DEFAULTS, parsed)
  } catch {
    return deepMerge(DEFAULTS, {})
  }
}

/**
 * The retention setting for the code that removes data. Unlike `readConfig`, a file that can't be read or understood is
 * not the defaults: it is `unreadable`, and nothing is removed, so a person who chose to keep everything is never
 * caught out by a damaged file. No file at all is a fresh install, which has the defaults.
 */
export function readRetentionPolicy(): RetentionPolicy {
  if (!fs.existsSync(CONFIG_PATH)) return { status: 'ok', retention: { ...DEFAULT_RETENTION } }
  try {
    return retentionPolicyOf(JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')))
  } catch {
    return { status: 'unreadable', reason: 'the config file could not be read' }
  }
}

export function writeConfig(config: WorkscribeConfig): void {
  // Previously safe to assume — writeConfig was only ever called after `init`
  // created the data directories, or by `config set` where init had already
  // run. CLI-05's fallback can now call this as the very first filesystem
  // touch for a user who skipped init entirely, so it can't assume the dir exists.
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true, mode: 0o700 })
  // Written beside the config and renamed over it, so a capture process reading while it is saved sees the old file
  // or the new one, never half of it: a half-written config reads as the defaults, with no folder excluded
  const temporaryPath = `${CONFIG_PATH}.${process.pid}.tmp`
  fs.writeFileSync(temporaryPath, JSON.stringify(config, null, 2), { encoding: 'utf-8', mode: 0o600 })
  fs.renameSync(temporaryPath, CONFIG_PATH)
  // Enforce permissions on existing files (mode only applies on creation above)
  try {
    fs.chmodSync(CONFIG_PATH, 0o600)
  } catch {
    /* ignore */
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
  // structuredClone, not a shallow spread — any key overrides doesn't touch (e.g. a config file written before a
  // newer top-level key existed) must still be an independent copy, not a shared reference back into the caller's
  // `defaults` object. A shallow spread here previously let any caller that mutates a nested field on the returned
  // config silently corrupt the module-level DEFAULTS singleton for the rest of the process.
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
