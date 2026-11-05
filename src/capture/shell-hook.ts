import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFileSync } from 'child_process'
import { log } from '../utils/logger'
import { CompletionCommand, bashCompletion, zshCompletion, fishCompletion } from '../utils/completion-scripts'
import { WORKSCRIBE_DIR } from '../utils/paths'
import { ensurePrivateDirectory } from '../utils/private-directory'
import { backUpFile } from '../utils/backup'
import {
  COMPLETIONS_MARKER,
  completionsBlock,
  hasCompletionsBlock,
  isCompletionsBlockOutdated,
  removeCompletionsBlock,
  replaceCompletionsBlock,
} from './completions-block'

const FISH_COMPLETIONS_DIR = path.join(os.homedir(), '.config', 'fish', 'completions')

const HOOK_START = '# workscribe:hook:start'
const HOOK_END = '# workscribe:hook:end'
// The two lines every template starts with, above HOOK_START. Updates before WOR-153 stacked a copy per update.
const PREAMBLE_LINE =
  /^# (?:Workscribe — developer work journal|Do not edit this (?:block|file) manually\. Managed by `workscribe init`\.)$/
const HOOK_VERSION_LINE = /^# workscribe:hook-version (\d+)$/m

/**
 * The version of each shell's hook template (`# workscribe:hook-version N` inside the block; none means 1). Bump it
 * whenever that template changes, so `status` can tell users whose rc file still holds the old one.
 */
export const SHELL_HOOK_VERSIONS: Readonly<Record<string, number>> = Object.freeze({ zsh: 2, bash: 2, fish: 1 })

// The block 0.2.1's `chronicle init` wrote — the app's name before 1.0. Nothing reads it any more, and it errors at
// every prompt.
const CHRONICLE_START = '# chronicle:hook:start'
const CHRONICLE_END = '# chronicle:hook:end'
const CHRONICLE_PREAMBLE_LINE =
  /^# (?:Chronicle — developer work journal|Do not edit this block manually\. Managed by `chronicle init`\.)$/

/** A shell and the rc file `init` writes its hook (and completions) into. */
export type ShellTarget = { name: string; rcFile: string }

/** The shell `$SHELL` names, and its rc file — what `init` installs into and `status` checks. */
export function detectShell(): ShellTarget | null {
  const shell = process.env.SHELL ?? ''
  if (shell.includes('zsh')) return { name: 'zsh', rcFile: path.join(os.homedir(), '.zshrc') }
  if (shell.includes('bash')) return { name: 'bash', rcFile: path.join(os.homedir(), '.bashrc') }
  if (shell.includes('fish')) {
    return { name: 'fish', rcFile: path.join(os.homedir(), '.config', 'fish', 'conf.d', 'workscribe.fish') }
  }
  return null
}

/** Where a marked block sits in an rc file: from the first of the header lines right above it, to its end marker. */
interface BlockRegion {
  start: number
  end: number
}

/** The marked block with every header line directly above it (blank lines between them included), or null. */
function blockRegion(content: string, markers: { start: string; end: string; preamble: RegExp }): BlockRegion | null {
  const blockStart = content.indexOf(markers.start)
  const blockEnd = content.indexOf(markers.end, blockStart)
  if (blockStart === -1 || blockEnd === -1) return null
  const lines = content.slice(0, blockStart).split('\n')
  lines.pop() // the start marker's own line, empty before it
  let headerLines = 0
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index]
    if (!markers.preamble.test(line) && line.trim() !== '') break
    headerLines = lines.length - index
  }
  // Blank lines above the topmost header line stay where they were
  while (headerLines > 0 && lines[lines.length - headerLines].trim() === '') headerLines -= 1
  const header = lines.slice(lines.length - headerLines)
  const headerLength = header.reduce((length, line) => length + line.length + 1, 0)
  return { start: blockStart - headerLength, end: blockEnd + markers.end.length }
}

/** The Workscribe hook in an rc file, header lines included — what an update replaces and a removal deletes. */
export function hookRegion(content: string): BlockRegion | null {
  return blockRegion(content, { start: HOOK_START, end: HOOK_END, preamble: PREAMBLE_LINE })
}

/** A leftover 0.2.1 `chronicle` hook in an rc file, header lines included, or null. */
export function findChronicleHook(content: string): BlockRegion | null {
  return blockRegion(content, { start: CHRONICLE_START, end: CHRONICLE_END, preamble: CHRONICLE_PREAMBLE_LINE })
}

/** A template's own block, start marker to end marker — what's compared with an installed one. */
export function hookBlockOf(hookContent: string): string {
  const startIndex = hookContent.indexOf(HOOK_START)
  const endIndex = hookContent.indexOf(HOOK_END)
  if (startIndex === -1 || endIndex === -1) return hookContent.trim()
  return hookContent.slice(startIndex, endIndex + HOOK_END.length)
}

