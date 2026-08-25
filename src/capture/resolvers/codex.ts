import fs from 'fs'
import path from 'path'
import os from 'os'

const SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions')

export function resolveCodexPaths(): string[] {
  if (!fs.existsSync(SESSIONS_DIR)) return []
  return fs
    .readdirSync(SESSIONS_DIR)
    .filter((file) => file.endsWith('.jsonl'))
    .map((file) => path.join(SESSIONS_DIR, file))
}
