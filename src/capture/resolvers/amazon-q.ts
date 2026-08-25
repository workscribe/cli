import fs from 'fs'
import path from 'path'
import os from 'os'

const HISTORY_DIR = path.join(os.homedir(), '.aws', 'amazonq', 'history')

export function resolveAmazonQPaths(): string[] {
  if (!fs.existsSync(HISTORY_DIR)) return []
  return fs
    .readdirSync(HISTORY_DIR)
    .filter((file) => file.startsWith('chat-history-') && file.endsWith('.json'))
    .map((file) => path.join(HISTORY_DIR, file))
}
