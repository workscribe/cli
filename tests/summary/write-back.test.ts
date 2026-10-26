import { describe, it, expect } from 'vitest'
import {
  INTERACTIVE_STDIN_MESSAGE,
  MAX_SKILL_SUMMARY_BYTES,
  stdinReadFailedMessage,
  validateSkillSummary,
} from '../../src/summary/write-back'

describe('validateSkillSummary', () => {
  it('accepts a normal summary', () => {
    expect(validateSkillSummary('## api — 1h\n- Fixed the token refresh race')).toBeNull()
  })

  it('explains how to send text when none arrived', () => {
    const message = validateSkillSummary('  \n ')

    expect(message).toContain('Nothing to save')
    expect(message).toContain("<<'EOF'")
  })

  it('counts the limit in bytes, not characters', () => {
    const atLimitInCharacters = 'é'.repeat(MAX_SKILL_SUMMARY_BYTES)

    expect(validateSkillSummary(atLimitInCharacters)).toContain(
      'too long to save (16,384 bytes; the limit is 8,192, about 8 KB)'
    )
    expect(validateSkillSummary('a'.repeat(MAX_SKILL_SUMMARY_BYTES))).toBeNull()
  })
})

describe('stdin messages', () => {
  it('shows how to send the text when stdin is a terminal', () => {
    expect(INTERACTIVE_STDIN_MESSAGE).toContain("can't be typed in here")
    expect(INTERACTIVE_STDIN_MESSAGE).toContain("<<'EOF'")
  })

  it('includes the reason a read failed', () => {
    expect(stdinReadFailedMessage(new Error('EAGAIN'))).toBe("Couldn't read the summary text that was sent in: EAGAIN")
  })
})
