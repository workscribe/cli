import { describe, it, expect, vi, onTestFinished } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { backUpFile } from '../../src/utils/backup'

function tempFile(content: string): string {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-backup-'))
  onTestFinished(() => fs.rmSync(directory, { recursive: true, force: true }))
  const file = path.join(directory, '.zshrc')
  fs.writeFileSync(file, content)
  return file
}

describe('backUpFile', () => {
  it('copies the file next to itself and returns the copy', () => {
    const file = tempFile('original\n')

    const backup = backUpFile(file)

    expect(path.dirname(backup)).toBe(path.dirname(file))
    expect(path.basename(backup)).toMatch(/^\.zshrc\.workscribe-backup-\d+$/)
    expect(fs.readFileSync(backup, 'utf-8')).toBe('original\n')
  })

  it('never overwrites an earlier backup made in the same millisecond', () => {
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_700_000_000_000)
    onTestFinished(() => now.mockRestore())
    const file = tempFile('original\n')

    const first = backUpFile(file)
    fs.writeFileSync(file, 'edited once\n')
    const second = backUpFile(file)

    expect(second).not.toBe(first)
    expect(fs.readFileSync(first, 'utf-8')).toBe('original\n')
    expect(fs.readFileSync(second, 'utf-8')).toBe('edited once\n')
  })

  it('passes on errors other than an existing backup, such as a missing file', () => {
    expect(() => backUpFile(path.join(os.tmpdir(), 'workscribe-no-such-file'))).toThrow(/ENOENT/)
  })
})
