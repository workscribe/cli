import { describe, it, expect, vi } from 'vitest'

vi.mock('../../src/capture', () => ({
  captureCommand: vi.fn(),
}))

import { Command } from 'commander'
import { captureCommand } from '../../src/capture'
import { registerCapture } from '../../src/cli/capture'

const mockCaptureCommand = captureCommand as ReturnType<typeof vi.fn>

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerCapture(program)
  return program
}

describe('workscribe _capture', () => {
  describe('missing required options', () => {
    it('does not call captureCommand when --cmd is absent', async () => {
      await makeProgram().parseAsync(['_capture', '--cwd', '/repo'], { from: 'user' })
      expect(mockCaptureCommand).not.toHaveBeenCalled()
    })

    it('does not call captureCommand when --cwd is absent', async () => {
      await makeProgram().parseAsync(['_capture', '--cmd', 'git status'], { from: 'user' })
      expect(mockCaptureCommand).not.toHaveBeenCalled()
    })

    it('does not call captureCommand when both are absent', async () => {
      await makeProgram().parseAsync(['_capture'], { from: 'user' })
      expect(mockCaptureCommand).not.toHaveBeenCalled()
    })
  })

  describe('valid invocation', () => {
    it('calls captureCommand with correct args', async () => {
      await makeProgram().parseAsync(
        ['_capture', '--cmd', 'git commit', '--cwd', '/repo', '--exit', '0', '--duration', '150'],
        { from: 'user' }
      )
      expect(mockCaptureCommand).toHaveBeenCalledWith({
        command: 'git commit',
        cwd: '/repo',
        exitCode: 0,
        durationMs: 150,
        gitBefore: undefined,
      })
    })

    it('passes null for optional numeric args when omitted', async () => {
      await makeProgram().parseAsync(['_capture', '--cmd', 'ls', '--cwd', '/'], { from: 'user' })
      expect(mockCaptureCommand).toHaveBeenCalledWith({
        command: 'ls',
        cwd: '/',
        exitCode: null,
        durationMs: null,
        gitBefore: undefined,
      })
    })

    it('passes gitBefore when --git-before is provided', async () => {
      await makeProgram().parseAsync(['_capture', '--cmd', 'git push', '--cwd', '/repo', '--git-before', 'abc123'], {
        from: 'user',
      })
      expect(mockCaptureCommand).toHaveBeenCalledWith(expect.objectContaining({ gitBefore: 'abc123' }))
    })
  })

  describe('error handling', () => {
    it('swallows errors thrown by captureCommand without surfacing them', async () => {
      mockCaptureCommand.mockImplementation(() => {
        throw new Error('DB write failed')
      })
      await expect(
        makeProgram().parseAsync(['_capture', '--cmd', 'npm install', '--cwd', '/repo'], { from: 'user' })
      ).resolves.not.toThrow()
    })
  })
})
