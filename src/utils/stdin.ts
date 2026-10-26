import fs from 'fs'

const STDIN_FILE_DESCRIPTOR = 0

/** True when stdin is a terminal — reading it would wait for typing rather than piped input. */
export function isStdinInteractive(): boolean {
  return Boolean(process.stdin.isTTY)
}

/** Everything piped into the process. Throws if stdin can't be read. */
export function readAllStdin(): string {
  return fs.readFileSync(STDIN_FILE_DESCRIPTOR, 'utf-8')
}
