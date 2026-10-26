import fs from 'fs'
import os from 'os'
import path from 'path'
import { isCommandInstalled } from '../capture/hooks/utils'
import { memoize } from '../utils/memoize'
import { SKILL_AGENTS } from './agents'
import type { SkillAgent } from './types'

/** The I/O detection needs — injected so tests can describe a machine without touching the real one. */
export interface DetectionEnvironment {
  homeDir: string
  isCommandInstalled: (command: string) => boolean
  pathExists: (absolutePath: string) => boolean
  listDirectory: (absolutePath: string) => string[]
}

export function defaultDetectionEnvironment(): DetectionEnvironment {
  return {
    homeDir: os.homedir(),
    // `which` spawns a process, so each command is looked up at most once per run
    isCommandInstalled: memoize(isCommandInstalled),
    pathExists: (absolutePath) => fs.existsSync(absolutePath),
    listDirectory: (absolutePath) => {
      try {
        return fs.readdirSync(absolutePath)
      } catch {
        return [] // a missing extensions folder just means no extensions
      }
    },
  }
}

function hasHomeFolder(agent: SkillAgent, environment: DetectionEnvironment): boolean {
  return agent.homeFolders.some((folder) => environment.pathExists(path.join(environment.homeDir, folder)))
}

function hasVscodeExtension(agent: SkillAgent, environment: DetectionEnvironment): boolean {
  if (agent.vscodeExtensionPrefixes.length === 0) return false
  const extensions = environment.listDirectory(path.join(environment.homeDir, '.vscode', 'extensions'))
  return extensions.some((extension) => agent.vscodeExtensionPrefixes.some((prefix) => extension.startsWith(prefix)))
}

/** Folder signals are checked first; `which` is only spawned when none of them found the agent. */
export function isAgentPresent(agent: SkillAgent, environment: DetectionEnvironment): boolean {
  return (
    hasHomeFolder(agent, environment) ||
    hasVscodeExtension(agent, environment) ||
    agent.commands.some((command) => environment.isCommandInstalled(command))
  )
}

export function detectAgents(environment: DetectionEnvironment = defaultDetectionEnvironment()): SkillAgent[] {
  return SKILL_AGENTS.filter((agent) => isAgentPresent(agent, environment))
}
