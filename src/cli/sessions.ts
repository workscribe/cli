import { Command } from 'commander'
import chalk from 'chalk'
import { getOrBuildSessions } from '../sessions/detector'
import { log } from '../utils/logger'
import { todayDate, parseDate, formatDate, formatDuration } from '../utils/format'
import { registerSummarySet } from './session-summary'
import { readConfig } from '../config'
import { locationContextFrom, repoCwd } from '../summary/payload'
import { buildSessionsJson, sessionToJson } from '../summary/contract/build'
import { getCommitsInWindow, getOthersSubjects, getRepoRoot, getUserEmail } from '../summary/git-commits'
import { memoize } from '../utils/memoize'
import type { Session } from '../sessions/detector'
import type { SessionGitInfo } from '../summary/contract/types'

/**
 * Looks up git facts for the session's repo — empty outside a git repo or when git fails.
 * Repo roots and emails are cached for the run so a day of sessions in one repo asks git once.
 */
function createSessionGitLookup(): (session: Session) => SessionGitInfo {
  const repoRootOf = memoize(getRepoRoot)
  const emailOf = memoize(getUserEmail)
  const othersSubjectsOf = memoize((repoPath) => getOthersSubjects(repoPath, emailOf(repoPath)))
  return (session) => {
    const cwd = repoCwd(session)
    const repoPath = cwd ? repoRootOf(cwd) : null
    if (!repoPath) return { repoPath: null, commits: [], othersSubjects: [] }
    const author = emailOf(repoPath)
    const commits = getCommitsInWindow({ repoRoot: repoPath, since: session.startedAt, until: session.endedAt, author })
    return { repoPath, commits, othersSubjects: othersSubjectsOf(repoPath) }
  }
}

function printSessionsJson(date: string, sessions: Session[]): void {
  const config = readConfig()
  const options = {
    location: locationContextFrom(config),
    includeCategories: config.summary?.includeCategories ?? [],
  }
  const lookupGit = createSessionGitLookup()
  const sessionJsons = sessions.map((session) => sessionToJson(session, { ...options, git: lookupGit(session) }))
  log.plain(JSON.stringify(buildSessionsJson(date, sessionJsons)))
}

export function registerSessions(program: Command): void {
  const sessionsCommand = program
    .command('sessions')
    .description('List detected work sessions')
    .option('--date <YYYY-MM-DD>', 'date to show sessions for (default: today)')
    .option('--json', 'output the versioned JSON contract (sessions with events, notes and commits)')
    .action((options) => {
      let date = todayDate()
      if (options.date) {
        try {
          date = parseDate(options.date)
        } catch (error) {
          log.error((error as Error).message)
          process.exit(1)
        }
      }

      const sessions = getOrBuildSessions(date)

      if (options.json) {
        printSessionsJson(date, sessions)
        return
      }

      if (sessions.length === 0) {
        log.plain(`No sessions detected for ${date}`)
        return
      }

      log.plain('')
      log.plain(chalk.bold(`  Sessions for ${date}  (${sessions.length} session${sessions.length > 1 ? 's' : ''})`))
      log.plain('')

      for (const session of sessions) {
        const start = formatDate(session.startedAt)
        const end = formatDate(session.endedAt)
        const duration = formatDuration(session.durationMinutes)
        const repo = session.repoName ? chalk.cyan(session.repoName) : chalk.gray('no repo')
        log.plain(
          `  ${chalk.dim(start)} – ${chalk.dim(end)}  ${repo}  ${chalk.dim(duration)}  ${chalk.dim(session.eventCount + ' events')}`
        )

        for (const event of session.events) {
          if (event.category === 'note') {
            let text = ''
            try {
              text = (JSON.parse(event.metadata ?? '{}') as { text?: string }).text ?? ''
            } catch {
              /* ignore malformed metadata */
            }
            if (text) log.plain(`    ${chalk.yellow('note')}  ${chalk.dim(text)}`)
          }
        }
      }

      log.plain('')
    })

  registerSummarySet(sessionsCommand)
}
