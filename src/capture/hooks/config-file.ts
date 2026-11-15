// An agent's JSON settings file, read and written the way Workscribe must treat anything it doesn't own: a file it
// can't parse is never overwritten, and an existing one is backed up before every write.
import fs from 'fs'
import path from 'path'
import { backUpFile } from '../../utils/backup'

export type JsonConfig =
  | { kind: 'ok'; value: Record<string, unknown> }
  /** There's no file yet */
  | { kind: 'missing' }
  /** The file isn't valid JSON, or isn't a JSON object */
  | { kind: 'unreadable' }

export function readJsonConfig(file: string): JsonConfig {
  if (!fs.existsSync(file)) return { kind: 'missing' }
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(file, 'utf-8'))
    const isObject = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    return isObject ? { kind: 'ok', value: parsed as Record<string, unknown> } : { kind: 'unreadable' }
  } catch {
    return { kind: 'unreadable' }
  }
}

/**
 * Writes the config, backing up the file it replaces first and creating its folder when it's the first write. A write
 * that would leave the file as it is does nothing, so running `init` again doesn't pile up backups.
 */
export function writeJsonConfig(file: string, value: Record<string, unknown>): void {
  const text = JSON.stringify(value, null, 2)
  if (fs.existsSync(file)) {
    if (fs.readFileSync(file, 'utf-8') === text) return
    backUpFile(file)
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, text)
}
