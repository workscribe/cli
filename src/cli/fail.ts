import { log } from '../utils/logger'

/** Prints the error and exits 1 — for a command that can't go on. */
export function fail(message: string): never {
  log.error(message)
  process.exit(1)
}
