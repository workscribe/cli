import { describe, it, expect } from 'vitest'
import { changedFilesOf, describeChangedFiles } from '../../../../src/ai/engines/template/changes'
import { event } from './fixtures'

const edit = (filePath: string | undefined, counts: Record<string, unknown>, source?: string) => ({
  ...event('code_edit', counts),
  ...(filePath === undefined ? {} : { filePath }),
  ...(source === undefined ? {} : { source }),
})
const lines = (linesAdded: number | null, linesRemoved: number | null) => ({ linesAdded, linesRemoved })

describe('describeChangedFiles', () => {
  it('counts distinct files and sums the known line counts', () => {
    const events = [
      edit('/a.ts', lines(10, 2), 'vscode'),
      edit('/a.ts', lines(5, 1), 'vscode'),
      edit('/b.ts', lines(1, 0)),
    ]

    expect(describeChangedFiles(events)).toBe('Changed 2 files (+16 −3)')
  })

  it('counts a file with unknown counts but adds nothing to the totals', () => {
    expect(describeChangedFiles([edit('/a.ts', lines(4, 1)), edit('/b.ts', lines(null, null))])).toBe(
      'Changed 2 files (+4 −1)'
    )
  })

  it('shows no counts when none are known', () => {
    expect(describeChangedFiles([edit('/a.ts', lines(null, null))])).toBe('Changed 1 file')
  })

  it('names the agent when an agent alone changed files', () => {
    expect(describeChangedFiles([edit('/a.ts', lines(3, 0), 'claude-code')])).toBe(
      'Changed 1 file (+3 −0) with Claude Code'
    )
  })

  it('tells the editor and the agent apart when both changed files', () => {
    const events = [edit('/a.ts', lines(200, 40), 'vscode'), edit('/b.ts', lines(120, 45), 'claude-code')]

    expect(describeChangedFiles(events)).toBe(
      'Changed 2 files (+320 −85): 1 in the editor (+200 −40), 1 with Claude Code (+120 −45)'
    )
  })

  it('counts a file both changed once in the total, and says so', () => {
    const events = [edit('/a.ts', lines(1, 1), 'vscode'), edit('/a.ts', lines(2, 2), 'claude-code')]

    expect(changedFilesOf(events)?.total.files).toBe(1)
    expect(describeChangedFiles(events)).toBe(
      'Changed 1 file (+3 −3): 1 in the editor (+1 −1), 1 with Claude Code (+2 −2); 1 file changed by both'
    )
  })

  it('tells earlier edits that kept no file, beside the files it does know', () => {
    const events = [edit('/a.ts', lines(2, 0)), edit(undefined, lines(1, 1)), edit(undefined, lines(1, 1))]

    expect(describeChangedFiles(events)).toBe('Changed 1 file (+2 −0), plus 2 earlier edits with no file recorded')
  })

  it('does not count an edit with no file path, or any other event', () => {
    expect(describeChangedFiles([edit(undefined, lines(1, 1)), event('testing')])).toBeNull()
  })
})
