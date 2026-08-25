import fs from 'fs'
import path from 'path'

const HISTORY_FILE = '.aider.chat.history.md'
const PROMPT_MAX_LENGTH = 200

export function readLastAiderPrompt(cwd: string): string | null {
  try {
    const histPath = path.join(cwd, HISTORY_FILE)
    const content = fs.readFileSync(histPath, 'utf-8')
    const matches = [...content.matchAll(/^#### (.+)$/gm)]
    if (!matches.length) return null
    return matches[matches.length - 1][1].trim().slice(0, PROMPT_MAX_LENGTH)
  } catch {
    return null
  }
}
