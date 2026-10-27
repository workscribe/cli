import { describe, it, expect, onTestFinished } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { isCompletionsOutdated, removeCompletions, updateCompletions } from '../../src/capture/shell-hook'
import { WORKSCRIBE_DIR } from '../../src/utils/paths'

// The completions functions against real rc files in a temp folder: backups, other content untouched, idempotence.
// None of these write the completion script itself, so nothing touches the data folder.

const OWN_LINES = 'export EDITOR=vim\nalias ll="ls -la"\n'
const OLD_ZSH_BLOCK = `\n# Workscribe completions\nautoload -Uz compinit && compinit\nsource "${WORKSCRIBE_DIR}/completion.zsh"\n`

function tempRcFile(content: string): { rcFile: string; directory: string } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-rc-'))
  onTestFinished(() => fs.rmSync(directory, { recursive: true, force: true }))
  const rcFile = path.join(directory, '.zshrc')
  fs.writeFileSync(rcFile, content)
  return { rcFile, directory }
}

function backupsIn(directory: string): string[] {
  return fs.readdirSync(directory).filter((file) => file.includes('.workscribe-backup-'))
}

describe('updateCompletions on a real rc file', () => {
  it('guards an old block, keeps your own lines, backs up the original, and is then up to date', () => {
    const { rcFile, directory } = tempRcFile(OWN_LINES + OLD_ZSH_BLOCK)
    const shell = { name: 'zsh', rcFile }
    expect(isCompletionsOutdated(shell)).toBe(true)

    updateCompletions(shell)

    const content = fs.readFileSync(rcFile, 'utf-8')
    expect(content.startsWith(OWN_LINES)).toBe(true)
    expect(content).toContain(`if [ -f "${WORKSCRIBE_DIR}/completion.zsh" ]; then`)
    expect(content).not.toMatch(/^autoload -Uz compinit/m)
    expect(isCompletionsOutdated(shell)).toBe(false)
    const backups = backupsIn(directory)
    expect(backups).toHaveLength(1)
    expect(fs.readFileSync(path.join(directory, backups[0]), 'utf-8')).toBe(OWN_LINES + OLD_ZSH_BLOCK)
  })

  it('leaves a file with no completions block alone, without a backup', () => {
    const { rcFile, directory } = tempRcFile(OWN_LINES)

    updateCompletions({ name: 'zsh', rcFile })

    expect(fs.readFileSync(rcFile, 'utf-8')).toBe(OWN_LINES)
    expect(backupsIn(directory)).toEqual([])
  })
})

describe('removeCompletions on a real rc file', () => {
  it('removes the block, keeps your own lines and a backup, and has nothing to do the second time', () => {
    const { rcFile, directory } = tempRcFile(OWN_LINES + OLD_ZSH_BLOCK)

    expect(removeCompletions(rcFile)).toBe(true)
    expect(fs.readFileSync(rcFile, 'utf-8')).toBe(OWN_LINES)
    expect(removeCompletions(rcFile)).toBe(false)
    expect(backupsIn(directory)).toHaveLength(1)
  })

  it('reports nothing removed for a missing rc file', () => {
    expect(removeCompletions(path.join(os.tmpdir(), 'workscribe-no-such-rc'))).toBe(false)
  })
})
