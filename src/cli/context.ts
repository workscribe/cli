import path from 'path'
import { Command } from 'commander'
import chalk from 'chalk'
import { getRecentSessionsForRepo, getLastSessionTouchingFile } from '../db'
import { getRepoContext } from '../capture/git'
import { formatRepoName } from '../capture/repo-name'
import { currentDirectory, rootForms } from '../utils/working-directory'
import { readConfig } from '../config'
import { formatDuration, timeAgo } from '../utils/format'
import { log } from '../utils/logger'
import { getFileDetails, groupDayOfLatestSave, type FileSpan } from './context-file'
import { lookUpFileThread, lookUpProjectThread, type ThreadLookup } from './context-threads'
import { sessionViewOf, threadViewOf, type ContextView, type WorkSpan } from './context-view'
import type { FileDetails } from '../summary/file-details'
import type { ThreadContext } from '../summary/thread-context'

/** The first version of the `context --json` document; the fields before it are kept exactly as they were. */
export const CONTEXT_SCHEMA_VERSION = 1

export interface SessionContextJson extends WorkSpan {
  timeAgo: string
  summary: string | null
  schemaVersion: number
  /** Null when the answer came from the old sessions (data not upgraded yet, or no thread found) */
  thread: ThreadContext['thread'] | null
  block: ThreadContext['block'] | null
  alongside: ThreadContext['alongside'] | null
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
    thread: view.threaded?.thread ?? null,
    block: view.threaded?.block ?? null,
    alongside: view.threaded?.alongside ?? null,
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
  const alongside = view.threaded?.alongside.map((other) => other.repoName ?? 'elsewhere') ?? []
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

/** The old path for a file: the latest session that saved it, after grouping its day unless the lock already said no. */
function fileSessionView(filePath: string, lookup: ThreadLookup): ContextView | null {
  // The thread path already waited for the lock and gave up: answer from the sessions as they are, never wait twice
  const isLocked = lookup.kind === 'fallback' && lookup.isLocked
  if (!isLocked) groupDayOfLatestSave(filePath)
  const session = getLastSessionTouchingFile(filePath)
  return session ? sessionViewOf(session) : null
}

function runFileContext(file: string, isJson: boolean): void {
  const filePath = path.normalize(file)
  const lookup = lookUpFileThread(filePath)
  const view = lookup.kind === 'found' ? threadViewOf(lookup.answer) : fileSessionView(filePath, lookup)
  if (!view) {
    printNothing(isJson, `No sessions found touching ${filePath}`)
    return
  }
  if (isJson) log.plain(JSON.stringify(toFileContextJson(view, filePath)))
  else printContext(view, `Last session touching ${path.basename(filePath)}`)
}

/** The old path for a repo: its latest session, under its configured name or — inside its own tree — the other form. */
function repoSessionView(repo: ReturnType<typeof getRepoContext>, directory: string): ContextView | null {
  const config = readConfig()
  // Also finds sessions stored under the other name form — captured before the setting changed, or before WOR-118
  const otherRepoName = repo.remote ? formatRepoName(repo.remote, !config.git.qualifyRepoName) : null
  const roots = repo.root ? rootForms(directory, repo.root) : []
  const [session] = getRecentSessionsForRepo({ repoName: repo.repoName ?? '', otherRepoName, roots }, 1)
  return session ? sessionViewOf(session) : null
}

function runRepoContext(isJson: boolean): void {
  const directory = currentDirectory()
  const repo = getRepoContext(directory, readConfig())
  if (!repo.repoName) {
    printNothing(isJson, 'Not in a git repository. Run workscribe context from a project directory.')
    return
  }
  const lookup: ThreadLookup = repo.project
    ? lookUpProjectThread(repo.project.identity)
    : { kind: 'fallback', isLocked: false }
  const view = lookup.kind === 'found' ? threadViewOf(lookup.answer) : repoSessionView(repo, directory)
  if (!view) {
    printNothing(isJson, `No sessions found for ${repo.repoName}`)
    return
  }
  if (isJson) log.plain(JSON.stringify(toContextJson(view)))
  else printContext(view, `Last session on ${repo.repoName}`)
}

export function registerContext(program: Command): void {
  program
    .command('context')
    .description('Show the last session for the current repo')
    .option('--file <path>', 'narrow to last session that touched this file')
    .option('--json', 'output as JSON instead of formatted text — null when no session is found')
    .action((opts) => {
      if (opts.file) runFileContext(opts.file, Boolean(opts.json))
      else runRepoContext(Boolean(opts.json))
    })
}
