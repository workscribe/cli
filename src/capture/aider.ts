import fs from 'fs'
import path from 'path'
import { redact } from './redact'

const HISTORY_FILE = '.aider.chat.history.md'
const PROMPT_MAX_LENGTH = 200

/** The last prompt, redacted before it's cut, as a pattern can't recognise a secret cut in half. */
export function readLastAiderPrompt(cwd: string, extraRedactions: string[] = []): string | null {
  try {
    const histPath = path.join(cwd, HISTORY_FILE)
    const content = fs.readFileSync(histPath, 'utf-8')
    const matches = [...content.matchAll(/^#### (.+)$/gm)]
    if (!matches.length) return null
    return redact(matches[matches.length - 1][1].trim(), extraRedactions).slice(0, PROMPT_MAX_LENGTH)
  } catch {
    return null
  }
}
