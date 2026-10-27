import fs from 'fs'

// Far more than two edits in one millisecond ever need; a bound so a broken file system can't loop forever
const MAX_BACKUP_ATTEMPTS = 100

/**
 * Copies a file the user owns to `<file>.workscribe-backup-<time>` before Workscribe edits it, and returns the
 * backup's path. Never overwrites an earlier backup — two edits in the same millisecond (say the shell hook and
 * the completions block, one after the other) each keep their own copy.
 */
export function backUpFile(file: string): string {
  const base = `${file}.workscribe-backup-${Date.now()}`
  for (let attempt = 1; attempt <= MAX_BACKUP_ATTEMPTS; attempt++) {
    const backup = attempt === 1 ? base : `${base}-${attempt}`
    try {
      fs.copyFileSync(file, backup, fs.constants.COPYFILE_EXCL)
      return backup
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  throw new Error(`Couldn't back up ${file}: too many backups named ${base}`)
}
