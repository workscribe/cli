import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest'

vi.mock('../../src/sessions/detector', () => ({ getOrBuildSessions: vi.fn() }))
vi.mock('../../src/db', () => ({ saveSessionSummary: vi.fn() }))
vi.mock('../../src/config', () => ({ readConfig: vi.fn() }))
vi.mock('../../src/utils/stdin', () => ({ isStdinInteractive: vi.fn(), readAllStdin: vi.fn() }))

import { Command } from 'commander'
import { getOrBuildSessions } from '../../src/sessions/detector'
import { saveSessionSummary } from '../../src/db'
import { readConfig } from '../../src/config'
import { isStdinInteractive, readAllStdin } from '../../src/utils/stdin'
import { MAX_SKILL_SUMMARY_BYTES } from '../../src/summary/write-back'
import { log } from '../../src/utils/logger'
import { registerSummarySet } from '../../src/cli/session-summary'
import { createTestConfig } from '../helpers/config'

const mockLog = log as Record<string, ReturnType<typeof vi.fn>>
const STARTED_AT = '2026-10-25T09:00:00.000Z'
const KEY = `api|${STARTED_AT}`
const SESSION = {
  id: 1,
  date: '2026-10-25',
  startedAt: STARTED_AT,
  endedAt: '2026-10-25T10:00:00.000Z',
  repoName: 'api',
  durationMinutes: 60,
  eventCount: 3,
  summary: null,
  events: [],
}

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerSummarySet(program.command('sessions'))
  return program
}

function setSummary(key = KEY) {
  return makeProgram().parseAsync(['sessions', 'summary', 'set', '--key', key], { from: 'user' })
}

function stubExit() {
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
    throw new Error('exit')
  }) as never)
  onTestFinished(() => exitSpy.mockRestore())
  return exitSpy
}

beforeEach(() => {
  vi.mocked(readConfig).mockReturnValue(createTestConfig({ redact: { extra: ['INTERNAL-[0-9]+'] } }))
  vi.mocked(getOrBuildSessions).mockReturnValue([SESSION])
  vi.mocked(isStdinInteractive).mockReturnValue(false)
  vi.mocked(readAllStdin).mockReturnValue('## api — 1h\n- Fixed the token refresh race\n')
})

describe('workscribe sessions summary set', () => {
  it('saves the summary under the skill engine for the matching session', async () => {
    await setSummary()

    expect(getOrBuildSessions).toHaveBeenCalledWith('2026-10-25')
    expect(saveSessionSummary).toHaveBeenCalledWith(KEY, {
      engine: 'skill',
      text: '## api — 1h\n- Fixed the token refresh race',
      anchor: expect.objectContaining({ firstEventId: null, lastEventId: null, projectId: null }),
    })
    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining('Saved the summary for api'))
  })

  it("anchors the summary to the session's events, with no project while they aren't linked to one yet", async () => {
    const event = (id: number, capturedAt: string, projectId: number | null) => ({
      id,
      captured_at: capturedAt,
      command: 'npm test',
      cwd: '/repo',
      exit_code: 0,
      duration_ms: 10,
      repo_name: 'api',
      branch: 'main',
      category: 'testing',
      metadata: null,
      source: null,
      file_path: null,
      project_id: projectId,
    })
    vi.mocked(getOrBuildSessions).mockReturnValueOnce([
      { ...SESSION, events: [event(7, STARTED_AT, 4), event(9, '2026-10-25T09:30:00.000Z', 4)] },
    ])
    vi.mocked(getOrBuildSessions).mockReturnValueOnce([
      { ...SESSION, events: [event(7, STARTED_AT, null), event(9, '2026-10-25T09:30:00.000Z', null)] },
    ])

    await setSummary()
    await setSummary()

    const [[, linked], [, unlinked]] = vi.mocked(saveSessionSummary).mock.calls
    expect(linked.anchor).toMatchObject({ projectId: 4, firstEventId: 7, lastEventId: 9 })
    expect(unlinked.anchor).toMatchObject({ projectId: null, firstEventId: 7, lastEventId: 9, isUnlinked: true })
  })

  it("redacts secrets, including the user's extra patterns, before saving", async () => {
    vi.mocked(readAllStdin).mockReturnValue('- Rotated ghp_abcdefghijklmnopqrstuvwxyz0123456789 and INTERNAL-4421')

    await setSummary()

    const [, { text: saved }] = vi.mocked(saveSessionSummary).mock.calls[0]
    expect(saved).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(saved).not.toContain('INTERNAL-4421')
  })

  it.each([
    ['a malformed key', 'not-a-key', "isn't valid"],
    [
      'a key for a session that no longer exists',
      `api|2026-10-25T08:00:00.000Z`,
      'Run workscribe sessions --json again',
    ],
  ])('rejects %s without saving', async (_case, key, message) => {
    const exitSpy = stubExit()

    await expect(setSummary(key)).rejects.toThrow('exit')

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining(message))
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(saveSessionSummary).not.toHaveBeenCalled()
  })

  it.each([
    ['no text', '', 'Nothing to save'],
    ['an oversized summary', 'a'.repeat(MAX_SKILL_SUMMARY_BYTES + 1), 'too long to save'],
  ])('rejects %s without saving', async (_case, text, message) => {
    vi.mocked(readAllStdin).mockReturnValue(text)
    stubExit()

    await expect(setSummary()).rejects.toThrow('exit')

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining(message))
    expect(saveSessionSummary).not.toHaveBeenCalled()
  })

  it('refuses an interactive terminal without waiting for input', async () => {
    vi.mocked(isStdinInteractive).mockReturnValue(true)
    stubExit()

    await expect(setSummary()).rejects.toThrow('exit')

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining("can't be typed in here"))
    expect(readAllStdin).not.toHaveBeenCalled()
    expect(saveSessionSummary).not.toHaveBeenCalled()
  })

  it('reports a stdin read failure without saving', async () => {
    vi.mocked(readAllStdin).mockImplementation(() => {
      throw new Error('EAGAIN: resource temporarily unavailable')
    })
    stubExit()

    await expect(setSummary()).rejects.toThrow('exit')

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('EAGAIN'))
    expect(saveSessionSummary).not.toHaveBeenCalled()
  })

  it('finds a session for a day that has not been built yet by building that day', async () => {
    vi.mocked(getOrBuildSessions).mockImplementation((date: string) => (date === '2026-10-25' ? [SESSION] : []))

    await setSummary()

    expect(saveSessionSummary).toHaveBeenCalled()
  })

  it('rejects a key made stale when new activity regrouped the day', async () => {
    vi.mocked(getOrBuildSessions).mockReturnValue([{ ...SESSION, repoName: 'web' }])
    stubExit()

    await expect(setSummary()).rejects.toThrow('exit')

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('use the new key'))
    expect(saveSessionSummary).not.toHaveBeenCalled()
  })
})
