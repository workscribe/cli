import fs from 'fs'
import path from 'path'
import os from 'os'

const SESSION_STATE_DIR = path.join(os.homedir(), '.copilot', 'session-state')

export function resolveCopilotPaths(): string[] {
  if (!fs.existsSync(SESSION_STATE_DIR)) return []
  return fs.readdirSync(SESSION_STATE_DIR).flatMap((sessionId) => {
    const eventsFile = path.join(SESSION_STATE_DIR, sessionId, 'events.jsonl')
    return fs.existsSync(eventsFile) ? [eventsFile] : []
  })
}
