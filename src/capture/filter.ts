import type { EventRow } from '../db/types'
import { isWorkscribeOnlyCommand } from './workscribe-command'
import { commandSteps, isGlueStep } from './command-steps'

function normalizeForFilter(cmd: string): string {
  return cmd.trim().replace(/\s+/g, ' ')
}

function isIgnoredStep(step: string, ignoreList: string[]): boolean {
  const normalized = normalizeForFilter(step)
  return ignoreList.includes(normalized) || ignoreList.includes(normalized.split(' ')[0])
}

/**
 * Returns true if the command should be dropped (noise / ignore list).
 *
 * The ignore list applies to each step of a compound command: `cd app && npm test` is kept because
 * `npm test` is real work, while `cd app && ls` is dropped. A step that does nothing on its own (`cd`,
 * `echo`) can't keep a command, but a command made only of such steps is dropped only if one of them is
 * on the ignore list — so `echo hi` on its own is still captured, as before.
 */
export function shouldFilter(command: string, ignoreList: string[]): boolean {
  const normalized = normalizeForFilter(command)
  if (!normalized) return true

  // Workscribe's own commands — always excluded, not user-configurable. Checked on the raw command so
  // compound ones an agent runs are caught too, while `workscribe note "$(npm test)"` still counts as work.
  if (isWorkscribeOnlyCommand(command)) return true

  const normalizedIgnore = ignoreList.map(normalizeForFilter)
  if (normalizedIgnore.includes(normalized)) return true

  const steps = commandSteps(command)
  const isQuiet = (step: string): boolean => isIgnoredStep(step, normalizedIgnore) || isGlueStep(step)
  return steps.every(isQuiet) && steps.some((step) => isIgnoredStep(step, normalizedIgnore))
}

/**
 * Returns true if this command is a duplicate of the last event (same command + same cwd within the dedup
 * window). Takes the command as it will be stored — redacted and bounded — and compares whitespace-collapsed
 * forms, so a multi-line or redacted command matches its stored row.
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
  return (
    normalizeForFilter(lastEvent.command) === normalizeForFilter(command) &&
    lastEvent.cwd === cwd &&
    now - lastTime < dedupWindowMs
  )
}
