import type { MigrationDatabase } from './migration-types'
import { deleteMetaValue, getMetaValue, setMetaValue } from './jobs/store'

// What the retention run remembers between runs (WOR-179), all in `meta`. `node:sqlite`-free.
export const KEEP_FOREVER_KEY = 'retention:keep-forever'
export const LAST_RUN_KEY = 'retention:last-run'
export const ANNOUNCED_AT_KEY = 'retention:announced-at'
export const WARNED_KEY = 'retention:warned'
export const CLEANUP_KEY = 'retention:cleanup'

const KEEP_FOREVER_VALUE = 'true'

/**
 * Keeping everything is written here as well as to config.json. The config file reads as the defaults when it is
 * damaged or deleted, and the defaults remove data; this copy is why that can't happen to someone who opted out.
 */
export function setKeepForeverMirror(db: MigrationDatabase, keepForever: boolean): void {
  if (keepForever) setMetaValue(db, KEEP_FOREVER_KEY, KEEP_FOREVER_VALUE)
  else deleteMetaValue(db, KEEP_FOREVER_KEY)
}

export function isKeepForeverMirrored(db: MigrationDatabase): boolean {
  return getMetaValue(db, KEEP_FOREVER_KEY) !== null
}
