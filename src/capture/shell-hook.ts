import fs from 'fs'
import path from 'path'
import { log } from '../utils/logger'

const HOOK_START = '# workscribe:hook:start'
const HOOK_END = '# workscribe:hook:end'

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
