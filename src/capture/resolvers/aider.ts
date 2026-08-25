import fs from 'fs'
import path from 'path'
import os from 'os'

const DEFAULT_HISTORY_FILE = '.aider.chat.history.md'

export function resolveAiderPaths(cwd: string): string[] {
  const customPath = readAiderConfigPath(cwd) ?? readAiderConfigPath(os.homedir())
  const historyPath = customPath ?? path.join(cwd, DEFAULT_HISTORY_FILE)
  return fs.existsSync(historyPath) ? [historyPath] : []
}

function readAiderConfigPath(directory: string): string | null {
  try {
    const configPath = path.join(directory, '.aider.conf.yml')
    const content = fs.readFileSync(configPath, 'utf-8')
    const match = content.match(/^chat-history-file:\s*(.+)$/m)
    if (!match) return null
    const value = match[1].trim().replace(/^['"]|['"]$/g, '')
    return path.resolve(directory, value)
  } catch {
    return null
  }
}
