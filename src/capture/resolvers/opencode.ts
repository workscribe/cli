import fs from 'fs'
import path from 'path'
import os from 'os'

export function resolveOpencodePaths(): string[] {
  const dbPath = path.join(resolveDataDir(), 'opencode', 'opencode.db')
  return fs.existsSync(dbPath) ? [dbPath] : []
}

function resolveDataDir(): string {
  // macOS uses Application Support; Linux uses ~/.local/share (XDG default)
  // XDG_DATA_HOME overrides the Linux default when a user has set it explicitly
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support')
  return process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share')
}
