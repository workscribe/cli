import { Command } from 'commander'
import chalk from 'chalk'
import { log } from '../utils/logger'
import { SKILL_AGENTS, SKILL_AGENT_IDS } from '../skills/agents'
import { detectAgents } from '../skills/detect'
import { resolvePackagedSkillDir } from '../skills/package-path'
import { groupBySkillsFolder, joinAgentNames } from '../skills/state'
import { AFTER_INSTALL_HINT, reasonOf } from '../skills/report'
import {
  describeTarget,
  formatAgentSkillLine,
  formatUndetectedAgentLine,
  installIntoFolder,
  printMessage,
  removeSkills,
} from '../skills/actions'
import type { SkillAgent } from '../skills/types'

interface AgentOptions {
  agent?: string[]
  force?: boolean
}

function fail(message: string): never {
  log.error(message)
  process.exit(1)
}

/** The agents named with --agent (all must be known), or the given default. */
function chooseAgents(options: {
  requested: string[] | undefined
  fallback: () => SkillAgent[]
  subcommand: 'install' | 'uninstall'
}): SkillAgent[] {
  const { requested } = options
  if (!requested || requested.length === 0) return options.fallback()
  const unknown = requested.filter((id) => !SKILL_AGENT_IDS.includes(id))
  if (unknown.length > 0) {
    fail(
      `Unknown agent: ${unknown.join(', ')}. Choose from: ${SKILL_AGENT_IDS.join(', ')}. ` +
        `For example: workscribe skill ${options.subcommand} --agent claude-code`
    )
  }
  return SKILL_AGENTS.filter((agent) => requested.includes(agent.id))
}

function packagedSkillDir(): string {
  try {
    return resolvePackagedSkillDir()
  } catch (error) {
    fail(reasonOf(error))
  }
}

function installCommand(options: AgentOptions): void {
  const agents = chooseAgents({ requested: options.agent, fallback: detectAgents, subcommand: 'install' })
  if (agents.length === 0) {
    log.info(
      `No coding agents found. Workscribe can install its skill for ${joinAgentNames(SKILL_AGENTS)}. ` +
        "If yours is installed somewhere Workscribe didn't look, name it: workscribe skill install --agent claude-code"
    )
    return
  }
  const sourceDir = packagedSkillDir()
  for (const group of groupBySkillsFolder(agents)) {
    printMessage(installIntoFolder({ target: describeTarget(group), sourceDir, force: options.force }))
  }
  log.plain(chalk.dim(`  ${AFTER_INSTALL_HINT}`))
}

function statusCommand(): void {
  const detected = new Set(detectAgents().map((agent) => agent.id))
  log.plain('')
  log.plain(chalk.bold('  Workscribe agent skill'))
  for (const agent of SKILL_AGENTS) {
    const line = detected.has(agent.id) ? formatAgentSkillLine(agent) : formatUndetectedAgentLine(agent)
    log.plain(`  ${line}`)
  }
  log.plain('')
}

function uninstallCommand(options: AgentOptions): void {
  const agents = chooseAgents({ requested: options.agent, fallback: () => SKILL_AGENTS, subcommand: 'uninstall' })
  removeSkills(agents, { reportMissing: true })
}

export function registerSkill(program: Command): void {
  const skill = program.command('skill').description('Install the Workscribe agent skill into your coding agents')
  const agentOption = `limit to these agents (${SKILL_AGENT_IDS.join(', ')})`

  skill
    .command('install')
    .description('Install or update the skill for every detected coding agent')
    .option('--agent <ids...>', agentOption)
    .option('--force', "replace a workscribe skill that Workscribe didn't install")
    .action(installCommand)

  skill
    .command('status')
    .description('Show which agents have the skill and whether it is up to date')
    .action(statusCommand)

  skill
    .command('uninstall')
    .description('Remove the skill Workscribe installed (never one you added yourself)')
    .option('--agent <ids...>', agentOption)
    .action(uninstallCommand)
}
