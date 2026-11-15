// When two capture paths saw one action, and which row stays: the pure rules the database's merge (`src/db/event-merge.ts`)
// applies. Measured by WOR-154 (`tests/fixtures/agent-hooks/README.md`); a window with no measurement says so.
import { normalizeForFilter } from './filter'
import { FAILED_EXIT_CODE } from './hooks/event'

/** The shell row came 5–8 s before the agent's event for the same command (Copilot in VS Code, WOR-154). */
export const COMMAND_MERGE_WINDOW_MS = 15_000
/** A save the agent's own write caused landed about 0.15 s after the edit (Copilot in VS Code, WOR-154). */
export const SAVE_MERGE_WINDOW_MS = 1_000
/** Two agents reporting one action: not measured; WOR-140 confirms it against a real Cursor run. */
export const AGENT_MERGE_WINDOW_MS = 5_000
/** The hook other agents re-run (Cursor imports `~/.claude/settings.json`), so its events give way to theirs. */
export const IMPORTED_HOOK_SOURCE = 'claude-code'

/**
 * What an incoming event looks for, set by capture:
 * - `shell-command`: a person's shell row, looking for the agent's row of an agent that shares the shell hook
 * - `agent-command`: an agent's command, looking for the shell row (when its terminal runs the shell hook) and, always,
 *   for the same action from another agent (`IMPORTED_HOOK_SOURCE`)
 * - `agent-edit`: an agent's edit, looking for the editor save it caused (when its editor saves) and, always, for the
 *   same edit from another agent
 * Both carry `agentSources`, every source that is an agent, so an editor's row is never mistaken for one.
 * - `editor-save`: an editor's save, looking for an agent's edit of an agent that shares the editor's saves
 */
export type EventMerge =
  | { kind: 'shell-command'; agentSources: string[] }
  | { kind: 'agent-command'; sharesShell: boolean; agentSources: string[] }
  | { kind: 'agent-edit'; sharesSaves: boolean; agentSources: string[] }
  | { kind: 'editor-save'; agentSources: string[] }

/** Whether two stored times are less than `windowMs` apart. A time that isn't a date is never within any window. */
export function isWithin(first: string, second: string, windowMs: number): boolean {
  return Math.abs(Date.parse(first) - Date.parse(second)) < windowMs
}

/** Whether `folder` is `parent` or lies inside it. The agent reports the workspace; the shell is where it `cd`'d. */
export function isInsideFolder(folder: string, parent: string): boolean {
  return folder === parent || folder.startsWith(parent.endsWith('/') ? parent : `${parent}/`)
}

/** The same command, however its whitespace fell (a shell row starts with a space). Both sides are already redacted. */
export function isSameCommand(first: string, second: string): boolean {
  return normalizeForFilter(first) === normalizeForFilter(second)
}

/**
 * One of the two is the imported hook and the other an agent of its own: the pair that is one action seen twice. An
 * editor's source (`vscode`) is no agent, so a person's save never pairs with Claude Code's edit.
 */
export function isImportedHookPair(
  firstSource: string | null,
  secondSource: string | null,
  agentSources: string[]
): boolean {
  if (firstSource === null || secondSource === null || firstSource === secondSource) return false
  if (!agentSources.includes(firstSource) || !agentSources.includes(secondSource)) return false
  return firstSource === IMPORTED_HOOK_SOURCE || secondSource === IMPORTED_HOOK_SOURCE
}

/** An exit code that says how the command ended: neither unknown nor the "failed, no code" marker. */
function isRealExitCode(exitCode: number | null): exitCode is number {
  return exitCode !== null && exitCode !== FAILED_EXIT_CODE
}

/** The code to store: the survivor's real one, else the other's real one, else what the survivor had. Never clears. */
export function mergedExitCode(survivor: number | null, other: number | null): number | null {
  if (isRealExitCode(survivor)) return survivor
  return isRealExitCode(other) ? other : survivor
}

/**
 * Whether an event right after a row from `lastSource` could be merged into it. When it can't, the ordinary duplicate
 * check still applies to that pair. When it can, the merge catches every duplicate that check would have: the same
 * command in the same folder within 5 s is inside every merge window and folder rule.
 */
export function canMergeAcrossSources(
  merge: EventMerge,
  eventSource: string | null,
  lastSource: string | null
): boolean {
  if (lastSource === eventSource) return false
  if (merge.kind === 'shell-command') return lastSource !== null && merge.agentSources.includes(lastSource)
  if (merge.kind === 'agent-command')
    return (merge.sharesShell && lastSource === null) || isImportedHookPair(eventSource, lastSource, merge.agentSources)
  return false
}
