import { describe, it, expect } from 'vitest'
import { mayShareAgentWords } from '../../src/config/agent-words'

const config = (agentMessages: boolean, includeAgentMessages: boolean) => ({
  capture: { agentMessages },
  skill: { includeAgentMessages },
})

describe('mayShareAgentWords', () => {
  it('is true only when the agents words are kept and the skill is to get them', () => {
    expect(mayShareAgentWords(config(true, true))).toBe(true)
    expect(mayShareAgentWords(config(true, false))).toBe(false)
    expect(mayShareAgentWords(config(false, true))).toBe(false)
    expect(mayShareAgentWords(config(false, false))).toBe(false)
  })

  it('is false for a setting that is missing or is not the boolean true', () => {
    expect(mayShareAgentWords({ capture: {}, skill: {} } as never)).toBe(false)
    expect(mayShareAgentWords({ capture: { agentMessages: 'yes' }, skill: { includeAgentMessages: 1 } } as never)).toBe(
      false
    )
  })
})
