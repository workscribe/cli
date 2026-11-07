import { execFileSync } from 'child_process'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, it, expect } from 'vitest'
import { sanitizePayload } from '../../scripts/agent-capture/sanitize-fixture.js'

const FIXTURES_ROOT = join(__dirname, '..', 'fixtures', 'agent-hooks')
const RECORDER = join(__dirname, '..', '..', 'scripts', 'agent-capture', 'record-hook.js')

const REAL_HOME_PATH = /\/(?:Users|home)\/(?!dev(?:[/"\s]|$))[^/"<\s]+/
// How a home path looks once a tool has flattened it into a folder name, as in a scratch folder a shell prompt shows
const FLATTENED_HOME_PATH = /-(?:Users|home)-[^/"<\s]+/
const EMAIL_ADDRESS = /[\w.+-]+@[\w-]+\.[\w.-]+/
const RAW_UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i

function fixtureFiles(): string[] {
  if (!existsSync(FIXTURES_ROOT)) return []
  return readdirSync(FIXTURES_ROOT, { recursive: true, encoding: 'utf8' })
    .filter((relativePath) => relativePath.endsWith('.json'))
    .map((relativePath) => join(FIXTURES_ROOT, relativePath))
}

describe('agent hook fixtures', () => {
  it('parse, and hold no real path, email address or raw id', () => {
    for (const file of fixtureFiles()) {
      const text = readFileSync(file, 'utf8')
      expect(() => JSON.parse(text), file).not.toThrow()
      expect(text, file).not.toMatch(REAL_HOME_PATH)
      expect(text, file).not.toMatch(FLATTENED_HOME_PATH)
      expect(text, file).not.toMatch(EMAIL_ADDRESS)
      expect(text, file).not.toMatch(RAW_UUID)
    }
  })
})

describe('sanitizePayload', () => {
  const machine = {
    scratchFolder: '/private/tmp/capture-run',
    homeFolder: '/Users/someone',
    hostName: 'someones-laptop',
  }

  it('replaces ids and private paths by key, keeping the shape', () => {
    const fixture = sanitizePayload(
      { conversationId: 'abc', transcriptPath: '/Users/someone/t.jsonl', stepIdx: 5, error: null },
      machine
    )
    expect(fixture).toEqual({
      conversationId: '<conversationId>',
      transcriptPath: '<transcriptPath>',
      stepIdx: 5,
      error: null,
    })
  })

  it('rewrites the scratch folder in either spelling, then the home folder, at any depth', () => {
    const fixture = sanitizePayload(
      {
        workspacePaths: ['/tmp/capture-run', '/private/tmp/capture-run/sub'],
        toolCall: { args: { Cwd: '/Users/someone/elsewhere' } },
      },
      machine
    )
    expect(fixture).toEqual({
      workspacePaths: ['/Users/dev/api', '/Users/dev/api/sub'],
      toolCall: { args: { Cwd: '/Users/dev/elsewhere' } },
    })
  })

  it('replaces ids, email addresses and the machine name inside text', () => {
    const fixture = sanitizePayload(
      { note: 'ec33ebf9-0cba-4100-8142-c61503f6c587 by someone@example.com on someones-laptop' },
      machine
    )
    expect(fixture).toEqual({ note: '<uuid> by <email> on <hostname>' })
  })

  it('replaces terminal output, but keeps an empty response empty', () => {
    const terminal = sanitizePayload({ tool_response: 'exit 1 at /private/tm/-Users-someone-sandbox' }, machine)
    const edit = sanitizePayload({ tool_response: '' }, machine)
    expect(terminal).toEqual({ tool_response: '<tool_response>' })
    expect(edit).toEqual({ tool_response: '' })
  })

  it('does not change its input', () => {
    const payload = { sessionId: 'abc' }
    sanitizePayload(payload, machine)
    expect(payload).toEqual({ sessionId: 'abc' })
  })
})

describe('record-hook', () => {
  const captureDirectories: string[] = []

  function runRecorder(options: { hookEvent: string; stdin: string; captureDirectory: string }): string {
    return execFileSync(process.execPath, [RECORDER, options.hookEvent], {
      input: options.stdin,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'ignore'],
      env: { PATH: process.env.PATH, WORKSCRIBE_CAPTURE_DIR: options.captureDirectory, SECRET_VALUE: 'hunter2' },
    })
  }

  function newCaptureDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), 'record-hook-'))
    captureDirectories.push(directory)
    return directory
  }

  function onlyRecording(directory: string): string {
    const [file] = readdirSync(directory)
    return readFileSync(join(directory, file), 'utf8')
  }

  afterEach(() => {
    captureDirectories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true }))
  })

  it('records the payload and environment names, never their values', () => {
    const captureDirectory = newCaptureDirectory()
    const output = runRecorder({ hookEvent: 'PostToolUse', stdin: '{"stepIdx":5}', captureDirectory })

    expect(output).toBe('{}')
    const text = onlyRecording(captureDirectory)
    expect(JSON.parse(text)).toMatchObject({ hookEvent: 'PostToolUse', payload: { stepIdx: 5 } })
    expect(JSON.parse(text).environmentVariableNames).toContain('SECRET_VALUE')
    expect(text).not.toContain('hunter2')
  })

  it('answers Stop with the decision that lets the agent stop', () => {
    const output = runRecorder({ hookEvent: 'Stop', stdin: '{}', captureDirectory: newCaptureDirectory() })
    expect(JSON.parse(output)).toEqual({ decision: 'allow' })
  })

  it('keeps a payload that is not JSON as text', () => {
    const captureDirectory = newCaptureDirectory()
    runRecorder({ hookEvent: 'PostToolUse', stdin: 'not json', captureDirectory })
    expect(JSON.parse(onlyRecording(captureDirectory)).payload).toBe('not json')
  })

  it('still answers, and exits 0, when it cannot write', () => {
    const missingDirectory = join(newCaptureDirectory(), 'missing')
    const output = runRecorder({ hookEvent: 'PostToolUse', stdin: '{}', captureDirectory: missingDirectory })
    expect(output).toBe('{}')
  })
})
