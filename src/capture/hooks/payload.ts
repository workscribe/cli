// Reading an agent's hook payload: every integration's parser starts from these. Pure.

export type Payload = Record<string, unknown>

export function asRecord(value: unknown): Payload | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Payload) : null
}

/** A hook's stdin as an object, or null when it's empty or not an object. Invalid JSON throws, as `_hook` expects. */
export function parsePayloadRecord(raw: string): Payload | null {
  return raw.trim() ? asRecord(JSON.parse(raw)) : null
}

export function stringOf(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null
}
