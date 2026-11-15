// What `history` shows: a repo's commands in order, each with the branch moves it made in plain language and where
// to look to get back what it changed. Pure: it reads stored (already redacted) commands, so past days work too.
import { commandSteps, simpleCommandOf } from '../capture/command-steps'
import { parseGitInvocation } from '../normalize/git-invocation'
import { describeEventMoves } from '../ai/engines/template/branch-moves'
import { agentNameOf } from '../ai/engines/template/agents'
import { eventRowToPayload } from './payload'
import { recoveryPointersOf } from './recovery'
import type { EventRow } from '../db/types'

export interface HistoryEntry {
  capturedAt: string
  /** The branch after the command, as captured */
  branch: string | null
  /** `shell`, `editor`, or the coding agent's name */
  source: string
  isGit: boolean
  exitCode: number | null
  /** The stored, redacted command — for the text view only, never the JSON contract */
  command: string
  moves: string[]
  recovery: string[]
}

export interface History {
  entries: HistoryEntry[]
  /** Stashes nobody restored in the window: they are still in `git stash list` */
  leftStashed: string[]
}

const EDITOR_SOURCE = 'vscode'

/** Whether any step of the command is a git command: `git -C dir log`, compound and agent commands count. */
export function isGitCommand(command: string): boolean {
  return commandSteps(command).some((step) => parseGitInvocation(simpleCommandOf(step)) !== null)
}

function sourceLabel(source: string | null): string {
  if (source === null) return 'shell'
  if (source === EDITOR_SOURCE) return 'editor'
  return agentNameOf(source) ?? source
}

/**
 * The repo's history from its events, oldest first. Moves are read over every event in the window — which branch
 * you were on and which stashes wait depend on all of them — and `all` only decides which events are listed:
 * git commands alone, or the repo's other commands too.
 */
export function buildHistory(rows: EventRow[], { all }: { all: boolean }): History {
  const payloads = rows.map(eventRowToPayload)
  const { perEvent, leftStashed } = describeEventMoves(payloads)
  const entries = rows.flatMap((row, index): HistoryEntry[] => {
    const isGit = isGitCommand(row.command)
    if (!isGit && !all) return []
    return [
      {
        capturedAt: row.captured_at,
        branch: row.branch,
        source: sourceLabel(row.source),
        isGit,
        exitCode: row.exit_code,
        command: row.command,
        moves: perEvent[index].map((move) => move.line),
        recovery: recoveryPointersOf(payloads[index].gitMoves ?? []),
      },
    ]
  })
  return { entries, leftStashed: leftStashed.map((stash) => stash.line) }
}
