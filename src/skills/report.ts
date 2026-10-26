// Friendly wording for skill install results and status, shared by `workscribe skill`, `init` and `status`.
import type { InstallOutcome, SkillInstallState, UninstallOutcome } from './types'

export type MessageLevel = 'success' | 'info' | 'warn'

export interface Message {
  level: MessageLevel
  text: string
}

/** `/Users/dev/.claude/skills` → `~/.claude/skills`, so paths read the way users type them. */
export function displayPath(absolutePath: string, homeDir: string): string {
  return absolutePath.startsWith(homeDir) ? `~${absolutePath.slice(homeDir.length)}` : absolutePath
}

export function describeInstallOutcome(input: {
  outcome: InstallOutcome
  agents: string
  location: string
  version: string
}): Message {
  switch (input.outcome) {
    case 'installed':
      return { level: 'success', text: `Installed the Workscribe skill for ${input.agents} (${input.location})` }
    case 'updated':
      return { level: 'success', text: `Updated the Workscribe skill for ${input.agents} to ${input.version}` }
    case 'up-to-date':
      return { level: 'info', text: `The Workscribe skill is already up to date for ${input.agents}` }
    case 'skipped-not-ours':
      return {
        level: 'warn',
        text:
          `Skipped ${input.agents} — ${input.location} already holds a workscribe skill that Workscribe didn't install. ` +
          'Run workscribe skill install --force to replace it.',
      }
  }
}

export function describeUninstallOutcome(input: {
  outcome: UninstallOutcome
  agents: string
  location: string
}): Message {
  switch (input.outcome) {
    case 'removed':
      return { level: 'success', text: `Removed the Workscribe skill from ${input.agents} (${input.location})` }
    case 'not-installed':
      return { level: 'info', text: `The Workscribe skill isn't installed for ${input.agents}` }
    case 'skipped-not-ours':
      return {
        level: 'warn',
        text: `Left ${input.location} alone — that workscribe skill wasn't installed by Workscribe.`,
      }
  }
}

/** One status phrase per state, with the command that fixes it when something needs doing. */
export function describeSkillStatus(state: SkillInstallState, currentVersion: string): Message {
  switch (state.kind) {
    case 'installed':
      return { level: 'success', text: `installed (${state.version})` }
    case 'outdated':
      return {
        level: 'warn',
        text: `outdated (${state.version}; this CLI is ${currentVersion}) — run workscribe skill install`,
      }
    case 'not-installed':
      return { level: 'info', text: 'not installed — run workscribe skill install' }
    case 'not-ours':
      return {
        level: 'warn',
        text: 'a different workscribe skill is there — run workscribe skill install --force to replace it',
      }
  }
}

/** The reason from anything thrown — fs errors carry useful text like "EACCES: permission denied". */
export function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function describeInstallFailure(input: { agents: string; location: string; error: unknown }): Message {
  return {
    level: 'warn',
    text:
      `Couldn't install the Workscribe skill for ${input.agents} (${reasonOf(input.error)}). ` +
      `Check you can write to ${input.location}, then run: workscribe skill install`,
  }
}

export function describeUninstallFailure(input: { agents: string; location: string; error: unknown }): Message {
  return {
    level: 'warn',
    text:
      `Couldn't remove the Workscribe skill for ${input.agents} (${reasonOf(input.error)}). ` +
      `Delete it yourself: rm -rf ${input.location}`,
  }
}

export const AFTER_INSTALL_HINT =
  'Restart any agent that is already open, then ask it to "summarize my work today" (or type /workscribe in Claude Code).'
