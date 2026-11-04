import { describe, it, expect, onTestFinished } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { ensurePrivateDirectory } from '../../src/utils/private-directory'

const ACCESS_BITS = 0o777

function tempFolder(): string {
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-private-'))
  onTestFinished(() => fs.rmSync(folder, { recursive: true, force: true }))
  return folder
}

function modeOf(directory: string): number {
  return fs.statSync(directory).mode & ACCESS_BITS
}

describe('ensurePrivateDirectory', () => {
  it('creates the folder, and missing parents, readable only by you', () => {
    const directory = path.join(tempFolder(), 'share', 'workscribe')

    ensurePrivateDirectory(directory)

    expect(modeOf(directory)).toBe(0o700)
    expect(modeOf(path.dirname(directory))).toBe(0o700)
  })

  it('tightens an existing folder that group or others can open', () => {
    const directory = tempFolder()
    fs.chmodSync(directory, 0o755)

    ensurePrivateDirectory(directory)

    expect(modeOf(directory)).toBe(0o700)
  })

  it('leaves a private folder as it is', () => {
    const directory = tempFolder()
    fs.chmodSync(directory, 0o700)
    const before = fs.statSync(directory).ctimeMs

    ensurePrivateDirectory(directory)

    expect(modeOf(directory)).toBe(0o700)
    expect(fs.statSync(directory).ctimeMs).toBe(before)
  })
})
