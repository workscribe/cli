import fs from 'fs'
import path from 'path'
import os from 'os'
import type { AIHookIntegration } from './types'
import { isCommandInstalled } from './utils'

const CLAUDE_SETTINGS_PATH = path.join(os.homedir(), '.claude', 'settings.json')

function readSettings(): Record<string, unknown> {
  if (!fs.existsSync(CLAUDE_SETTINGS_PATH)) return {}
  try {
    return JSON.parse(fs.readFileSync(CLAUDE_SETTINGS_PATH, 'utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

export const claudeCodeIntegration: AIHookIntegration = {
  displayName: 'Claude Code',

  isInstalled() {
    return isCommandInstalled('claude')
  },

  isHookInstalled() {
    const settings = readSettings()
    const postToolUse = ((settings.hooks as Record<string, unknown>)?.PostToolUse ?? []) as unknown[]
    return postToolUse.some((entry) => {
      const hooks = ((entry as Record<string, unknown>).hooks ?? []) as unknown[]
      return hooks.some((h) => {
        const hook = h as Record<string, unknown>
        return typeof hook.command === 'string' && hook.command.includes('workscribe _hook')
      })
    })
  },

  install() {
    const settings = readSettings()
    const existingHooks = (settings.hooks ?? {}) as Record<string, unknown>
    const existingPostToolUse = (existingHooks.PostToolUse ?? []) as unknown[]
    settings.hooks = {
      ...existingHooks,
      PostToolUse: [
        ...existingPostToolUse,
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'workscribe _hook --source claude-code', async: true }],
        },
      ],
    }
    fs.mkdirSync(path.dirname(CLAUDE_SETTINGS_PATH), { recursive: true })
    fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2))
  },
}
