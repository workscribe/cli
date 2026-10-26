// Install, remove and report the skill one skills folder at a time, with friendly messages. Shared by
// `workscribe skill`, `init`, `status` and `uninstall`; a failure in one folder is reported, never thrown,
// so the rest of those commands carries on.
import os from 'os'
import path from 'path'
import chalk from 'chalk'
import { log } from '../utils/logger'
import { SKILL_AGENTS, SKILL_NAME } from './agents'
import { installSkill, readInstallState, uninstallSkill } from './installer'
import {
  describeInstallFailure,
  describeInstallOutcome,
  describeSkillStatus,
  describeUninstallFailure,
  describeUninstallOutcome,
  displayPath,
  type Message,
  type MessageLevel,
} from './report'
import { describeFolderAgents, groupBySkillsFolder } from './state'
import type { SkillAgent, SkillsFolderGroup } from './types'

declare const __WORKSCRIBE_VERSION__: string

/** Width of the agent-name column in `skill status` and `workscribe status`. */
export const AGENT_NAME_COLUMN_WIDTH = 16

const STATUS_COLOURS: Record<MessageLevel, (text: string) => string> = {
  success: chalk.green,
  warn: chalk.yellow,
  info: chalk.dim,
}

/** Where a group's skill lives, and how messages should name the agents it serves. */
export interface FolderTarget {
  skillsFolder: string
  location: string
  agents: string
}

export function describeTarget(group: SkillsFolderGroup, homeDir: string = os.homedir()): FolderTarget {
  const skillsFolder = path.join(homeDir, group.skillsFolder)
  return {
    skillsFolder,
    location: displayPath(path.join(skillsFolder, SKILL_NAME), homeDir),
    agents: describeFolderAgents(group, SKILL_AGENTS),
  }
}

export function printMessage(message: Message): void {
  log[message.level](message.text)
}

export function installIntoFolder(options: { target: FolderTarget; sourceDir: string; force?: boolean }): Message {
  const { target } = options
  try {
    const outcome = installSkill({
      sourceDir: options.sourceDir,
      skillsFolder: target.skillsFolder,
      version: __WORKSCRIBE_VERSION__,
      force: options.force,
    })
    return describeInstallOutcome({ ...target, outcome, version: __WORKSCRIBE_VERSION__ })
  } catch (error) {
    return describeInstallFailure({ ...target, error })
  }
}

/**
 * Removes Workscribe-installed copies from each agent's skills folder. `workscribe uninstall` passes
 * `reportMissing: false` so folders that never had the skill don't add noise.
 */
export function removeSkills(agents: SkillAgent[], options: { reportMissing: boolean }): void {
  for (const group of groupBySkillsFolder(agents)) {
    const target = describeTarget(group)
    try {
      const outcome = uninstallSkill(target.skillsFolder)
      if (outcome === 'not-installed' && !options.reportMissing) continue
      printMessage(describeUninstallOutcome({ ...target, outcome }))
    } catch (error) {
      printMessage(describeUninstallFailure({ ...target, error }))
    }
  }
}

/** "Claude Code      installed (2.0.0)  ~/.claude/skills/workscribe" */
export function formatAgentSkillLine(agent: SkillAgent, homeDir: string = os.homedir()): string {
  const location = displayPath(path.join(homeDir, agent.skillsFolder, SKILL_NAME), homeDir)
  const installState = readInstallState(path.join(homeDir, agent.skillsFolder), __WORKSCRIBE_VERSION__)
  const status = describeSkillStatus(installState, __WORKSCRIBE_VERSION__)
  return `${agent.name.padEnd(AGENT_NAME_COLUMN_WIDTH)} ${STATUS_COLOURS[status.level](status.text)}  ${chalk.dim(location)}`
}

export function formatUndetectedAgentLine(agent: SkillAgent): string {
  return `${agent.name.padEnd(AGENT_NAME_COLUMN_WIDTH)} ${chalk.dim('not detected')}`
}
