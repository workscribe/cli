import os from 'os'
import path from 'path'
import { Command } from 'commander'
import chalk from 'chalk'
import { readConfig, writeConfig, type WorkscribeConfig } from '../config'
import { getDb } from '../db'
import { countEventsUnderFolder } from '../db/path-events'
import { canonicalPath, isSameExcludedPath, toExcludedPath } from '../capture/excluded-paths'
import { currentDirectory } from '../utils/working-directory'
import { debugLog, log } from '../utils/logger'
import { fail } from './fail'

interface ExcludeOptions {
  list?: boolean
  remove?: string
}

function excludedPathsOf(config: WorkscribeConfig): string[] {
  return config.capture.excludePaths ?? []
}

function saveExcludedPaths(config: WorkscribeConfig, excludePaths: string[]): void {
  writeConfig({ ...config, capture: { ...config.capture, excludePaths } })
}

/** Whether excluding this folder would drop everything: it is the root, or the home folder. */
function coversEverything(folder: string): boolean {
  const isRoot = folder === path.parse(folder).root
  return isRoot || folder === canonicalPath(os.homedir())
}

/** The events already stored for the folder, or null when the database can't be read: they are only reported. */
function storedEventCount(folder: string): number | null {
  try {
    return countEventsUnderFolder(getDb(), folder)
  } catch (error) {
    debugLog('exclude', error)
    return null
  }
}

function listExcludedPaths(config: WorkscribeConfig): void {
  const excludedPaths = excludedPathsOf(config)
  if (excludedPaths.length === 0) {
    log.plain('No excluded paths.')
    return
  }
  for (const excludedPath of excludedPaths) log.plain(excludedPath)
}

function removeExcludedPath(config: WorkscribeConfig, input: string): void {
  const baseDirectory = currentDirectory()
  const excludedPaths = excludedPathsOf(config)
  const remaining = excludedPaths.filter((entry) => !isSameExcludedPath(entry, input, { baseDirectory }))
  if (remaining.length === excludedPaths.length) {
    log.info(`${input} is not excluded.`)
    return
  }
  saveExcludedPaths(config, remaining)
  log.success(`No longer excluded: ${chalk.cyan(toExcludedPath(input, { baseDirectory }))}`)
  log.plain(chalk.dim('  Capture there resumes with the next command.'))
}

function addExcludedPath(config: WorkscribeConfig, input: string): void {
  const baseDirectory = currentDirectory()
  const folder = toExcludedPath(input, { baseDirectory })
  if (coversEverything(folder)) {
    fail(`${folder} would stop all capture. To stop capture for a while, run \`workscribe pause\`.`)
  }
  const excludedPaths = excludedPathsOf(config)
  const isListed = excludedPaths.some((entry) => isSameExcludedPath(entry, folder, { baseDirectory }))
  if (isListed) {
    log.info(`${folder} is already excluded.`)
    return
  }
  saveExcludedPaths(config, [...excludedPaths, folder])
  log.success(`Excluded ${chalk.cyan(folder)}. Nothing in or under it is recorded from now on.`)
  const keptCount = storedEventCount(folder)
  if (keptCount) {
    const events = keptCount === 1 ? '1 event' : `${keptCount} events`
    log.plain(
      chalk.dim(
        `  ${events} already recorded there ${keptCount === 1 ? 'was' : 'were'} kept; this command doesn't delete them.`
      )
    )
  }
}

export function registerExclude(program: Command): void {
  program
    .command('exclude [path]')
    .description('Never record anything in a directory (or list or remove excluded ones)')
    .option('--list', 'show the excluded directories')
    .option('--remove <path>', 'stop excluding a directory')
    .action((input: string | undefined, options: ExcludeOptions) => {
      const config = readConfig()
      if (options.list) return listExcludedPaths(config)
      if (options.remove) return removeExcludedPath(config, options.remove)
      if (!input) fail('Give a directory to exclude (workscribe exclude <path>), or use --list or --remove <path>.')
      addExcludedPath(config, input)
    })
}
