import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'
import { parseEditPayload, parseSessionEventPayload } from '../../src/capture/hooks/claude-code-payload'

const FIXTURES = join(__dirname, '..', 'fixtures', 'agent-hooks', 'claude-code', '2.1.319')
const BASH_FIXTURE = join(__dirname, '..', 'fixtures', 'claude-code-hooks', 'post-tool-use-success.json')

function fixture(name: string): string {
  return readFileSync(join(FIXTURES, `${name}.json`), 'utf8')
}

function withChanges(name: string, change: (payload: Record<string, unknown>) => void): string {
  const payload = JSON.parse(fixture(name)) as Record<string, unknown>
  change(payload)
  return JSON.stringify(payload)
}

describe('parseEditPayload — recorded Claude Code 2.1.319 payloads', () => {
  it.each([
    ['edit', 'notes.txt', 2, 1],
    ['edit-replace-all', 'repeated.txt', 3, 3],
    ['edit-one-of-several', 'multi.txt', 1, 1],
    ['write-new-file', 'new.txt', 3, 0],
    ['write-overwrite-file', 'existing.txt', 1, 2],
    ['notebook-edit-replace', 'book.ipynb', 1, 2],
  ])('%s: %s, +%d −%d', (name, file, linesAdded, linesRemoved) => {
    expect(parseEditPayload(fixture(name))).toEqual({
      file: `/Users/dev/api/${file}`,
      cwd: '/Users/dev/api',
      linesAdded,
      linesRemoved,
      sessionId: '<session_id>',
    })
  })

  it('keeps no text from the edit', () => {
    const parsed = JSON.stringify(parseEditPayload(fixture('edit')))

    expect(parsed).not.toContain('line 2a')
    expect(parsed).not.toContain('line two')
  })
})

describe('parseEditPayload — without a patch', () => {
  const withoutPatch = (name: string) =>
    withChanges(name, (payload) => {
      delete (payload.tool_response as Record<string, unknown>).structuredPatch
    })

  it('counts an edit from its strings', () => {
    expect(parseEditPayload(withoutPatch('edit'))).toMatchObject({ linesAdded: 2, linesRemoved: 1 })
  })

  it("doesn't guess a replace-all edit's counts", () => {
    expect(parseEditPayload(withoutPatch('edit-replace-all'))).toMatchObject({ linesAdded: null, linesRemoved: null })
  })

  it('knows what an overwrite added but not what it replaced', () => {
    expect(parseEditPayload(withoutPatch('write-overwrite-file'))).toMatchObject({ linesAdded: 1, linesRemoved: null })
  })

  it('sums the edits of a MultiEdit', () => {
    const multiEdit = JSON.stringify({
      tool_name: 'MultiEdit',
      cwd: '/Users/dev/api',
      tool_input: {
        file_path: '/Users/dev/api/a.ts',
        edits: [
          { old_string: 'a', new_string: 'b\nc' },
          { old_string: 'd\ne', new_string: 'f' },
        ],
      },
    })

    expect(parseEditPayload(multiEdit)).toMatchObject({ linesAdded: 3, linesRemoved: 3, sessionId: null })
  })

  it("doesn't call a MultiEdit with no edits listed a change of nothing", () => {
    const multiEdit = JSON.stringify({
      tool_name: 'MultiEdit',
      cwd: '/Users/dev/api',
      tool_input: { file_path: '/Users/dev/api/a.ts' },
    })

    expect(parseEditPayload(multiEdit)).toMatchObject({ linesAdded: null, linesRemoved: null })
  })
})

describe('parseEditPayload — what it ignores', () => {
  it('ignores a Bash payload and a payload with no file or folder', () => {
    expect(parseEditPayload(readFileSync(BASH_FIXTURE, 'utf8'))).toBeNull()
    expect(parseEditPayload(withChanges('edit', (payload) => delete payload.cwd))).toBeNull()
    expect(
      parseEditPayload(
        withChanges('edit', (payload) => delete (payload.tool_input as Record<string, unknown>).file_path)
      )
    ).toBeNull()
    expect(parseEditPayload('')).toBeNull()
  })
})

describe('parseSessionEventPayload', () => {
  it("reads Stop's last reply", () => {
    expect(parseSessionEventPayload(fixture('stop'), 'Stop')).toEqual({
      sessionId: '<session_id>',
      message: expect.stringContaining('I made changes 1–6'),
      reason: null,
    })
  })

  it("reads PostCompact's summary", () => {
    expect(parseSessionEventPayload(fixture('post-compact'), 'PostCompact')?.message).toContain('<summary>')
  })

  it("reads SessionEnd's reason and no message", () => {
    expect(parseSessionEventPayload(fixture('session-end'), 'SessionEnd')).toEqual({
      sessionId: '<session_id>',
      message: null,
      reason: 'other',
    })
  })

  it('is null without a session id', () => {
    expect(
      parseSessionEventPayload(
        withChanges('stop', (payload) => delete payload.session_id),
        'Stop'
      )
    ).toBeNull()
  })
})