/** The version an installed block declares; a block from before versions were declared is 1. */
export function installedHookVersion(block: string): number {
  const match = HOOK_VERSION_LINE.exec(block)
  return match ? Number(match[1]) : 1
}

/** Backs up an rc file before editing it, never overwriting an earlier backup, and says where it went. */
function backUp(rcFile: string): void {
  log.info(`Backed up ${rcFile} → ${path.basename(backUpFile(rcFile))}`)
}

export function getInstalledHookBlock(rcFile: string): string | null {
  // An rc file that's missing or can't be read has no hook — never a crash in `status`
  const content = fs.existsSync(rcFile) ? readRcFile(rcFile) : null
  if (content === null) return null
  const startIndex = content.indexOf(HOOK_START)
  const endIndex = content.indexOf(HOOK_END)
  if (startIndex === -1 || endIndex === -1) return null
  return content.slice(startIndex, endIndex + HOOK_END.length)
}

export function isHookInstalled(rcFile: string): boolean {
  return getInstalledHookBlock(rcFile) !== null
}

/** The installed block differs from the template's — the template's header lines don't count. */
export function isHookOutdated(rcFile: string, hookContent: string): boolean {
  const installed = getInstalledHookBlock(rcFile)
  if (!installed) return false
  return installed.trim() !== hookBlockOf(hookContent).trim()
}

export function installHook(rcFile: string, hookContent: string): void {
  backUp(rcFile)
  fs.appendFileSync(rcFile, `\n${hookContent}\n`)
}

/** Replaces the hook and every header line above it with the template — one header, however many there were. */
export function updateHook(rcFile: string, hookContent: string): void {
  backUp(rcFile)
  const content = fs.readFileSync(rcFile, 'utf-8')
  const region = hookRegion(content)
  if (!region) return
  fs.writeFileSync(rcFile, content.slice(0, region.start) + hookContent.trimEnd() + content.slice(region.end))
}

/** Cuts a region out of an rc file's content without leaving extra blank lines where it was. */
function withoutRegion(content: string, region: BlockRegion): string {
  const before = content.slice(0, region.start).replace(/\n+$/, '\n')
  const after = content.slice(region.end).replace(/^\n/, '')
  return before + after
}

export function removeHook(rcFile: string): void {
  backUp(rcFile)
  const content = fs.readFileSync(rcFile, 'utf-8')
  const region = hookRegion(content)
  if (!region) return
  fs.writeFileSync(rcFile, withoutRegion(content, region))
}

/** Whether an rc file still holds a 0.2.1 `chronicle` hook. */
export function hasChronicleHook(rcFile: string): boolean {
  const content = readRcFile(rcFile)
  return content !== null && findChronicleHook(content) !== null
}

/** Removes a leftover `chronicle` hook, after backing the file up. Returns whether there was one. */
export function removeChronicleHook(rcFile: string): boolean {
  const content = readRcFile(rcFile)
  const region = content === null ? null : findChronicleHook(content)
  if (content === null || !region) return false
  backUp(rcFile)
  fs.writeFileSync(rcFile, withoutRegion(content, region))
  return true
}

export interface ShellHookHealth {
  /** The hook is in the rc file but older than this version's template */
  isOutdated: boolean
  /** The rc file still holds a 0.2.1 `chronicle` hook */
  hasChronicleHook: boolean
}

/** What `status` warns about for the user's shell: an old hook, or a leftover Chronicle one. */
export function shellHookHealth(shell: ShellTarget): ShellHookHealth {
  const installed = getInstalledHookBlock(shell.rcFile)
  const currentVersion = SHELL_HOOK_VERSIONS[shell.name] ?? 1
  return {
    isOutdated: installed !== null && installedHookVersion(installed) < currentVersion,
    hasChronicleHook: hasChronicleHook(shell.rcFile),
  }
}

export function resolveWorkscribeBinary(): string | null {
  try {
    const resolved = execFileSync('which', ['workscribe'], { encoding: 'utf-8' }).trim()
    return resolved || null
  } catch {
    return null
  }
}

/**
 * nodePath pins the Node interpreter alongside the workscribe script path.
 * Without it, workscribe's own shebang (`#!/usr/bin/env -S node ...`) still
 * dynamically resolves `node` via whatever PATH is active in the shell at
 * capture time — so a hardcoded binaryPath alone doesn't protect against a
 * stale/wrong default Node version in that shell, only against the
 * workscribe script itself moving. nodePath should be process.execPath,
 * captured at `workscribe init` time when it's guaranteed to be 22+.
 */
