import fs from 'fs'
import os from 'os'
import path from 'path'
import BUILTIN_TOOLS from './ai-tools.json'
import { debugLog } from '../utils/logger'

export interface AIToolEntry {
  tool: string
  displayName: string
  pattern: string
  hook: string | null
  contextSource: 'hook' | 'history-file' | 'sqlite' | null
  historyFormat: 'jsonl' | 'json' | 'markdown' | 'sqlite' | null
  securityWarning: string | null
}

const USER_REGISTRY_PATH = path.join(os.homedir(), '.workscribe', 'ai-tools.json')

export function loadAIToolRegistry(): AIToolEntry[] {
  let userEntries: AIToolEntry[] = []

  try {
    if (fs.existsSync(USER_REGISTRY_PATH)) {
      const raw = fs.readFileSync(USER_REGISTRY_PATH, 'utf-8')
      const parsed = JSON.parse(raw)
      if (Array.isArray(parsed)) {
        userEntries = parsed
          .filter((entry) => typeof entry.tool === 'string' && typeof entry.pattern === 'string')
          .map((entry) => ({
            tool: entry.tool as string,
            displayName: (entry.displayName as string | undefined) ?? (entry.tool as string),
            pattern: entry.pattern as string,
            hook: (entry.hook as string | null | undefined) ?? null,
            contextSource: (entry.contextSource as AIToolEntry['contextSource'] | undefined) ?? null,
            historyFormat: (entry.historyFormat as AIToolEntry['historyFormat'] | undefined) ?? null,
            securityWarning: (entry.securityWarning as string | null | undefined) ?? null,
          }))
      }
    }
  } catch {
    debugLog('registry', 'Failed to load user AI tool registry — using built-ins only')
  }

  if (userEntries.length === 0) return BUILTIN_TOOLS as AIToolEntry[]

  const userToolSlugs = new Set(userEntries.map((entry) => entry.tool))
  const filteredBuiltins = (BUILTIN_TOOLS as AIToolEntry[]).filter((entry) => !userToolSlugs.has(entry.tool))
  return [...filteredBuiltins, ...userEntries]
}
