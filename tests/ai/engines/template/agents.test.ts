import { describe, it, expect, vi } from 'vitest'

vi.mock('../../../../src/config/ai-tools.json', () => ({
  default: [
    { tool: 'claude', displayName: 'Claude Code', hook: 'claude-code' },
    { tool: 'cursor', displayName: 'Cursor', hook: 'cursor' },
    { tool: 'codex', displayName: 'Codex CLI', hook: 'codex' },
    { tool: 'aider', displayName: 'Aider', hook: null },
  ],
}))
vi.mock('../../../../src/config/registry', () => {
  throw new Error('the template must never load the registry, which reads the user file')
})

import { describeAgents } from '../../../../src/ai/engines/template/agents'
import { event } from './fixtures'

const by = (source: string, agentSessionId?: number) => ({
  ...event('testing'),
  source,
  ...(agentSessionId === undefined ? {} : { agentSessionId }),
})

describe('describeAgents', () => {
  it('names the agent and counts its distinct sessions', () => {
    expect(describeAgents([by('claude-code', 1), by('claude-code', 2), by('claude-code', 1)])).toBe(
      'Claude Code (2 sessions)'
    )
  })

  it('says one session in the singular', () => {
    expect(describeAgents([by('claude-code', 1), by('claude-code', 1)])).toBe('Claude Code (1 session)')
  })

  it('names two agents, in the order first seen, with the sessions of both', () => {
    expect(describeAgents([by('cursor', 3), by('claude-code', 1), by('claude-code', 2)])).toBe(
      'Cursor and Claude Code (3 sessions)'
    )
  })

  it('names three agents as a list', () => {
    expect(describeAgents([by('claude-code', 1), by('cursor', 2), by('codex', 3)])).toBe(
      'Claude Code, Cursor and Codex CLI (3 sessions)'
    )
  })

  it('leaves out the count when no event has a session id', () => {
    expect(describeAgents([by('claude-code'), by('claude-code')])).toBe('Claude Code')
  })

  it('adds nothing to the count for an event with no id', () => {
    expect(describeAgents([by('claude-code', 1), by('claude-code')])).toBe('Claude Code (1 session)')
  })

  it('names an agent whose events have no id alongside one whose do', () => {
    expect(describeAgents([by('claude-code', 1), by('cursor')])).toBe('Claude Code and Cursor (1 session)')
  })

  it.each(['vscode', 'zsh', 'aider', 'null', 'unknown-tool'])('never counts %s as an agent', (source) => {
    expect(describeAgents([by(source, 1)])).toBeNull()
  })

  it('ignores a session id on an event from any other source', () => {
    expect(describeAgents([by('claude-code', 1), by('vscode', 2)])).toBe('Claude Code (1 session)')
  })

  it('says nothing for events with no source, or no events', () => {
    expect(describeAgents([event('testing')])).toBeNull()
    expect(describeAgents([])).toBeNull()
  })
})
