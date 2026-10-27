// Reclassifies stored `other` events with the classifier as it is when this runs — so on an install that first
// opens its database with a later release, later rules and the user's active profiles apply too. That's fine:
// it only ever improves `other` rows, never touches any other row or a stored command, and skips what it can't classify.
import { normalizeCommand } from '../../normalize/patterns'
import { reclassifiedEvent } from '../../normalize/reclassify'
import { readConfig } from '../../config'
import { debugLog } from '../../utils/logger'
import type { Migration, MigrationDatabase } from '../migration-types'

interface UnclassifiedRow {
  id: number
  command: string
}

function classifyOrSkip(row: UnclassifiedRow, aiToolsEnabled: boolean): ReturnType<typeof reclassifiedEvent> {
  try {
    return reclassifiedEvent(row.command, { classify: normalizeCommand, aiToolsEnabled })
  } catch (error) {
    // Best-effort: this runs the first time any command opens the database after upgrading (even the
    // background capture), so one odd command must never fail the migration and lock the database out
    debugLog('migration-006', error)
    return null
  }
}

const migration: Migration = {
  version: 6,
  description: 'Reclassify unclassified events now that compound commands are classified by their main step',
  sql: '',
  run(db: MigrationDatabase) {
    const aiToolsEnabled = readConfig().capture.aiTools !== false
    const rows = db.prepare("SELECT id, command FROM events WHERE category = 'other'").all() as UnclassifiedRow[]
    const update = db.prepare('UPDATE events SET category = ?, metadata = ? WHERE id = ?')
    for (const row of rows) {
      const event = classifyOrSkip(row, aiToolsEnabled)
      if (!event) continue
      const metadata = Object.keys(event.metadata).length > 0 ? JSON.stringify(event.metadata) : null
      update.run(event.category, metadata, row.id)
    }
  },
}

export default migration
