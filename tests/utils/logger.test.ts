import { describe, it, expect, vi, onTestFinished } from 'vitest'

describe('log.notice', () => {
  it('writes to stderr only, so JSON output on stdout stays clean', async () => {
    // tests/setup.ts mocks the logger for every test — load the real one here
    const { log } = await vi.importActual<typeof import('../../src/utils/logger')>('../../src/utils/logger')
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const stdoutSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    onTestFinished(() => {
      stderrSpy.mockRestore()
      stdoutSpy.mockRestore()
    })

    log.notice('AI providers were removed')

    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('AI providers were removed'))
    expect(stdoutSpy).not.toHaveBeenCalled()
  })
})
