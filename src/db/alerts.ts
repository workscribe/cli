import fs from 'fs'
import path from 'path'
import { getDb } from './index'
import { ALERTS_PENDING_PATH } from '../utils/paths'

export interface AlertRow {
  id: number
  created_at: number
  tool: string
  session_id: string | null
  context: string
  cleared: number
}

export function insertAlert(tool: string, sessionId: string | null, context: string): void {
  getDb()
    .prepare(
      `INSERT INTO alerts (created_at, tool, session_id, context)
       VALUES ($created_at, $tool, $session_id, $context)`
    )
    .run({ created_at: Date.now(), tool, session_id: sessionId ?? null, context })

  fs.mkdirSync(path.dirname(ALERTS_PENDING_PATH), { recursive: true })
  fs.writeFileSync(ALERTS_PENDING_PATH, '', { flag: 'w' })
}

export function getPendingAlerts(): AlertRow[] {
  return getDb()
    .prepare('SELECT * FROM alerts WHERE cleared = 0 ORDER BY created_at DESC')
    .all() as unknown as AlertRow[]
}

export function hasPendingAlerts(): boolean {
  const row = getDb().prepare('SELECT COUNT(*) as count FROM alerts WHERE cleared = 0').get() as {
    count: number | bigint
  }
  return Number(row.count) > 0
}

export function clearAlerts(): number {
  const result = getDb().prepare('UPDATE alerts SET cleared = 1 WHERE cleared = 0').run()
  try {
    fs.unlinkSync(ALERTS_PENDING_PATH)
  } catch {
    // File may already be absent
  }
  return Number(result.changes)
}
