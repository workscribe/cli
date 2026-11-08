import { describe, it, expect } from 'vitest'
import {
  AGENT_MESSAGE_MAX_CHARS,
  END_REASON_MAX_CHARS,
  storableAgentMessage,
  storableEndReason,
} from '../../src/capture/agent-messages'

// A token the built-in redaction recognises, so the secret check flags the message holding it
const GITHUB_TOKEN = `ghp_${'a1B2c3D4e5'.repeat(4)}`

describe('storableAgentMessage', () => {
  it('keeps a plain recap, trimmed', () => {
    expect(storableAgentMessage('  Added line counts to edits.\n', [])).toBe('Added line counts to edits.')
  })

  it('drops a message the secret check flags, whole', () => {
    expect(storableAgentMessage(`Set GITHUB_TOKEN to ${GITHUB_TOKEN} and retried`, [])).toBeNull()
  })

  it("applies the user's own patterns", () => {
    expect(storableAgentMessage('Deployed to internal-staging', ['internal-[a-z]+'])).toBe('Deployed to [REDACTED]')
  })

  it('caps a long message without splitting an emoji in two', () => {
    const stored = storableAgentMessage(`${'a'.repeat(AGENT_MESSAGE_MAX_CHARS - 1)}🎉🎉`, []) ?? ''

    expect(Array.from(stored)).toHaveLength(AGENT_MESSAGE_MAX_CHARS)
    expect(stored.endsWith('🎉')).toBe(true)
  })

  it('stores nothing for a message that is only whitespace', () => {
    expect(storableAgentMessage(' \n ', [])).toBeNull()
  })
})

describe('storableEndReason', () => {
  it('keeps a short reason and caps a long one', () => {
    expect(storableEndReason('other')).toBe('other')
    expect(storableEndReason('x'.repeat(100))).toHaveLength(END_REASON_MAX_CHARS)
    expect(storableEndReason(null)).toBeNull()
  })
})
