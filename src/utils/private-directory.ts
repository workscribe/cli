import fs from 'fs'

const PRIVATE_DIRECTORY_MODE = 0o700
const GROUP_AND_OTHER_BITS = 0o077

/**
 * Creates the folder (and any missing parents) readable only by you, and tightens an existing one that group or
 * others can open — so the database and its `-wal`/`-shm` files never sit in a shared folder.
 */
export function ensurePrivateDirectory(directory: string): void {
  fs.mkdirSync(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  if ((fs.statSync(directory).mode & GROUP_AND_OTHER_BITS) !== 0) fs.chmodSync(directory, PRIVATE_DIRECTORY_MODE)
}
