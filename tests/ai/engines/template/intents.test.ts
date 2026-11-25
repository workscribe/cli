import { describe, it, expect } from 'vitest'
import { describeIntents } from '../../../../src/ai/engines/template/intents'
import { event } from './fixtures'
import type { EventPayload } from '../../../../src/ai/types'

const byAgent = (intent: string | undefined, category = 'running', source = 'claude-code'): EventPayload => ({
  ...event(category, intent === undefined ? {} : { intent }),
  source,
  agentSessionId: 1,
})

describe('describeIntents', () => {
  it('names the agent and what it said it was doing', () => {
    expect(describeIntents([byAgent('Check the plan')])).toBe('Claude Code: Check the plan')
  })

  it('tells up to three different intents, in the order they were given', () => {
    const events = ['Check the plan', 'Show recent commits', 'List the docs', 'Run the tests'].map((intent) =>
      byAgent(intent)
    )

    expect(describeIntents(events)).toBe('Claude Code: Check the plan; Show recent commits; List the docs')
  })

  it('tells an intent once, however many commands it described', () => {
    const events = [byAgent('Run the tests'), byAgent('Show the diff'), byAgent('Run the tests')]

    expect(describeIntents(events)).toBe('Claude Code: Run the tests; Show the diff')
  })

  it('cuts a long intent like the first sentence of a recap', () => {
    const long = `${'Check the retention plan and read every module it names '.repeat(4)}now. Then more.`

    const line = describeIntents([byAgent(long)]) ?? ''

    expect(line.startsWith('Claude Code: Check the retention plan')).toBe(true)
    expect(line.length).toBeLessThanOrEqual('Claude Code: '.length + 100)
    expect(line.endsWith('…')).toBe(true)
  })

  it('reads an intent whatever category its event was filed under', () => {
    const events = [byAgent('Read it', 'exploring'), byAgent('Run it', 'other'), byAgent('List it', 'files')]

    expect(describeIntents(events)).toBe('Claude Code: Read it; Run it; List it')
  })

  it('says nothing when no event has an intent, or one that is not text or is empty', () => {
    expect(describeIntents([byAgent(undefined)])).toBeNull()
    expect(describeIntents([{ ...event('running', { intent: 42 }), source: 'claude-code' }])).toBeNull()
    expect(describeIntents([byAgent('   ')])).toBeNull()
    expect(describeIntents([])).toBeNull()
  })

  it('says nothing for an intent no coding agent gave', () => {
    expect(describeIntents([byAgent('Run it', 'running', 'vscode')])).toBeNull()
    expect(describeIntents([{ ...event('running', { intent: 'Run it' }) }])).toBeNull()
  })
})
