import type { EventRow } from '../db/types'

function normalizeForFilter(cmd: string): string {
  return cmd.trim().replace(/\s+/g, ' ')
}

// Always filtered regardless of user config — internal tool noise
const BUILTIN_IGNORE = new Set(['workscribe'])

/**
 * Returns true if the command should be dropped (noise / ignore list).
 */
export function shouldFilter(command: string, ignoreList: string[]): boolean {
  const normalized = normalizeForFilter(command)
  if (!normalized) return true

  const baseCmd = normalized.split(' ')[0]

  // Built-in filter: always excluded, not user-configurable
  if (BUILTIN_IGNORE.has(baseCmd)) return true

  // User-configurable ignore list
  const normalizedIgnore = ignoreList.map(normalizeForFilter)
  if (normalizedIgnore.includes(normalized)) return true
  if (normalizedIgnore.includes(baseCmd)) return true

  return false
}

/**
 * Returns true if this command is a duplicate of the last event
 * (same command + same cwd within the dedup window).
 */
export function isDuplicate(
  command: string,
  cwd: string,
  lastEvent: Pick<EventRow, 'command' | 'cwd' | 'captured_at'> | undefined,
  dedupWindowMs = 5000,
  now = Date.now()
): boolean {
  if (!lastEvent) return false
  const lastTime = new Date(lastEvent.captured_at).getTime()
  return lastEvent.command === normalizeForFilter(command) && lastEvent.cwd === cwd && now - lastTime < dedupWindowMs
}
