// What a branch's work was about, from its name: the ticket key and the words of its slug. Pure; reads no config, so
// only the default ticket pattern is known here.
import { DEFAULT_TICKET_KEY } from '../../../capture/tickets'

const MAIN_BRANCHES = new Set(['main', 'master', 'develop'])
const SLUG_SEPARATORS = /[-_/]+/g
const EDGE_SEPARATORS = /^[-_/\s]+|[-_/\s]+$/g

/**
 * "WOR-179: remove old data after 100 days" for `feat/WOR-179-remove-old-data-after-100-days`, or just the key when the
 * name has no slug. Null for a branch with no ticket key — its name alone says what it is — and for the main branches.
 */
export function topicOf(branch: string | null): string | null {
  if (branch === null || MAIN_BRANCHES.has(branch)) return null
  const key = branch.match(DEFAULT_TICKET_KEY)
  if (key === null) return null
  const slug = branch
    .slice((key.index ?? 0) + key[0].length)
    .replace(SLUG_SEPARATORS, ' ')
    .replace(EDGE_SEPARATORS, '')
  return slug === '' ? key[0] : `${key[0]}: ${slug}`
}
