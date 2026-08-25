import { type AIToolEntry } from '../../config/registry'
import { resolveAiderPaths } from './aider'
import { resolveCodexPaths } from './codex'
import { resolveCopilotPaths } from './copilot'
import { resolveAmazonQPaths } from './amazon-q'
import { resolveGeminiPaths } from './gemini'
import { resolveOpencodePaths } from './opencode'

type Resolver = (cwd: string) => string[]

const RESOLVERS: Record<string, Resolver> = {
  aider: resolveAiderPaths,
  codex: () => resolveCodexPaths(),
  'gh copilot': () => resolveCopilotPaths(),
  'amazon-q': () => resolveAmazonQPaths(),
  gemini: () => resolveGeminiPaths(),
  opencode: () => resolveOpencodePaths(),
}

export function resolveHistoryPaths(entry: AIToolEntry, cwd: string): string[] {
  if (entry.contextSource === null || entry.contextSource === 'hook') return []
  const resolver = RESOLVERS[entry.tool]
  if (!resolver) return []
  return resolver(cwd)
}
