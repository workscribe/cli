import type { EventPayload } from '../../types'

export function pluralize(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/** The non-empty strings in a metadata value — event metadata is untyped JSON. */
export function stringsIn(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item !== '') : []
}

export function unique(values: string[]): string[] {
  return [...new Set(values)]
}

export function eventsOf(events: EventPayload[], category: string): EventPayload[] {
  return events.filter((event) => event.category === category)
}

export function toBulletList(bullets: string[]): string {
  return bullets.map((bullet) => `- ${bullet}`).join('\n')
}
