import path from 'path'
import { Command } from 'commander'
import chalk from 'chalk'
import { getRepoContext } from '../capture/git'
import { currentDirectory } from '../utils/working-directory'
import { readConfig } from '../config'
import { formatDuration, timeAgo } from '../utils/format'
import { log } from '../utils/logger'
import { getFileDetails, type FileSpan } from './context-file'
import { lookUpFileThread, lookUpProjectThread } from './context-threads'
import { threadViewOf, type ContextView, type WorkSpan } from './context-view'
import type { FileDetails } from '../summary/file-details'
import type { ThreadContext } from '../summary/thread-context'

/** The first version of the `context --json` document; the fields before it are kept exactly as they were. */
export const CONTEXT_SCHEMA_VERSION = 1

export interface SessionContextJson extends WorkSpan {
  timeAgo: string
  summary: string | null
  schemaVersion: number
  // Added after the first fields; an answer always has them now (before WOR-151 an old session's answer had null)
  thread: ThreadContext['thread']
  block: ThreadContext['block']
  alongside: ThreadContext['alongside']
}

function toContextJson(view: ContextView): SessionContextJson {
  return {
    repoName: view.repoName,
    date: view.date,
    startedAt: view.startedAt,
    endedAt: view.endedAt,
    timeAgo: timeAgo(view.startedAt),
    durationMinutes: view.durationMinutes,
    branch: view.branch,
    eventCount: view.eventCount,
    summary: view.summary,
    schemaVersion: CONTEXT_SCHEMA_VERSION,
    thread: view.threaded.thread,
    block: view.threaded.block,
    alongside: view.threaded.alongside,
  }
}

/** `context --file --json`: the answer, plus what it says about this file (`file` is null without saves of it). */
function toFileContextJson(view: ContextView, filePath: string): SessionContextJson & { file: FileDetails | null } {
  const span: FileSpan = { events: view.events, branch: view.branch, startedAt: view.startedAt, endedAt: view.endedAt }
  return { ...toContextJson(view), file: getFileDetails(filePath, span) }
}

function printContext(view: ContextView, heading: string): void {
  log.plain('')
  log.plain(`  ${chalk.bold(heading)}: ${chalk.cyan(timeAgo(view.startedAt))}`)
  log.plain('')
  log.plain(`  Date     ${view.date}`)
  log.plain(`  Duration ${formatDuration(view.durationMinutes)}`)
  if (view.branch) log.plain(`  Branch   ${chalk.dim(view.branch)}`)
  log.plain(`  Events   ${view.eventCount}`)
  const alongside = view.threaded.alongside.map((other) => other.repoName ?? 'elsewhere')
  if (alongside.length > 0) log.plain(`  Alongside ${chalk.dim(alongside.join(', '))}`)

  log.plain('')
  for (const line of view.summary.split('\n')) {
    log.plain(`  ${line}`)
  }

  log.plain('')
}

function printNothing(isJson: boolean, message: string): void {
  if (isJson) log.plain(JSON.stringify(null))
  else log.plain(`  ${message}`)
}

function runFileContext(file: string, isJson: boolean): void {
  const filePath = path.normalize(file)
  const answer = lookUpFileThread(filePath)
  if (!answer) {
    printNothing(isJson, `No recent work found touching ${filePath}`)
    return
  }
  const view = threadViewOf(answer)
  if (isJson) log.plain(JSON.stringify(toFileContextJson(view, filePath)))
  else printContext(view, `Last worked on ${path.basename(filePath)}`)
}

function runRepoContext(isJson: boolean): void {
  const repo = getRepoContext(currentDirectory(), readConfig())
  if (!repo.repoName) {
    printNothing(isJson, 'Not in a git repository. Run workscribe context from a project directory.')
    return
  }
  const answer = repo.project ? lookUpProjectThread(repo.project.identity) : null
  if (!answer) {
    printNothing(isJson, `No recent work found for ${repo.repoName}`)
    return
  }
  const view = threadViewOf(answer)
  if (isJson) log.plain(JSON.stringify(toContextJson(view)))
  else printContext(view, `Last worked on ${repo.repoName}`)
}

export function registerContext(program: Command): void {
  program
    .command('context')
    .description('Show the last work on the current repo')
    .option('--file <path>', 'narrow to the last work that touched this file')
    .option('--json', 'output as JSON instead of formatted text — null when nothing is found')
    .action((opts) => {
      if (opts.file) runFileContext(opts.file, Boolean(opts.json))
      else runRepoContext(Boolean(opts.json))
    })
}
