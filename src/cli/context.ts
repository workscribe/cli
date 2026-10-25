import path from 'path'
import { Command } from 'commander'
import chalk from 'chalk'
import {
  getRecentSessionsByRepo,
  getLastSessionTouchingFile,
  getSessionBranch,
  getSessionSummaries,
  getEventsBySessionId,
} from '../db'
import { getGitContext } from '../capture/git'
import { readConfig } from '../config'
import { formatDuration, timeAgo } from '../utils/format'
import { log } from '../utils/logger'
import { describeSession } from '../ai/engines/template/describe'
import { toBulletList } from '../ai/engines/template/utils'
import { sessionToPayload, locationContextFrom } from '../summary/payload'
import { formatSessionHeading } from '../summary/heading'
import { sessionKey, pickBestSummary } from '../summary/store'
import type { SessionRow } from '../db/types'
import type { Session } from '../sessions/detector'

export interface SessionContextJson {
  date: string
  startedAt: string
  endedAt: string
  timeAgo: string
  durationMinutes: number
  branch: string | null
  eventCount: number
  summary: string | null
}

function sessionMinutes(session: SessionRow): number {
  return (new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 60000
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    date: row.date,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    repoName: row.repo_name,
    durationMinutes: sessionMinutes(row),
    eventCount: row.event_count,
    summary: null,
    events: getEventsBySessionId(row.id),
  }
}

/** A template summary rendered from the session's current events — templates are never stored, so it can't go stale. */
function renderTemplateSummary(row: SessionRow): string {
  const config = readConfig()
  const payload = sessionToPayload(toSession(row), row.date, locationContextFrom(config))
  const bullets = describeSession(payload, config.summary?.includeCategories ?? [])
  return `${formatSessionHeading(payload)}\n${toBulletList(bullets)}`
}

/** The best stored summary (skill > AI > template), or a template one so the VS Code status bar is never empty. */
function resolveContextSummary(row: SessionRow): string {
  return pickBestSummary(getSessionSummaries(sessionKey(row.repo_name, row.started_at))) ?? renderTemplateSummary(row)
}

function toContextJson(session: SessionRow): SessionContextJson {
  return {
    date: session.date,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    timeAgo: timeAgo(session.started_at),
    durationMinutes: sessionMinutes(session),
    branch: getSessionBranch(session.id),
    eventCount: session.event_count,
    summary: resolveContextSummary(session),
  }
}

function printSessionContext(session: SessionRow, heading: string): void {
  const ago = timeAgo(session.started_at)
  const branch = getSessionBranch(session.id)
  const durationMinutes = sessionMinutes(session)

  log.plain('')
  log.plain(`  ${chalk.bold(heading)}: ${chalk.cyan(ago)}`)
  log.plain('')
  log.plain(`  Date     ${session.date}`)
  log.plain(`  Duration ${formatDuration(durationMinutes)}`)
  if (branch) log.plain(`  Branch   ${chalk.dim(branch)}`)
  log.plain(`  Events   ${session.event_count}`)

  log.plain('')
  for (const line of resolveContextSummary(session).split('\n')) {
    log.plain(`  ${line}`)
  }

  log.plain('')
}

export function registerContext(program: Command): void {
  program
    .command('context')
    .description('Show the last session for the current repo')
    .option('--file <path>', 'narrow to last session that touched this file')
    .option('--json', 'output as JSON instead of formatted text — null when no session is found')
    .action((opts) => {
      if (opts.file) {
        const normalizedFile = path.normalize(opts.file)
        const session = getLastSessionTouchingFile(normalizedFile)
        if (!session) {
          if (opts.json) log.plain(JSON.stringify(null))
          else log.plain(`  No sessions found touching ${normalizedFile}`)
          return
        }
        if (opts.json) {
          log.plain(JSON.stringify(toContextJson(session)))
          return
        }
        printSessionContext(session, `Last session touching ${path.basename(normalizedFile)}`)
        return
      }

      const { repoName } = getGitContext(process.cwd(), null, readConfig().git.qualifyRepoName)
      if (!repoName) {
        if (opts.json) log.plain(JSON.stringify(null))
        else log.plain('  Not in a git repository. Run workscribe context from a project directory.')
        return
      }

      const sessions = getRecentSessionsByRepo(repoName, 1)
      if (sessions.length === 0) {
        if (opts.json) log.plain(JSON.stringify(null))
        else log.plain(`  No sessions found for ${repoName}`)
        return
      }

      if (opts.json) {
        log.plain(JSON.stringify(toContextJson(sessions[0])))
        return
      }
      printSessionContext(sessions[0], `Last session on ${repoName}`)
    })
}
