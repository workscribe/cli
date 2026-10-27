import fs from 'fs'
import path from 'path'
import os from 'os'
import { execFileSync } from 'child_process'
import { log } from '../utils/logger'
import { CompletionCommand, bashCompletion, zshCompletion, fishCompletion } from '../utils/completion-scripts'
import { WORKSCRIBE_DIR } from '../utils/paths'
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
const HOOK_PREAMBLE = '# Workscribe — developer work journal'

/** A shell and the rc file `init` writes its hook (and completions) into. */
export type ShellTarget = { name: string; rcFile: string }

/** Backs up an rc file before editing it, never overwriting an earlier backup, and says where it went. */
function backUp(rcFile: string): void {
  log.info(`Backed up ${rcFile} → ${path.basename(backUpFile(rcFile))}`)
}

export function getInstalledHookBlock(rcFile: string): string | null {
  if (!fs.existsSync(rcFile)) return null
  const content = fs.readFileSync(rcFile, 'utf-8')
  const startIdx = content.indexOf(HOOK_START)
  const endIdx = content.indexOf(HOOK_END)
  if (startIdx === -1 || endIdx === -1) return null
  return content.slice(startIdx, endIdx + HOOK_END.length)
}

export function isHookInstalled(rcFile: string): boolean {
  return getInstalledHookBlock(rcFile) !== null
}

export function isHookOutdated(rcFile: string, hookContent: string): boolean {
  const installed = getInstalledHookBlock(rcFile)
  if (!installed) return false
  return installed.trim() !== hookContent.trim()
}

export function installHook(rcFile: string, hookContent: string): void {
  backUp(rcFile)
  fs.appendFileSync(rcFile, `\n${hookContent}\n`)
}

export function updateHook(rcFile: string, hookContent: string): void {
  backUp(rcFile)
  const content = fs.readFileSync(rcFile, 'utf-8')
  const startIdx = content.indexOf(HOOK_START)
  const endIdx = content.indexOf(HOOK_END) + HOOK_END.length
  fs.writeFileSync(rcFile, content.slice(0, startIdx) + hookContent + content.slice(endIdx))
}

export function removeHook(rcFile: string): void {
  backUp(rcFile)
  const content = fs.readFileSync(rcFile, 'utf-8')
  const startIdx = content.indexOf(HOOK_START)
  const endIdx = content.indexOf(HOOK_END) + HOOK_END.length
  // Also remove the preamble comment lines that installHook writes before HOOK_START
  const preambleIdx = content.lastIndexOf(HOOK_PREAMBLE, startIdx)
  const blockStart = preambleIdx !== -1 ? preambleIdx : startIdx
  const before = content.slice(0, blockStart).replace(/\n+$/, '\n')
  const after = content.slice(endIdx).replace(/^\n/, '')
  fs.writeFileSync(rcFile, before + after)
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
  fs.mkdirSync(WORKSCRIBE_DIR, { recursive: true })
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
