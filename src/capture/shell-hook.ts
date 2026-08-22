import fs from 'fs'
import path from 'path'
import os from 'os'
import { log } from '../utils/logger'
import { CompletionCommand, bashCompletion, zshCompletion, fishCompletion } from '../utils/completion-scripts'
import { WORKSCRIBE_DIR } from '../utils/paths'

const FISH_COMPLETIONS_DIR = path.join(os.homedir(), '.config', 'fish', 'completions')

const HOOK_START = '# workscribe:hook:start'
const HOOK_END = '# workscribe:hook:end'
const HOOK_PREAMBLE = '# Workscribe — developer work journal'

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
  const backup = `${rcFile}.workscribe-backup-${Date.now()}`
  fs.copyFileSync(rcFile, backup)
  log.info(`Backed up ${rcFile} → ${path.basename(backup)}`)
  fs.appendFileSync(rcFile, `\n${hookContent}\n`)
}

export function updateHook(rcFile: string, hookContent: string): void {
  const backup = `${rcFile}.workscribe-backup-${Date.now()}`
  fs.copyFileSync(rcFile, backup)
  log.info(`Backed up ${rcFile} → ${path.basename(backup)}`)
  const content = fs.readFileSync(rcFile, 'utf-8')
  const startIdx = content.indexOf(HOOK_START)
  const endIdx = content.indexOf(HOOK_END) + HOOK_END.length
  fs.writeFileSync(rcFile, content.slice(0, startIdx) + hookContent + content.slice(endIdx))
}

export function removeHook(rcFile: string): void {
  const backup = `${rcFile}.workscribe-backup-${Date.now()}`
  fs.copyFileSync(rcFile, backup)
  log.info(`Backed up ${rcFile} → ${path.basename(backup)}`)
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

export function isCompletionsInstalled(shell: { name: string; rcFile: string }): boolean {
  if (shell.name === 'fish') {
    return fs.existsSync(path.join(FISH_COMPLETIONS_DIR, 'workscribe.fish'))
  }
  try {
    return fs.readFileSync(shell.rcFile, 'utf-8').includes('workscribe completions')
  } catch {
    return false
  }
}

export function installCompletions(shell: { name: string; rcFile: string }, commands: CompletionCommand[]): void {
  if (shell.name === 'fish') {
    if (!fs.existsSync(FISH_COMPLETIONS_DIR)) {
      fs.mkdirSync(FISH_COMPLETIONS_DIR, { recursive: true })
    }
    fs.writeFileSync(path.join(FISH_COMPLETIONS_DIR, 'workscribe.fish'), fishCompletion(commands), { mode: 0o644 })
  } else {
    const script = shell.name === 'zsh' ? zshCompletion(commands) : bashCompletion(commands)
    const cacheFile = path.join(WORKSCRIBE_DIR, `completion.${shell.name}`)
    fs.writeFileSync(cacheFile, script, { mode: 0o644 })
    const sourceLine =
      shell.name === 'zsh'
        ? `\n# Workscribe completions\nautoload -Uz compinit && compinit\nsource "${cacheFile}"\n`
        : `\n# Workscribe completions\nsource "${cacheFile}"\n`
    fs.appendFileSync(shell.rcFile, sourceLine)
  }
}
