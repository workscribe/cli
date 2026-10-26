import type { InstallOutcome, SkillAgent, SkillInstallState, SkillMarker, SkillsFolderGroup } from './types'

/** One entry per distinct skills folder, in registry order — Codex and Copilot share `.agents/skills`. */
export function groupBySkillsFolder(agents: SkillAgent[]): SkillsFolderGroup[] {
  const groups = new Map<string, SkillAgent[]>()
  for (const agent of agents) groups.set(agent.skillsFolder, [...(groups.get(agent.skillsFolder) ?? []), agent])
  return [...groups.entries()].map(([skillsFolder, groupAgents]) => ({ skillsFolder, agents: groupAgents }))
}

/**
 * Names the agents a folder serves, noting any other agent that reads the same folder — installing or
 * removing for Codex also changes it for GitHub Copilot, and the message should say so.
 */
export function describeFolderAgents(group: SkillsFolderGroup, allAgents: SkillAgent[]): string {
  const sharers = allAgents.filter(
    (agent) => agent.skillsFolder === group.skillsFolder && !group.agents.includes(agent)
  )
  const names = joinAgentNames(group.agents)
  return sharers.length === 0 ? names : `${names} (folder shared with ${joinAgentNames(sharers)})`
}

/** The result `init` can report without asking: up to date, or a folder it doesn't own. Null means ask. */
export function outcomeWithoutPrompt(state: SkillInstallState): InstallOutcome | null {
  if (state.kind === 'installed') return 'up-to-date'
  if (state.kind === 'not-ours') return 'skipped-not-ours'
  return null
}

/** "Codex", "Codex and GitHub Copilot", "Claude Code, Codex and Cursor". */
export function joinAgentNames(agents: SkillAgent[]): string {
  const names = agents.map((agent) => agent.name)
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** What's in an agent's `workscribe` skill folder, judged by its marker. */
export function describeInstallState(input: {
  folderExists: boolean
  marker: SkillMarker | null
  currentVersion: string
}): SkillInstallState {
  if (!input.folderExists) return { kind: 'not-installed' }
  if (!input.marker) return { kind: 'not-ours' }
  if (input.marker.version === input.currentVersion) return { kind: 'installed', version: input.marker.version }
  return { kind: 'outdated', version: input.marker.version }
}
