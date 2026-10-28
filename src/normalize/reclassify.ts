import type { NormalizedEvent } from './patterns'

export interface ReclassifyOptions {
  classify: (command: string) => NormalizedEvent
  /** `capture.aiTools` — when it's off, Workscribe doesn't record AI sessions, so none are created here either. */
  aiToolsEnabled: boolean
}

/**
 * The new category and metadata for a stored `other` event, or null to leave it alone. The metadata
 * replaces the old one entirely, so the `hint`/`tool` kept for unclassified commands doesn't linger.
 */
export function reclassifiedEvent(
  command: string,
  { classify, aiToolsEnabled }: ReclassifyOptions
): NormalizedEvent | null {
  const { category, metadata } = classify(command)
  if (category === 'other') return null
  if (category === 'ai_session' && !aiToolsEnabled) return null
  // A `-F <file>` path is only for capture to read at the time; a stored event never keeps it
  const { messageFile: _messageFile, ...storedMetadata } = metadata
  return { category, metadata: storedMetadata }
}
