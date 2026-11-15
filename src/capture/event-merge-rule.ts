// What an event looks for among stored events, so an action two capture paths both saw stays one event (WOR-160).
// The rule's shape and windows are `merge-rules.ts`; the agents that overlap come from their integrations.
import { agentSourcesWith, allAgentSources } from './hooks/overlaps'
import type { HookOverlaps } from './hooks/types'
import type { EventMerge } from './merge-rules'

/**
 * What an event looks for among stored events, so an action two capture paths both saw stays one event (WOR-160).
 * An agent's event (`overlaps` given, even empty) always looks for the imported hook's copy of it; the rest follows
 * the `overlaps` its integration declares. Undefined when no other path records this action.
 */
export function mergeRuleOf(opts: { source?: string; type?: string; overlaps?: HookOverlaps }): EventMerge | undefined {
  const { overlaps } = opts
  const isEdit = opts.type === 'code_edit'
  if (overlaps) return isEdit ? agentEditMerge(overlaps) : agentCommandMerge(overlaps)
  if (isEdit) return editorSaveMerge(opts.source)
  // A person's shell row has no source; a command with one (another tool's) is never an agent's shell row
  if (opts.type || opts.source) return undefined
  return shellCommandMerge()
}

function agentEditMerge(overlaps: HookOverlaps): EventMerge {
  return { kind: 'agent-edit', sharesSaves: overlaps.editorSaves === true, agentSources: allAgentSources() }
}

function agentCommandMerge(overlaps: HookOverlaps): EventMerge {
  return { kind: 'agent-command', sharesShell: overlaps.shellCommands === true, agentSources: allAgentSources() }
}

function editorSaveMerge(source: string | undefined): EventMerge | undefined {
  const agentSources = agentSourcesWith('editorSaves')
  return source && agentSources.length > 0 ? { kind: 'editor-save', agentSources } : undefined
}

function shellCommandMerge(): EventMerge | undefined {
  const agentSources = agentSourcesWith('shellCommands')
  return agentSources.length > 0 ? { kind: 'shell-command', agentSources } : undefined
}
