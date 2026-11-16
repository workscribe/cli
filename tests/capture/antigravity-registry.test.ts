import { describe, it, expect } from 'vitest'
import { loadAIToolRegistry } from '../../src/config/registry'
import { AI_HOOK_INTEGRATIONS } from '../../src/capture/hooks'
import { agentNameOf, isAgentEvent } from '../../src/ai/engines/template/agents'

describe('the Antigravity registry entry', () => {
  const entry = loadAIToolRegistry().find((tool) => tool.tool === 'antigravity')

  it('names the agy command and the integration that captures it', () => {
    expect(entry).toMatchObject({ displayName: 'Antigravity', hook: 'antigravity', contextSource: null })
    expect(new RegExp(entry!.pattern).test('agy -p "fix the build"')).toBe(true)
    expect(new RegExp(entry!.pattern).test('agyx')).toBe(false)
    expect(AI_HOOK_INTEGRATIONS[entry!.hook!].source).toBe('antigravity')
  })

  it('makes an event from its hook an agent event, named in summaries', () => {
    expect(agentNameOf('antigravity')).toBe('Antigravity')
    expect(isAgentEvent({ source: 'antigravity' })).toBe(true)
  })
})
