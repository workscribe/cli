import chalk from 'chalk'
import fs from 'fs'
import { DEBUG_LOG_PATH } from './paths'

const isDebug = process.env.WORKSCRIBE_DEBUG === '1'

export const log = {
  info: (msg: string) => console.log(chalk.cyan('→'), msg),
  success: (msg: string) => console.log(chalk.green('✓'), msg),
  warn: (msg: string) => console.log(chalk.yellow('⚠'), msg),
  error: (msg: string) => console.error(chalk.red('✗'), msg),
  plain: (msg: string) => console.log(msg),
}

export function debugLog(context: string, error: unknown): void {
  if (!isDebug) return
  const entry = `[${new Date().toISOString()}] [${context}] ${error instanceof Error ? error.stack : String(error)}\n`
  try {
    fs.appendFileSync(DEBUG_LOG_PATH, entry, { mode: 0o600 })
  } catch {
    // If we can't write to the debug log, silently ignore
  }
}
