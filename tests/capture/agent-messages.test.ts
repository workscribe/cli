import { describe, it, expect } from 'vitest'
import {
  AGENT_MESSAGE_MAX_CHARS,
  END_REASON_MAX_CHARS,
  INTENT_MAX_CHARS,
  storableAgentMessage,
  storableEndReason,
  storableIntent,
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

  it('drops a recap that quotes a credential assigned in code, whole', () => {
    expect(storableAgentMessage(`Ran node -e "const apiKey = '${GITHUB_TOKEN.slice(0, 20)}'" to check`, [])).toBeNull()
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

describe('storableIntent', () => {
  it('keeps the description Claude Code gave a command', () => {
    expect(storableIntent('Run the retention tests', [])).toBe('Run the retention tests')
  })

  it('collapses line breaks and runs of spaces into single spaces', () => {
    expect(storableIntent('  Check\n the   plan\t file \n', [])).toBe('Check the plan file')
  })

  it('drops a description the secret check flags, whole', () => {
    expect(storableIntent(`Export GITHUB_TOKEN=${GITHUB_TOKEN} and retry`, [])).toBeNull()
  })

  it("applies the user's own patterns", () => {
    expect(storableIntent('Deploy to internal-staging', ['internal-[a-z]+'])).toBe('Deploy to [REDACTED]')
  })

  it('keeps 200 characters exactly and cuts the 201st', () => {
    expect(storableIntent('a'.repeat(INTENT_MAX_CHARS), [])).toHaveLength(INTENT_MAX_CHARS)
    expect(storableIntent('a'.repeat(INTENT_MAX_CHARS + 1), [])).toHaveLength(INTENT_MAX_CHARS)
  })

  it('cuts without splitting an emoji in two', () => {
    const stored = storableIntent(`${'a'.repeat(INTENT_MAX_CHARS - 1)}🎉🎉`, []) ?? ''

    expect(Array.from(stored)).toHaveLength(INTENT_MAX_CHARS)
    expect(stored.endsWith('🎉')).toBe(true)
  })

  it('stores nothing for a description that is only whitespace, or empty', () => {
    expect(storableIntent(' \n\t ', [])).toBeNull()
    expect(storableIntent('', [])).toBeNull()
  })
})
