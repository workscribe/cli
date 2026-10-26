import { describe, it, expect } from 'vitest'
import {
  describeFolderAgents,
  describeInstallState,
  groupBySkillsFolder,
  joinAgentNames,
  outcomeWithoutPrompt,
} from '../../src/skills/state'
import { SKILL_AGENTS } from '../../src/skills/agents'
import { skillAgent as byId } from '../helpers/skill-agents'

describe('groupBySkillsFolder', () => {
  it('gives Codex and Copilot one shared folder', () => {
    const groups = groupBySkillsFolder(SKILL_AGENTS)

    expect(groups.map((group) => [group.skillsFolder, group.agents.map((agent) => agent.id)])).toEqual([
      ['.claude/skills', ['claude-code']],
      ['.agents/skills', ['codex', 'copilot']],
      ['.cursor/skills', ['cursor']],
    ])
  })

  it('handles no agents', () => {
    expect(groupBySkillsFolder([])).toEqual([])
  })
})

describe('joinAgentNames', () => {
  it('reads naturally for one, two and three agents', () => {
    expect(joinAgentNames([byId('codex')])).toBe('Codex')
    expect(joinAgentNames([byId('codex'), byId('copilot')])).toBe('Codex and GitHub Copilot')
    expect(joinAgentNames([byId('claude-code'), byId('codex'), byId('cursor')])).toBe('Claude Code, Codex and Cursor')
  })
})

describe('describeInstallState', () => {
  const marker = { version: '2.0.0', installedAt: '2026-10-26T09:00:00.000Z' }

  it('is not installed when the folder is missing', () => {
    expect(describeInstallState({ folderExists: false, marker: null, currentVersion: '2.0.0' })).toEqual({
      kind: 'not-installed',
    })
  })

  it('is not ours when the folder has no Workscribe marker', () => {
    expect(describeInstallState({ folderExists: true, marker: null, currentVersion: '2.0.0' })).toEqual({
      kind: 'not-ours',
    })
  })

  it('is installed when the marker matches the running version', () => {
    expect(describeInstallState({ folderExists: true, marker, currentVersion: '2.0.0' })).toEqual({
      kind: 'installed',
      version: '2.0.0',
    })
  })

  it('is outdated when the marker is from another version', () => {
    expect(describeInstallState({ folderExists: true, marker, currentVersion: '2.1.0' })).toEqual({
      kind: 'outdated',
      version: '2.0.0',
    })
  })
})

describe('describeFolderAgents', () => {
  it('names the agents asked for when they cover the whole folder', () => {
    expect(
      describeFolderAgents({ skillsFolder: '.agents/skills', agents: [byId('codex'), byId('copilot')] }, SKILL_AGENTS)
    ).toBe('Codex and GitHub Copilot')
  })

  it('says when another agent reads the same folder', () => {
    expect(describeFolderAgents({ skillsFolder: '.agents/skills', agents: [byId('codex')] }, SKILL_AGENTS)).toBe(
      'Codex (folder shared with GitHub Copilot)'
    )
  })
})

describe('outcomeWithoutPrompt', () => {
  it('reports up-to-date and not-ours copies without asking, and asks otherwise', () => {
    expect(outcomeWithoutPrompt({ kind: 'installed', version: '2.0.0' })).toBe('up-to-date')
    expect(outcomeWithoutPrompt({ kind: 'not-ours' })).toBe('skipped-not-ours')
    expect(outcomeWithoutPrompt({ kind: 'outdated', version: '1.9.0' })).toBeNull()
    expect(outcomeWithoutPrompt({ kind: 'not-installed' })).toBeNull()
  })
})
