import { SKILL_AGENTS } from '../../src/skills/agents'
import type { SkillAgent } from '../../src/skills/types'

/** A registry agent by id — throws on a typo so a test can't silently run with `undefined`. */
export function skillAgent(id: string): SkillAgent {
  const found = SKILL_AGENTS.find((agent) => agent.id === id)
  if (!found) throw new Error(`No skill agent with id "${id}" — check SKILL_AGENTS in src/skills/agents.ts`)
  return found
}
