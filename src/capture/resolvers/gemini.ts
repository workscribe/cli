import fs from 'fs'
import path from 'path'
import os from 'os'

const TMP_DIR = path.join(os.homedir(), '.gemini', 'tmp')

export function resolveGeminiPaths(): string[] {
  if (!fs.existsSync(TMP_DIR)) return []
  return fs.readdirSync(TMP_DIR).flatMap((hash) => {
    const logsFile = path.join(TMP_DIR, hash, 'logs.json')
    return fs.existsSync(logsFile) ? [logsFile] : []
  })
}
