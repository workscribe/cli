import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest'

vi.mock('../../src/db', () => ({ getDb: vi.fn(() => ({})), saveThreadSummary: vi.fn() }))
vi.mock('../../src/db/day-threads', () => ({ isReadyForThreads: vi.fn(), readDayThreads: vi.fn() }))
vi.mock('../../src/sessions/threads', () => ({ ensureDayThreads: vi.fn() }))
vi.mock('../../src/config', () => ({ readConfig: vi.fn() }))
vi.mock('../../src/utils/stdin', () => ({ isStdinInteractive: vi.fn(), readAllStdin: vi.fn() }))

import { Command } from 'commander'
import { isReadyForThreads, readDayThreads } from '../../src/db/day-threads'
import { ensureDayThreads } from '../../src/sessions/threads'
import { saveThreadSummary } from '../../src/db'
import { readConfig } from '../../src/config'
import { isStdinInteractive, readAllStdin } from '../../src/utils/stdin'
import { MAX_SKILL_SUMMARY_BYTES } from '../../src/summary/write-back'
import { log } from '../../src/utils/logger'
import { registerSummarySet } from '../../src/cli/session-summary'
import { createTestConfig } from '../helpers/config'
import { block, row, thread } from '../summary/contract/fixtures'

const mockLog = log as Record<string, ReturnType<typeof vi.fn>>
const STARTED_AT = '2026-10-25T09:00:00.000Z'
const KEY = `api|${STARTED_AT}`
const API = thread([row({ id: 7, captured_at: STARTED_AT }), row({ id: 9, captured_at: '2026-10-25T09:30:00.000Z' })], {
  id: 1,
  projectId: 4,
  key: KEY,
  repoName: 'api',
  startedAt: STARTED_AT,
})
const WEB = thread([row({ id: 8, repo_name: 'web' })], {
  id: 2,
  projectId: 5,
  key: 'web|2026-10-25T09:10:00.000Z',
  repoName: 'web',
})

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
  vi.mocked(isReadyForThreads).mockReturnValue(true)
  vi.mocked(readDayThreads).mockReturnValue([block([API, WEB])])
  vi.mocked(isStdinInteractive).mockReturnValue(false)
  vi.mocked(readAllStdin).mockReturnValue('## api — 1h\n- Fixed the token refresh race\n')
})

describe('workscribe sessions summary set', () => {
  it("saves the summary under the skill engine, anchored to the thread's project and its first and last events", async () => {
    await setSummary()

    expect(ensureDayThreads).toHaveBeenCalledWith('2026-10-25')
    expect(readDayThreads).toHaveBeenCalledWith(expect.anything(), '2026-10-25')
    expect(saveThreadSummary).toHaveBeenCalledWith(KEY, {
      engine: 'skill',
      text: '## api — 1h\n- Fixed the token refresh race',
      anchor: { projectId: 4, firstEventId: 7, lastEventId: 9, isMixed: false },
    })
    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining('Saved the summary for api'))
    expect(mockLog.success).toHaveBeenCalledWith(expect.stringContaining('workscribe context'))
  })

  it('saves for the "elsewhere" thread with no project', async () => {
    const elsewhere = thread([row({ id: 3, repo_name: null })], {
      projectId: null,
      repoName: null,
      key: `|${STARTED_AT}`,
    })
    vi.mocked(readDayThreads).mockReturnValue([block([elsewhere])])

    await setSummary(`|${STARTED_AT}`)

    const [[, { anchor }]] = vi.mocked(saveThreadSummary).mock.calls
    expect(anchor).toEqual({ projectId: null, firstEventId: 3, lastEventId: 3, isMixed: false })
  })

  it("redacts secrets, including the user's extra patterns, before saving", async () => {
    vi.mocked(readAllStdin).mockReturnValue('- Rotated ghp_abcdefghijklmnopqrstuvwxyz0123456789 and INTERNAL-4421')

    await setSummary()

    const [, { text: saved }] = vi.mocked(saveThreadSummary).mock.calls[0]
    expect(saved).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789')
    expect(saved).not.toContain('INTERNAL-4421')
  })

  it.each([
    ['a malformed key', 'not-a-key', "isn't valid"],
    [
      'a key that names no thread, such as an old session',
      `api|2026-10-25T08:00:00.000Z`,
      'Run workscribe sessions --json again',
    ],
  ])('rejects %s without saving', async (_case, key, message) => {
    const exitSpy = stubExit()

    await expect(setSummary(key)).rejects.toThrow('exit')

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining(message))
    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(saveThreadSummary).not.toHaveBeenCalled()
  })

  it('asks for workscribe upgrade, reading nothing, while old events are not linked to projects', async () => {
    vi.mocked(isReadyForThreads).mockReturnValue(false)
    stubExit()

    await expect(setSummary()).rejects.toThrow('exit')

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('run workscribe upgrade'))
    expect(readAllStdin).not.toHaveBeenCalled()
    expect(readDayThreads).not.toHaveBeenCalled()
    expect(saveThreadSummary).not.toHaveBeenCalled()
  })

  it.each([
    ['no text', '', 'Nothing to save'],
    ['an oversized summary', 'a'.repeat(MAX_SKILL_SUMMARY_BYTES + 1), 'too long to save'],
  ])('rejects %s without saving', async (_case, text, message) => {
    vi.mocked(readAllStdin).mockReturnValue(text)
    stubExit()

    await expect(setSummary()).rejects.toThrow('exit')

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining(message))
    expect(saveThreadSummary).not.toHaveBeenCalled()
  })

  it('refuses an interactive terminal without waiting for input', async () => {
    vi.mocked(isStdinInteractive).mockReturnValue(true)
    stubExit()

    await expect(setSummary()).rejects.toThrow('exit')

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining("can't be typed in here"))
    expect(readAllStdin).not.toHaveBeenCalled()
    expect(saveThreadSummary).not.toHaveBeenCalled()
  })

  it('reports a stdin read failure without saving', async () => {
    vi.mocked(readAllStdin).mockImplementation(() => {
      throw new Error('EAGAIN: resource temporarily unavailable')
    })
    stubExit()

    await expect(setSummary()).rejects.toThrow('exit')

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('EAGAIN'))
    expect(saveThreadSummary).not.toHaveBeenCalled()
  })

  it('rejects a key made stale when new activity regrouped the day', async () => {
    vi.mocked(readDayThreads).mockReturnValue([block([{ ...API, key: 'api|2026-10-25T08:55:00.000Z' }])])
    stubExit()

    await expect(setSummary()).rejects.toThrow('exit')

    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('use the new key'))
    expect(saveThreadSummary).not.toHaveBeenCalled()
  })
})
