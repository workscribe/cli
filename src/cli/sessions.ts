import { Command } from 'commander'
import chalk from 'chalk'
import { log } from '../utils/logger'
import { todayDate, parseDate, formatDate, formatDuration } from '../utils/format'
import { registerSummarySet } from './session-summary'
import { loadDayThreads, requireThreadData } from './thread-day'
import { fail } from './fail'
import { readConfig } from '../config'
import { locationContextFrom, sessionLocation, threadRepoCwd, type LocationContext } from '../summary/payload'
import { blockToJson, buildSessionsJson, threadToJson } from '../summary/contract/build'
import { collectNotes } from '../summary/contract/utils'
import { getCommitsInWindow, getOthersSubjects, getRepoRoot, getUserEmail } from '../summary/git-commits'
import { toActiveMinutes } from '../sessions/blocks'
import { memoize } from '../utils/memoize'
import type { DayBlock, DayThread } from '../db/day-threads'
import type { SessionGitInfo } from '../summary/contract/types'

/**
 * Looks up git facts for the thread's repo — empty outside a git repo or when git fails.
 * Repo roots and emails are cached for the run so a day of threads in one repo asks git once.
 */
function createThreadGitLookup(): (thread: DayThread) => SessionGitInfo {
  const repoRootOf = memoize(getRepoRoot)
  const emailOf = memoize(getUserEmail)
  const othersSubjectsOf = memoize((repoPath) => getOthersSubjects(repoPath, emailOf(repoPath)))
  return (thread) => {
    const cwd = threadRepoCwd(thread.events)
    const repoPath = cwd ? repoRootOf(cwd) : null
    if (!repoPath) return { repoPath: null, commits: [], othersSubjects: [] }
    const author = emailOf(repoPath)
    const commits = getCommitsInWindow({ repoRoot: repoPath, since: thread.startedAt, until: thread.endedAt, author })
    return { repoPath, commits, othersSubjects: othersSubjectsOf(repoPath) }
  }
}

function printSessionsJson(date: string, blocks: DayBlock[]): void {
  const config = readConfig()
  const options = {
    location: locationContextFrom(config),
    includeCategories: config.summary?.includeCategories ?? [],
  }
  const lookupGit = createThreadGitLookup()
  const sessionJsons = blocks.flatMap((block) =>
    block.threads.map((thread) => threadToJson(thread, block, { ...options, git: lookupGit(thread) }))
  )
  log.plain(JSON.stringify(buildSessionsJson(date, blocks.map(blockToJson), sessionJsons)))
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

function printThread(thread: DayThread, location: LocationContext): void {
  const name = sessionLocation(thread, location)
  const project = name ? chalk.cyan(name) : chalk.gray('no repo')
  const active = formatDuration(toActiveMinutes(thread.activeSlots))
  log.plain(`    ${project}  ${chalk.dim(`${active} active`)}  ${chalk.dim(plural(thread.eventCount, 'event'))}`)
  for (const note of collectNotes(thread.events)) log.plain(`      ${chalk.yellow('note')}  ${chalk.dim(note)}`)
}

function printBlocks(date: string, blocks: DayBlock[]): void {
  if (blocks.length === 0) {
    log.plain(`No sessions detected for ${date}`)
    return
  }
  const threadCount = blocks.reduce((total, block) => total + block.threads.length, 0)
  const location = locationContextFrom(readConfig())
  log.plain('')
  log.plain(
    chalk.bold(`  Sessions for ${date}  (${plural(threadCount, 'thread')} in ${plural(blocks.length, 'block')})`)
  )
  for (const block of blocks) {
    const span = `${formatDate(block.startedAt)} – ${formatDate(block.endedAt)}`
    log.plain('')
    log.plain(`  ${chalk.dim(span)}  ${chalk.dim(`${formatDuration(toActiveMinutes(block.activeSlots))} active`)}`)
    for (const thread of block.threads) printThread(thread, location)
  }
  log.plain('')
}

function parseDateOption(value: string | undefined): string {
  if (!value) return todayDate()
  try {
    return parseDate(value)
  } catch (error) {
    fail((error as Error).message)
  }
}

export function registerSessions(program: Command): void {
  const sessionsCommand = program
    .command('sessions')
    .description("List the day's work: each block, and each project's thread inside it")
    .option('--date <YYYY-MM-DD>', 'date to show sessions for (default: today)')
    .option('--json', 'output the versioned JSON contract (threads with events, notes and commits, and their blocks)')
    .action((options) => {
      const date = parseDateOption(options.date)
      requireThreadData()
      const blocks = loadDayThreads(date)
      if (options.json) {
        printSessionsJson(date, blocks)
        return
      }
      printBlocks(date, blocks)
    })

  registerSummarySet(sessionsCommand)
}
