// Reads the message of a `git commit -F <file>`. Capture runs synchronously on every command and must never hang or
// throw, so only a small, regular file is read — never a pipe, a device or standard input.
import fs from 'fs'
import path from 'path'

const MAX_MESSAGE_FILE_BYTES = 4096

/** The first line git keeps from a message file — non-empty, and not a `#` comment (git strips those). */
function subjectOfMessageFile(text: string): string | null {
  return (
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line !== '' && !line.startsWith('#')) ?? null
  )
}

/**
 * The subject of a commit message file, resolved against the directory the commit ran in — or null if the file
 * can't be read safely: gone already (an agent's temporary file), not a regular file, or a path with `~`, `$` or a
 * substitution in it.
 */
export function readCommitMessageFile(file: string, directory: string): string | null {
  if (/[~$`]/.test(file)) return null
  const resolved = path.resolve(directory, file)
  try {
    if (!fs.lstatSync(resolved).isFile()) return null
    const descriptor = fs.openSync(resolved, 'r')
    try {
      const buffer = Buffer.alloc(MAX_MESSAGE_FILE_BYTES)
      const bytesRead = fs.readSync(descriptor, buffer, 0, MAX_MESSAGE_FILE_BYTES, 0)
      return subjectOfMessageFile(buffer.subarray(0, bytesRead).toString('utf-8'))
    } finally {
      fs.closeSync(descriptor)
    }
  } catch {
    return null // the file vanished between checks, or can't be opened — the git log merge fills the message in
  }
}
