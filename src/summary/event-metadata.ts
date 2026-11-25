// Reads an event row's stored metadata. A leaf module (no imports) so both the payload builder and the commit
// helpers can use it without importing each other.

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * The metadata without `intent` — what the agent said a command is for, which goes only where its recaps do. The same
 * object when it holds none; the argument is never changed.
 */
export function withoutIntent(metadata: Record<string, unknown>): Record<string, unknown> {
  if (!('intent' in metadata)) return metadata
  const { intent: _intent, ...rest } = metadata
  return rest
}

/** Metadata is best-effort context for the summary — a corrupt or non-object row must not fail it. */
export function parseMetadata(raw: string | null): Record<string, unknown> {
  if (!raw) return {}
  try {
    const parsed: unknown = JSON.parse(raw)
    return isPlainObject(parsed) ? parsed : {}
  } catch {
    return {}
  }
}
