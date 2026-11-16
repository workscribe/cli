import { readdirSync, readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'
import { parseAntigravityHook } from '../../src/capture/hooks/antigravity-payload'

// Antigravity CLI 1.5.0's recorded payloads (WOR-154), read the way the hook reads them
const FIXTURES = join(__dirname, '..', 'fixtures', 'agent-hooks', 'antigravity', '1.5.0')
const read = (name: string) => readFileSync(join(FIXTURES, name), 'utf8')
const WORKSPACE = '/Users/dev/api'

describe('parseAntigravityHook: commands', () => {
  it.each(['command-success.json', 'command-exit-3.json', 'command-heredoc.json', 'commit-rejected.json'])(
    'reads %s as a command in the workspace folder, with no exit code (the payload has none)',
    (name) => {
      const event = parseAntigravityHook(read(name), 'PostToolUse')

      expect(event).toMatchObject({
        kind: 'command',
        cwd: WORKSPACE,
        outcome: { kind: 'unknown' },
        durationMs: null,
        sessionId: expect.any(String),
      })
    }
  )

  it('keeps the whole command, a multi-line one included', () => {
    const event = parseAntigravityHook(read('command-heredoc.json'), 'PostToolUse')

    expect(event).toMatchObject({ command: "cat <<'PROBE'\nprobe line one\nprobe line two\nPROBE" })
  })

  it('uses the workspace folder when the command changed folder', () => {
    expect(parseAntigravityHook(read('command-cd-subfolder.json'), 'PostToolUse')).toMatchObject({ cwd: WORKSPACE })
  })

  it('reads a tool call that failed itself as a failed command', () => {
    const payload = { ...JSON.parse(read('command-success.json')), error: 'tool call was cancelled' }

    expect(parseAntigravityHook(JSON.stringify(payload), 'PostToolUse')).toMatchObject({
      kind: 'command',
      outcome: { kind: 'failed' },
    })
  })
})

describe('parseAntigravityHook: edits', () => {
  it('reads edit_file as an edit with the lines it replaced and the lines it wrote', () => {
    expect(parseAntigravityHook(read('edit-file.json'), 'PostToolUse')).toMatchObject({
      kind: 'edit',
      file: `${WORKSPACE}/app.txt`,
      cwd: WORKSPACE,
      linesAdded: 1,
      linesRemoved: 1,
    })
  })

  it('counts every line of a multi-line edit', () => {
    expect(parseAntigravityHook(read('edit-file-multi-line.json'), 'PostToolUse')).toMatchObject({
      linesAdded: 3,
      linesRemoved: 3,
    })
  })

  it('reads a new file as all lines added and none removed', () => {
    expect(parseAntigravityHook(read('write-new-file.json'), 'PostToolUse')).toMatchObject({
      kind: 'edit',
      file: `${WORKSPACE}/created.txt`,
      linesAdded: 1,
      linesRemoved: 0,
    })
  })

  it('leaves the removed lines unknown for an overwrite, which does not say what it replaced', () => {
    expect(parseAntigravityHook(read('write-overwrite-file.json'), 'PostToolUse')).toMatchObject({
      kind: 'edit',
      linesAdded: 1,
      linesRemoved: null,
    })
  })

  it('drops an edit whose tool call failed: it changed nothing', () => {
    expect(parseAntigravityHook(read('edit-missing-file.json'), 'PostToolUse')).toBeNull()
  })
})

describe('parseAntigravityHook: what it ignores', () => {
  it('ignores a read_file call, which also fires PostToolUse', () => {
    expect(parseAntigravityHook(read('read-file.json'), 'PostToolUse')).toBeNull()
  })

  it.each(['session-start.json', 'pre-invocation.json', 'post-invocation.json', 'stop.json'])(
    'ignores the payload of %s, whatever event it arrives as',
    (name) => {
      expect(parseAntigravityHook(read(name), 'PostToolUse')).toBeNull()
      expect(parseAntigravityHook(read('command-success.json'), 'Stop')).toBeNull()
    }
  )

  it('drops a payload with no workspace folder, no command or no file', () => {
    const command = JSON.parse(read('command-success.json'))
    const edit = JSON.parse(read('edit-file.json'))

    expect(parseAntigravityHook(JSON.stringify({ ...command, workspacePaths: [] }), 'PostToolUse')).toBeNull()
    expect(
      parseAntigravityHook(JSON.stringify({ ...command, toolCall: { name: 'run_command', args: {} } }), 'PostToolUse')
    ).toBeNull()
    expect(
      parseAntigravityHook(JSON.stringify({ ...edit, toolCall: { name: 'edit_file', args: {} } }), 'PostToolUse')
    ).toBeNull()
    expect(parseAntigravityHook('{}', 'PostToolUse')).toBeNull()
    expect(parseAntigravityHook('', 'PostToolUse')).toBeNull()
  })

  it('throws on invalid JSON, which the dispatcher catches', () => {
    expect(() => parseAntigravityHook('not-json', 'PostToolUse')).toThrow()
  })
})

describe('parseAntigravityHook: what it never stores', () => {
  it('holds no user text and no file text in any event it returns', () => {
    const events = readdirSync(FIXTURES)
      .filter((name) => name.endsWith('.json'))
      .map((name) => parseAntigravityHook(read(name), 'PostToolUse'))
      .filter((event) => event !== null)

    expect(events.length).toBeGreaterThan(0)
    for (const event of events) {
      expect(JSON.stringify(event)).not.toMatch(/hook test in a throwaway repo|"alpha"|"beta"|overwritten|toolSummary/)
    }
  })
})
