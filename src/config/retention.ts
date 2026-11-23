// How long captured data is kept (WOR-179). Pure: the file reading is `readRetentionPolicy` in `index.ts`. Removal is the
// one thing here that deletes data, so every reader of the setting asks `RetentionPolicy` and treats anything it can't
// read as "remove nothing" rather than falling back to the defaults, as the rest of the config does.

export const DEFAULT_RETENTION_DAYS = 100
// A shorter limit would make a typo (`retention.days 1`) remove nearly everything
export const MIN_RETENTION_DAYS = 7

export interface RetentionConfig {
  // Events older than this many days are removed
  days: number
  // Remove nothing, ever
  keepForever: boolean
  // Saved summaries older than this many days are removed too; null keeps them
  summaryDays: number | null
}

export const DEFAULT_RETENTION: RetentionConfig = {
  days: DEFAULT_RETENTION_DAYS,
  keepForever: false,
  summaryDays: null,
}

export const RETENTION_DAYS_KEY = 'retention.days'
export const RETENTION_KEEP_FOREVER_KEY = 'retention.keepForever'
export const RETENTION_SUMMARY_DAYS_KEY = 'retention.summaryDays'
const RETENTION_KEYS = [RETENTION_DAYS_KEY, RETENTION_KEEP_FOREVER_KEY, RETENTION_SUMMARY_DAYS_KEY]
const NO_SUMMARY_LIMIT = 'none'

export type RetentionPolicy = { status: 'ok'; retention: RetentionConfig } | { status: 'unreadable'; reason: string }

export type RetentionSettingResult = { ok: true; retention: RetentionConfig } | { ok: false; message: string }

export function isRetentionKey(key: string): boolean {
  return key === 'retention' || key.startsWith('retention.')
}

function toWholeNumber(value: string): number | null {
  return /^[1-9]\d*$/.test(value.trim()) ? Number(value.trim()) : null
}

/** Why `retention` can't be used as it is, or null. */
function retentionProblem(retention: RetentionConfig): string | null {
  if (!Number.isInteger(retention.days) || retention.days < MIN_RETENTION_DAYS) {
    return `retention.days must be a whole number of at least ${MIN_RETENTION_DAYS}`
  }
  if (typeof retention.keepForever !== 'boolean') return 'retention.keepForever must be true or false'
  const { summaryDays } = retention
  if (summaryDays === null) return null
  if (!Number.isInteger(summaryDays) || summaryDays < retention.days) {
    return `retention.summaryDays must be a whole number of at least retention.days (${retention.days}), or "${NO_SUMMARY_LIMIT}"`
  }
  return null
}

/**
 * `retention` as a config file holds it. A file that doesn't mention it has the defaults; one that does, wrongly,
 * can't be trusted, so nothing is removed until it is fixed.
 */
export function retentionPolicyOf(parsedConfig: unknown): RetentionPolicy {
  if (typeof parsedConfig !== 'object' || parsedConfig === null || Array.isArray(parsedConfig)) {
    return { status: 'unreadable', reason: 'the config file is not a JSON object' }
  }
  const stored = (parsedConfig as Record<string, unknown>).retention
  if (stored === undefined) return { status: 'ok', retention: { ...DEFAULT_RETENTION } }
  if (typeof stored !== 'object' || stored === null || Array.isArray(stored)) {
    return { status: 'unreadable', reason: 'retention in the config file is not an object' }
  }
  const retention = { ...DEFAULT_RETENTION, ...stored } as RetentionConfig
  const problem = retentionProblem(retention)
  return problem ? { status: 'unreadable', reason: problem } : { status: 'ok', retention }
}

function parseKeepForever(value: string): boolean | null {
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

function withSetting(current: RetentionConfig, key: string, value: string): RetentionConfig | string {
  if (key === RETENTION_DAYS_KEY) {
    const days = toWholeNumber(value)
    return days === null ? `${key} must be a whole number of at least ${MIN_RETENTION_DAYS}` : { ...current, days }
  }
  if (key === RETENTION_KEEP_FOREVER_KEY) {
    const keepForever = parseKeepForever(value)
    return keepForever === null ? `${key} must be true or false` : { ...current, keepForever }
  }
  if (key === RETENTION_SUMMARY_DAYS_KEY) {
    if (value.trim() === NO_SUMMARY_LIMIT) return { ...current, summaryDays: null }
    const summaryDays = toWholeNumber(value)
    return summaryDays === null
      ? `${key} must be a whole number of days, or "${NO_SUMMARY_LIMIT}" to keep summaries`
      : { ...current, summaryDays }
  }
  return `Unknown retention setting. Use ${RETENTION_KEYS.join(', ')}.`
}

/** `current` with one `retention.*` setting changed, or why it can't be. Never coerces: `retention.days ""` is an error. */
export function applyRetentionSetting(current: RetentionConfig, key: string, value: string): RetentionSettingResult {
  const changed = withSetting(current, key, value)
  if (typeof changed === 'string') return { ok: false, message: changed }
  const problem = retentionProblem(changed)
  return problem ? { ok: false, message: problem } : { ok: true, retention: changed }
}