export function injectBinaryPath(hookContent: string, binaryPath: string, nodePath: string): string {
  // Invoking node directly (rather than executing workscribe's own shebang)
  // bypasses the `--disable-warning=ExperimentalWarning` flag postbuild.js
  // bakes into dist/index.js's shebang — shebang flags only apply when the
  // OS execs the file via its shebang line, not when node is invoked
  // explicitly. Without repeating the flag here, every pinned-node-path
  // invocation (the default whenever a version manager is detected) leaks
  // the node:sqlite ExperimentalWarning to stderr.
  const pinnedInvocation = `"${nodePath}" --disable-warning=ExperimentalWarning "${binaryPath}"`
  return hookContent
    .replace('command -v workscribe > /dev/null 2>&1 || return 0', `[[ -x "${binaryPath}" ]] || return 0`)
    .replace('command -v workscribe &>/dev/null || return 0', `[[ -x "${binaryPath}" ]] || return 0`)
    .replace('type -q workscribe\n    or return 0', `test -x "${binaryPath}"\n    or return 0`)
    .replaceAll('command workscribe _capture', `${pinnedInvocation} _capture`)
    .replaceAll('command workscribe alerts', `${pinnedInvocation} alerts`)
}

export function isCompletionsInstalled(shell: ShellTarget): boolean {
  if (shell.name === 'fish') {
    return fs.existsSync(path.join(FISH_COMPLETIONS_DIR, 'workscribe.fish'))
  }
  try {
    return fs.readFileSync(shell.rcFile, 'utf-8').includes(COMPLETIONS_MARKER)
  } catch {
    return false
  }
}

const FISH_COMPLETIONS_FILE = path.join(FISH_COMPLETIONS_DIR, 'workscribe.fish')

function completionScriptFile(shellName: string): string {
  return path.join(WORKSCRIBE_DIR, `completion.${shellName}`)
}

function readRcFile(rcFile: string): string | null {
  try {
    return fs.readFileSync(rcFile, 'utf-8')
  } catch {
    return null // a missing rc file simply has no completions block
  }
}

/** (Re)writes the completion script itself — safe to run on every `init`, so a deleted data folder is repaired. */
export function writeCompletionScript(shell: ShellTarget, commands: CompletionCommand[]): void {
  if (shell.name === 'fish') {
    fs.mkdirSync(FISH_COMPLETIONS_DIR, { recursive: true })
    fs.writeFileSync(FISH_COMPLETIONS_FILE, fishCompletion(commands), { mode: 0o644 })
    return
  }
  const script = shell.name === 'zsh' ? zshCompletion(commands) : bashCompletion(commands)
  ensurePrivateDirectory(WORKSCRIBE_DIR)
  fs.writeFileSync(completionScriptFile(shell.name), script, { mode: 0o644 })
}

export function installCompletions(shell: ShellTarget, commands: CompletionCommand[]): void {
  writeCompletionScript(shell, commands)
  // installCompletions can be called more than once (e.g. isCompletionsInstalled raced with a concurrent init).
  // The rcFile append must stay idempotent so repeated calls never grow duplicate blocks.
  if (shell.name !== 'fish' && !isCompletionsInstalled(shell)) {
    fs.appendFileSync(shell.rcFile, `\n${completionsBlock(shell.name, completionScriptFile(shell.name))}\n`)
  }
}

/** The rc file has a completions block from an older version — one that errors once its script is deleted. */
export function isCompletionsOutdated(shell: ShellTarget): boolean {
  if (shell.name === 'fish') return false // fish completions are a standalone file, not an rc-file line
  const content = readRcFile(shell.rcFile)
  return (
    content !== null &&
    isCompletionsBlockOutdated(content, completionsBlock(shell.name, completionScriptFile(shell.name)))
  )
}

export function updateCompletions(shell: ShellTarget): void {
  const content = readRcFile(shell.rcFile)
  if (content === null || !hasCompletionsBlock(content)) return
  backUp(shell.rcFile)
  fs.writeFileSync(
    shell.rcFile,
    replaceCompletionsBlock(content, completionsBlock(shell.name, completionScriptFile(shell.name)))
  )
}

/** Removes the completions block from an rc file, if it has one. Returns whether anything was removed. */
export function removeCompletions(rcFile: string): boolean {
  const content = readRcFile(rcFile)
  if (content === null || !hasCompletionsBlock(content)) return false
  backUp(rcFile)
  fs.writeFileSync(rcFile, removeCompletionsBlock(content))
  return true
}

/** Removes the fish completion file, if present. Returns whether anything was removed. */
export function removeFishCompletions(): boolean {
  if (!fs.existsSync(FISH_COMPLETIONS_FILE)) return false
  fs.rmSync(FISH_COMPLETIONS_FILE, { force: true })
  return true
}
