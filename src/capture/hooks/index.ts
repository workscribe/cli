import type { AIHookIntegration } from './types'
import { claudeCodeIntegration } from './claude-code'

/**
 * Registry of AI tool hook integrations, keyed by the "hook" field in src/config/ai-tools.json.
 * Adding support for a new tool = add a new entry here and a corresponding integration file.
 */
export const AI_HOOK_INTEGRATIONS: Record<string, AIHookIntegration> = {
  'claude-code': claudeCodeIntegration,
}
