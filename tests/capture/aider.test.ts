import { describe, it, expect, vi } from 'vitest'

vi.mock('fs', () => ({ default: { readFileSync: vi.fn() } }))

import fs from 'fs'
import { readLastAiderPrompt } from '../../src/capture/aider'

const mockReadFileSync = fs.readFileSync as ReturnType<typeof vi.fn>

const SAMPLE_HISTORY = `
# aider chat started at 2026-05-28 09:00:00

> refactor the payment service to extract billing logic into a separate module

Some AI response here.

> add tests for the new billing module

Another AI response.
`.trim()

describe('readLastAiderPrompt', () => {
  it('returns the last user prompt from the history file', () => {
    mockReadFileSync.mockReturnValue(SAMPLE_HISTORY)
    expect(readLastAiderPrompt('/repo')).toBe('add tests for the new billing module')
  })

  it('returns the only prompt when there is one message', () => {
    mockReadFileSync.mockReturnValue('> implement OAuth2 login flow\n\nSome response.')
    expect(readLastAiderPrompt('/repo')).toBe('implement OAuth2 login flow')
  })

  it('truncates prompts longer than 200 characters', () => {
    const longPrompt = 'a'.repeat(250)
    mockReadFileSync.mockReturnValue(`> ${longPrompt}`)
    const result = readLastAiderPrompt('/repo')
    expect(result).toHaveLength(200)
  })

  it('returns null when no user prompts are found', () => {
    mockReadFileSync.mockReturnValue('# aider chat started\n\nSome content without prompts.')
    expect(readLastAiderPrompt('/repo')).toBeNull()
  })

  it('returns null when the history file does not exist', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })
    expect(readLastAiderPrompt('/repo')).toBeNull()
  })

  it('returns null when the file is empty', () => {
    mockReadFileSync.mockReturnValue('')
    expect(readLastAiderPrompt('/repo')).toBeNull()
  })

  it('reads from the correct path within cwd', () => {
    mockReadFileSync.mockReturnValue('> fix the bug')
    readLastAiderPrompt('/home/user/myproject')
    expect(mockReadFileSync).toHaveBeenCalledWith('/home/user/myproject/.aider.chat.history.md', 'utf-8')
  })
})
