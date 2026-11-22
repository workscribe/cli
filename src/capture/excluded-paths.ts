import fs from 'fs'
import os from 'os'
import path from 'path'
import { isInsideFolder } from './merge-rules'

// Directories the user never wants recorded (`capture.excludePaths`). Pure apart from reading the file system's
// spelling of a path: capture asks it before storing anything, so an excluded event never reaches the database.

const HOME_PREFIX = '~/'
const HOME_VARIABLE = /^\$\{?HOME\}?(?=\/|$)/
const SURROUNDING_QUOTES = /^["'`]+|["'`]+$/g
const TRAILING_SHELL_SYNTAX = /[;&|)]+$/
// `2>/path`, `>>/path`, `</path`
const REDIRECT_PREFIX = /^\d*[<>]+/
// `-I/path`, `-C/path`: a one-letter flag with its value attached
const SHORT_FLAG_PREFIX = /^-[A-Za-z](?=[/~$])/

/** Where an event happened: the folder, the file it edited, and the command it ran. */
export interface CaptureLocation {
  cwd: string
  file?: string | null
  command?: string
}

function expandHome(entry: string, homeDirectory: string): string {
  if (entry === '~') return homeDirectory
  if (entry.startsWith(HOME_PREFIX)) return path.join(homeDirectory, entry.slice(HOME_PREFIX.length))
  return entry.replace(HOME_VARIABLE, homeDirectory)
}

/**
 * The path as the file system spells it: symlinks resolved and, on a case-insensitive disk (macOS's default), the case
 * it was created with, so `~/code/CLIENT` and `~/code/client` are one folder. A path that doesn't exist, such as a file
 * an agent just deleted, is spelled through its nearest folder that does.
 */
export function canonicalPath(target: string): string {
  try {
    return fs.realpathSync.native(target)
  } catch {
    const parent = path.dirname(target)
    return parent === target ? target : path.join(canonicalPath(parent), path.basename(target))
  }
}

/**
 * An entry as the user may have written it by hand: `~` expanded, relative to the folder it is read from, no trailing
 * slash. The file system isn't asked, so most events cost no file system call.
 */
function lexicalForm(entry: string, homeDirectory: string): string {
  return path.resolve(expandHome(entry, homeDirectory))
}

/** The path `workscribe exclude` stores for what the user typed: absolute, `~` expanded, in the file system's spelling. */
export function toExcludedPath(input: string, options: { baseDirectory: string; homeDirectory?: string }): string {
  const homeDirectory = options.homeDirectory ?? os.homedir()
  const expanded = expandHome(input.trim(), homeDirectory)
  return canonicalPath(path.resolve(options.baseDirectory, expanded))
}

function isUnderAny(target: string | null | undefined, folders: string[]): boolean {
  if (!target) return false
  return folders.some((folder) => isInsideFolder(target, folder))
}

function cleanWord(word: string): string {
  return word
    .replace(SURROUNDING_QUOTES, '')
    .replace(TRAILING_SHELL_SYNTAX, '')
    .replace(REDIRECT_PREFIX, '')
    .replace(SHORT_FLAG_PREFIX, '')
}

/** What a word of a command may name: the word, and what follows a `=` (`--out=/path`). */
function pathCandidatesOf(word: string): string[] {
  const valueAfterEquals = word.includes('=') ? word.slice(word.indexOf('=') + 1) : word
  return [cleanWord(word), cleanWord(valueAfterEquals)]
}

/** Each absolute path a command names, with `~` and `$HOME` expanded and the quotes, redirects and flags around it gone. */
function pathsNamedIn(command: string | undefined, homeDirectory: string): string[] {
  if (!command) return []
  return command
    .split(/\s+/)
    .flatMap(pathCandidatesOf)
    .map((candidate) => expandHome(candidate, homeDirectory))
    .filter((candidate) => path.isAbsolute(candidate))
}

/** Where an event happened, with the paths its command names already read out. */
interface ResolvedLocation {
  cwd: string
  file: string | null | undefined
  namedPaths: string[]
}

function resolveLocation(location: CaptureLocation, homeDirectory: string): ResolvedLocation {
  return { cwd: location.cwd, file: location.file, namedPaths: pathsNamedIn(location.command, homeDirectory) }
}

/** The same event with every path in the file system's spelling, command paths included. */
function canonicalLocation(location: ResolvedLocation): ResolvedLocation {
  return {
    cwd: canonicalPath(location.cwd),
    file: location.file ? canonicalPath(location.file) : null,
    namedPaths: location.namedPaths.map(canonicalPath),
  }
}

function isLocationUnder(location: ResolvedLocation, folders: string[]): boolean {
  return (
    isUnderAny(location.cwd, folders) ||
    isUnderAny(location.file, folders) ||
    location.namedPaths.some((named) => isUnderAny(named, folders))
  )
}

function validEntries(excludePaths: unknown): string[] {
  if (!Array.isArray(excludePaths)) return []
  return excludePaths.filter((entry): entry is string => typeof entry === 'string' && entry.trim() !== '')
}

/**
 * Whether an event happened in, edited a file under, or ran a command naming one of the excluded folders. A folder
 * counts whole segments only (`/w/client` does not cover `/w/client-old`), and a path reached through a symlink or
 * with different capitals on a case-insensitive disk is the same folder. Reads a missing or invalid list as empty, so
 * an old config or a test's mock never throws. Relative names in a command (`cd client`) can't be told apart from any
 * other word and are not detected.
 */
export function isExcluded(
  location: CaptureLocation,
  excludePaths: unknown,
  homeDirectory: string = os.homedir()
): boolean {
  const entries = validEntries(excludePaths)
  if (entries.length === 0) return false

  const lexicalFolders = entries.map((entry) => lexicalForm(entry, homeDirectory))
  const resolved = resolveLocation(location, homeDirectory)
  if (isLocationUnder(resolved, lexicalFolders)) return true

  // Only users with exclusions, and only for an event the quick check didn't match, ask the file system
  const canonicalFolders = lexicalFolders.map(canonicalPath)
  return isLocationUnder(canonicalLocation(resolved), [...lexicalFolders, ...canonicalFolders])
}

/** Whether two entries name the same folder, however each was written. */
export function isSameExcludedPath(first: string, second: string, options: { baseDirectory: string }): boolean {
  return toExcludedPath(first, options) === toExcludedPath(second, options)
}
