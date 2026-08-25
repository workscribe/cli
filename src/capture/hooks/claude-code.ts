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
    const hooks = (settings.hooks ?? {}) as Record<string, unknown>
    const postToolUse = (hooks.PostToolUse ?? []) as unknown[]
    const hasPostToolUse = postToolUse.some((entry) => {
      const entryHooks = ((entry as Record<string, unknown>).hooks ?? []) as unknown[]
      return entryHooks.some((hookItem) => {
        const hook = hookItem as Record<string, unknown>
        return typeof hook.command === 'string' && hook.command.includes('workscribe _hook')
      })
    })
    const userPromptSubmit = (hooks.UserPromptSubmit ?? []) as unknown[]
    const hasUserPromptSubmit = userPromptSubmit.some((entry) => {
      const entryHooks = ((entry as Record<string, unknown>).hooks ?? []) as unknown[]
      return entryHooks.some((hookItem) => {
        const hook = hookItem as Record<string, unknown>
        return typeof hook.command === 'string' && hook.command.includes('workscribe _hook')
      })
    })
    return hasPostToolUse && hasUserPromptSubmit
  },

  install() {
    const settings = readSettings()
    const existingHooks = (settings.hooks ?? {}) as Record<string, unknown>
    const existingPostToolUse = (existingHooks.PostToolUse ?? []) as unknown[]
    const existingUserPromptSubmit = (existingHooks.UserPromptSubmit ?? []) as unknown[]
    settings.hooks = {
      ...existingHooks,
      PostToolUse: [
        ...existingPostToolUse,
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'workscribe _hook --source claude-code', async: true }],
        },
      ],
      UserPromptSubmit: [
        ...existingUserPromptSubmit,
        {
          hooks: [
            {
              type: 'command',
              command: 'workscribe _hook --source claude-code --event UserPromptSubmit',
            },
          ],
        },
      ],
    }
    fs.mkdirSync(path.dirname(CLAUDE_SETTINGS_PATH), { recursive: true })
    fs.writeFileSync(CLAUDE_SETTINGS_PATH, JSON.stringify(settings, null, 2))
  },
}
