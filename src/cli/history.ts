import { Command } from 'commander'
import chalk from 'chalk'
import { getDb } from '../db'
import { getProjectEventsSince } from '../db/history'
import { getRepoContext } from '../capture/git'
import { readConfig } from '../config'
import { currentDirectory } from '../utils/working-directory'
import { localDateOf, formatDate, formatWeekday } from '../utils/format'
import { parseSince } from '../utils/since'
import { log } from '../utils/logger'
import { buildHistory, type History, type HistoryEntry } from '../summary/history'
import { buildHistoryJson } from '../summary/contract/build'
import { requireThreadData } from './thread-day'
import { fail } from './fail'

const DEFAULT_SINCE = '24h'

function printNothing(isJson: boolean, message: string): void {
  if (isJson) log.plain(JSON.stringify(null))
  else log.plain(`  ${message}`)
}

function printEntry(entry: HistoryEntry): void {
  const branch = entry.branch ? chalk.dim(` [${entry.branch}]`) : ''
  const failed = entry.exitCode !== null && entry.exitCode !== 0 ? chalk.red(` ✗${entry.exitCode}`) : ''
  const source = entry.source === 'shell' ? '' : chalk.dim(` (${entry.source})`)
  const command = entry.isGit ? entry.command : chalk.dim(entry.command)
  log.plain(`  ${chalk.dim(formatDate(entry.capturedAt))}  ${command}${branch}${source}${failed}`)
  for (const move of entry.moves) log.plain(`      ${chalk.cyan('→')} ${move}`)
  for (const pointer of entry.recovery) log.plain(`      ${chalk.dim(`to look back: ${pointer}`)}`)
}

function printHistory(repo: string, history: History): void {
  log.plain('')
  log.plain(chalk.bold(`  History of ${repo}`))
  const dates = new Set(history.entries.map((entry) => localDateOf(entry.capturedAt)))
  let currentDate = ''
  for (const entry of history.entries) {
    const date = localDateOf(entry.capturedAt)
    if (dates.size > 1 && date !== currentDate) {
      log.plain('')
      log.plain(chalk.bold(`  ${formatWeekday(date)}`))
    }
    currentDate = date
    printEntry(entry)
  }
  for (const line of history.leftStashed) log.plain(`  ${chalk.cyan('→')} ${line}`)
  log.plain('')
}

interface HistoryOptions {
  since: string
  all?: boolean
  json?: boolean
}

/** The window's start as an ISO timestamp; exits with the reason when `--since` isn't one. */
function resolveSince(input: string): string {
  try {
    return parseSince(input)
  } catch (error) {
    return fail((error as Error).message)
  }
}

function showHistory(repo: { name: string; identity: string }, sinceIso: string, options: HistoryOptions): void {
  const rows = getProjectEventsSince(getDb(), repo.identity, sinceIso)
  const history = buildHistory(rows, { all: Boolean(options.all) })
  if (options.json) log.plain(JSON.stringify(buildHistoryJson(repo.name, sinceIso, history)))
  else if (history.entries.length === 0)
    log.plain(`  No ${options.all ? '' : 'git '}commands in ${repo.name} since ${options.since}`)
  else printHistory(repo.name, history)
}

function runHistory(options: HistoryOptions): void {
  const sinceIso = resolveSince(options.since)
  requireThreadData()

  const repo = getRepoContext(currentDirectory(), readConfig())
  if (!repo.repoName) {
    printNothing(Boolean(options.json), 'Not in a git repository. Run workscribe history from a project directory.')
  } else if (!repo.project) {
    printNothing(Boolean(options.json), `No history yet for ${repo.repoName}`)
  } else {
    showHistory({ name: repo.repoName, identity: repo.project.identity }, sinceIso, options)
  }
}

export function registerHistory(program: Command): void {
  program
    .command('history')
    .description("Show the repo's git commands and branch moves, with where to look to get work back")
    .option('--since <when>', 'how far back: 6h, 2d, 1w or a date (YYYY-MM-DD)', DEFAULT_SINCE)
    .option('--all', "also list the repo's commands that aren't git")
    .option('--json', 'output the versioned JSON contract (no commands) — null when there is no repo')
    .action(runHistory)
}
