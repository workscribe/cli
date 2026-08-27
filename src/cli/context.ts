import path from 'path'
import { Command } from 'commander'
import chalk from 'chalk'
import { getRecentSessionsByRepo, getLastSessionTouchingFile, getSessionBranch } from '../db'
import { getGitContext } from '../capture/git'
import { formatDuration, timeAgo } from '../utils/format'
import { log } from '../utils/logger'
import type { SessionRow } from '../db/types'

function printSessionContext(session: SessionRow, heading: string): void {
  const ago = timeAgo(session.started_at)
  const branch = getSessionBranch(session.id)
  const durationMinutes = (new Date(session.ended_at).getTime() - new Date(session.started_at).getTime()) / 60000

  log.plain('')
  log.plain(`  ${chalk.bold(heading)}: ${chalk.cyan(ago)}`)
  log.plain('')
  log.plain(`  Date     ${session.date}`)
  log.plain(`  Duration ${formatDuration(durationMinutes)}`)
  if (branch) log.plain(`  Branch   ${chalk.dim(branch)}`)
  log.plain(`  Events   ${session.event_count}`)

  if (session.summary) {
    log.plain('')
    for (const line of session.summary.split('\n')) {
      log.plain(`  ${line}`)
    }
  } else {
    log.plain('')
    log.plain(chalk.dim(`  No summary — run: workscribe summary ${session.date}`))
  }

  log.plain('')
}

export function registerContext(program: Command): void {
  program
    .command('context')
    .description('Show the last session for the current repo')
    .option('--file <path>', 'narrow to last session that touched this file')
    .action((opts) => {
      if (opts.file) {
        const normalizedFile = path.normalize(opts.file)
        const session = getLastSessionTouchingFile(normalizedFile)
        if (!session) {
          log.plain(`  No sessions found touching ${normalizedFile}`)
          return
        }
        printSessionContext(session, `Last session touching ${path.basename(normalizedFile)}`)
        return
      }

      const { repoName } = getGitContext(process.cwd())
      if (!repoName) {
        log.plain('  Not in a git repository. Run workscribe context from a project directory.')
        return
      }

      const sessions = getRecentSessionsByRepo(repoName, 1)
      if (sessions.length === 0) {
        log.plain(`  No sessions found for ${repoName}`)
        return
      }

      printSessionContext(sessions[0], `Last session on ${repoName}`)
    })
}
