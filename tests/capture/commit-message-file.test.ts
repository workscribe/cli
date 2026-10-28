import { describe, it, expect, onTestFinished } from 'vitest'
import { execFileSync } from 'child_process'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { readCommitMessageFile } from '../../src/capture/commit-message-file'

function scratchDirectory(): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-message-file-'))
  onTestFinished(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}

describe('readCommitMessageFile', () => {
  it("reads the subject — the first line that isn't blank or a # comment", () => {
    const directory = scratchDirectory()
    fs.writeFileSync(
      path.join(directory, 'msg.txt'),
      '\n# Please enter the commit message\nfeat: from a file\n\nbody\n'
    )

    expect(readCommitMessageFile('msg.txt', directory)).toBe('feat: from a file')
  })

  it('reads at most 4 KB', () => {
    const directory = scratchDirectory()
    fs.writeFileSync(path.join(directory, 'big.txt'), 'x'.repeat(10_000))

    expect(readCommitMessageFile('big.txt', directory)?.length).toBe(4096)
  })

  it('is null for a file that is already gone, a directory, or a path with ~ or $', () => {
    const directory = scratchDirectory()
    fs.mkdirSync(path.join(directory, 'folder'))

    expect(readCommitMessageFile('missing.txt', directory)).toBeNull()
    expect(readCommitMessageFile('folder', directory)).toBeNull()
    expect(readCommitMessageFile('~/msg.txt', directory)).toBeNull()
    expect(readCommitMessageFile('$TMPDIR/msg.txt', directory)).toBeNull()
  })

  it('never reads a pipe — it would block capture until something writes to it', () => {
    const directory = scratchDirectory()
    execFileSync('mkfifo', [path.join(directory, 'pipe')])

    expect(readCommitMessageFile('pipe', directory)).toBeNull()
  })
})
