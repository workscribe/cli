// Whether the agent skill may be given the agent's own words — its recaps, and the description of each command. They are
// free text, so it takes two switches: `capture.agentMessages` to keep them at all and `skill.includeAgentMessages` to
// hand them to the skill. A pure function of the config, apart from `index.ts`, so tests that mock that file still run it.
import type { WorkscribeConfig } from './index'

export function mayShareAgentWords(config: {
  capture: Pick<WorkscribeConfig['capture'], 'agentMessages'>
  skill: Pick<WorkscribeConfig['skill'], 'includeAgentMessages'>
}): boolean {
  return config.capture.agentMessages === true && config.skill.includeAgentMessages === true
}
