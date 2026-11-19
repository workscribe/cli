import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { fishCompletion, zshCompletion } from '../../src/utils/completion-scripts.js'

const commands = [
  { name: 'sessions', description: "List the day's work" },
  { name: 'history', description: 'Show "quoted" $vars and a \\ slash' },
]

describe('completion scripts', () => {
  it('zsh output parses even when descriptions contain apostrophes', () => {
    const script = zshCompletion(commands)
    expect(script).toContain(`'sessions:List the day'\\''s work'`)
    execFileSync('zsh', ['-n', '-c', script], { stdio: 'pipe' })
  })

  it('fish output escapes quotes, dollars and backslashes', () => {
    const script = fishCompletion(commands)
    expect(script).toContain('-d "Show \\"quoted\\" \\$vars and a \\\\ slash"')
  })
})
