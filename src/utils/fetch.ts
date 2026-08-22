const DEFAULT_TIMEOUT_MS = 30_000

const NETWORK_ERROR_CODES = new Set([
  'ENOTFOUND',
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
])

function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const cause = (err as Error & { cause?: unknown }).cause
  const code =
    (err as NodeJS.ErrnoException).code ?? (cause instanceof Error ? (cause as NodeJS.ErrnoException).code : undefined)
  return NETWORK_ERROR_CODES.has(code ?? '')
}

export async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = DEFAULT_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      throw new Error(`Request timed out after ${timeoutMs / 1000}s`)
    }
    if (isNetworkError(err)) {
      throw new Error("No internet connection — try again when you're online")
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}
