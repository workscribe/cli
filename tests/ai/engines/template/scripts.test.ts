import { describe, it, expect } from 'vitest'
import { describeScripts } from '../../../../src/ai/engines/template/scripts'
import { commit, event } from './fixtures'
import type { EventPayload } from '../../../../src/ai/types'
import type { StoryCommit } from '../../../../src/summary/story-commits'

const LINE = 'may have changed files (contents not captured)'

function ran(count: number, capturedAt = '2026-10-20T10:00:00.000Z', category = 'running'): EventPayload {
  return { ...event(category), capturedAt, scripts: count }
}

function committedAt(subject: string, time: string | null): StoryCommit {
  return { ...commit(subject), committedAt: time }
}

describe('describeScripts', () => {
  it('says nothing when no event ran a script', () => {
    expect(describeScripts([event('testing'), event('exploring')], [])).toBeNull()
    expect(describeScripts([], [])).toBeNull()
  })

  it('counts the scripts of every event, in the singular for one', () => {
    expect(describeScripts([ran(1)], [])).toBe(`Ran 1 script that ${LINE}`)
    expect(describeScripts([ran(1), ran(2, '2026-10-20T10:05:00.000Z')], [])).toBe(`Ran 3 scripts that ${LINE}`)
  })

  it('counts a script whatever category it was filed under', () => {
    const events = [ran(1, '2026-10-20T10:00:00.000Z', 'linting'), ran(1, '2026-10-20T10:01:00.000Z', 'exploring')]

    expect(describeScripts(events, [])).toBe(`Ran 2 scripts that ${LINE}`)
  })

  it('leaves out the scripts a commit came after: its size tells what they changed', () => {
    const events = [ran(2, '2026-10-20T09:00:00.000Z'), ran(1, '2026-10-20T11:00:00.000Z')]
    const commits = [committedAt('fix: x', '2026-10-20T10:00:00.000Z')]

    expect(describeScripts(events, commits)).toBe(`Ran 1 script that ${LINE}`)
  })

  it('says nothing when every script came before the last commit', () => {
    const commits = [committedAt('early', '2026-10-20T08:00:00.000Z'), committedAt('late', '2026-10-20T10:30:00.000Z')]

    expect(describeScripts([ran(3, '2026-10-20T10:00:00.000Z')], commits)).toBeNull()
  })

  it('counts a script at the very time of the commit as covered by it', () => {
    const commits = [committedAt('fix: x', '2026-10-20T10:00:00.000Z')]

    expect(describeScripts([ran(1, '2026-10-20T10:00:00.000Z')], commits)).toBeNull()
  })

  it('counts every script when no commit has a time to compare with', () => {
    expect(describeScripts([ran(2)], [committedAt('fix: x', null)])).toBe(`Ran 2 scripts that ${LINE}`)
  })

  it('compares times across time zones', () => {
    const commits = [committedAt('fix: x', '2026-10-20T10:45:00+01:00')]

    expect(describeScripts([ran(1, '2026-10-20T09:50:00.000Z')], commits)).toBe(`Ran 1 script that ${LINE}`)
    expect(describeScripts([ran(1, '2026-10-20T09:40:00.000Z')], commits)).toBeNull()
  })
})
