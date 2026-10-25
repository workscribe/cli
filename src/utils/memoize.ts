/** Caches a single-argument lookup by its string key for the lifetime of the returned function. */
export function memoize<Value>(lookup: (key: string) => Value): (key: string) => Value {
  // Boxed so a cached null/undefined result is told apart from a missing entry
  const cache = new Map<string, { value: Value }>()
  return (key) => {
    const cached = cache.get(key)
    if (cached) return cached.value
    const value = lookup(key)
    cache.set(key, { value })
    return value
  }
}
