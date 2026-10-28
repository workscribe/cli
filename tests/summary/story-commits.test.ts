import { describe, it, expect } from 'vitest'
import { assignCommitsToSessions, branchAt, storyCommitsOf } from '../../src/summary/story-commits'
import { capturedRow, row } from './contract/fixtures'

const at = (time: string, branch: string | null) => row({ captured_at: `2026-10-25T${time}:00.000Z`, branch })
const gitCommit = (subject: string, time: string, hash = 'a1b2c3d') => ({
  hash,
  subject,
  committedAt: `2026-10-25T${time}:00.000Z`,
})

describe('branchAt', () => {
  const timeline = [at('09:00', 'main'), at('09:30', 'feat/auth'), at('10:00', null), at('10:15', 'main')]

  it('is the branch of the latest event at or before the time', () => {
    expect(branchAt(timeline, '2026-10-25T09:45:00.000Z')).toBe('feat/auth')
    expect(branchAt(timeline, '2026-10-25T09:30:00.000Z')).toBe('feat/auth')
    expect(branchAt(timeline, '2026-10-25T11:00:00.000Z')).toBe('main')
  })

  it('skips events with no branch', () => {
    expect(branchAt(timeline, '2026-10-25T10:05:00.000Z')).toBe('feat/auth')
  })

  it('compares times across time zones', () => {
    expect(branchAt(timeline, '2026-10-25T10:45:00+01:00')).toBe('feat/auth')
  })

  it("is the first event's branch for a time before every event", () => {
    expect(branchAt(timeline, '2026-10-25T08:58:00.000Z')).toBe('main')
  })

  it('is null when no event has a branch', () => {
    expect(branchAt([at('09:00', null)], '2026-10-25T09:00:00.000Z')).toBeNull()
  })
})

describe('storyCommitsOf', () => {
  it('puts a captured commit under the branch it was captured on', () => {
    const events = [capturedRow('git commit -m "fix: token"', { branch: 'feat/auth' })]

    expect(storyCommitsOf(events, [])).toEqual([
      { hash: null, subject: 'fix: token', committedAt: '2026-10-25T09:00:00.000Z', branch: 'feat/auth' },
    ])
  })

  it('places a git commit by its time on the timeline', () => {
    const events = [at('09:00', 'main'), at('09:30', 'feat/auth')]

    const commits = [gitCommit('chore: tidy', '09:10', 'a1b2c3d'), gitCommit('feat: login', '09:40', 'e4f5a6b')]

    expect(storyCommitsOf(events, commits)).toEqual([
      { hash: 'a1b2c3d', subject: 'chore: tidy', committedAt: '2026-10-25T09:10:00.000Z', branch: 'main' },
      { hash: 'e4f5a6b', subject: 'feat: login', committedAt: '2026-10-25T09:40:00.000Z', branch: 'feat/auth' },
    ])
  })

  it('places a git commit an AI session confirms by its time, not the branch the session ended on', () => {
    const events = [
      at('09:00', 'main'),
      at('09:30', 'feat/x'),
      row({
        category: 'ai_session',
        metadata: '{"commits":["feat: x"]}',
        branch: 'main',
        captured_at: '2026-10-25T10:00:00.000Z',
      }),
    ]

    expect(storyCommitsOf(events, [gitCommit('feat: x', '09:40')])[0].branch).toBe('feat/x')
  })

  it('places a commit made in the same command as a branch switch under the new branch', () => {
    // One command, `git switch -c feat/x && git commit -m "feat: x"`: captured when it finished, after the commit
    const events = [
      at('09:00', 'main'),
      capturedRow('git switch -c feat/x && git commit -m "feat: x"', {
        branch: 'feat/x',
        captured_at: '2026-10-25T09:40:01.400Z',
      }),
    ]

    expect(storyCommitsOf(events, [gitCommit('feat: x', '09:40')])[0].branch).toBe('feat/x')
  })

  it("doesn't take the branch of a capture of the same subject made long after the commit", () => {
    const events = [
      at('09:00', 'main'),
      capturedRow('git commit -m "wip"', { branch: 'feat/later', captured_at: '2026-10-25T11:00:00.000Z' }),
    ]

    expect(storyCommitsOf(events, [gitCommit('wip', '09:40')])[0].branch).toBe('main')
  })

  it('places each of two git commits with the same subject by its own time', () => {
    const events = [
      capturedRow('git commit -m "wip"', { branch: 'main', captured_at: '2026-10-25T09:10:02.000Z' }),
      at('09:30', 'feat/auth'),
      capturedRow('git commit -m "wip"', { branch: 'feat/auth', captured_at: '2026-10-25T09:40:02.000Z' }),
    ]
    const commits = [gitCommit('wip', '09:10', 'a1b2c3d'), gitCommit('wip', '09:40', 'e4f5a6b')]

    expect(storyCommitsOf(events, commits).map((commit) => commit.branch)).toEqual(['main', 'feat/auth'])
  })

  describe("an AI session's commits", () => {
    const aiSession = row({
      category: 'ai_session',
      metadata: '{"tool":"claude","commits":["feat: login","Merge pull request #70 from dev/feat"]}',
    })

    it("are left out when git was asked and doesn't confirm them: the session lists pulled commits too", () => {
      const subjects = storyCommitsOf([aiSession], [gitCommit('feat: login', '09:40')]).map((commit) => commit.subject)

      expect(subjects).toEqual(['feat: login'])
    })

    it("are kept when git wasn't asked", () => {
      const subjects = storyCommitsOf([aiSession], null).map((commit) => commit.subject)

      expect(subjects).toEqual(['feat: login', 'Merge pull request #70 from dev/feat'])
    })

    it('never drop a git commit -m git does not return (amended or rebased since)', () => {
      const events = [capturedRow('git commit -m "wip: amended away"')]

      expect(storyCommitsOf(events, []).map((commit) => commit.subject)).toEqual(['wip: amended away'])
    })
  })

  it('never tells a failed git commit', () => {
    const events = [capturedRow('git commit -m "rejected by hook"', { exit_code: 1 })]

    expect(storyCommitsOf(events, [])).toEqual([])
  })
})

describe('assignCommitsToSessions', () => {
  const windows = [
    { startedAt: '2026-10-25T09:00:00.000Z', endedAt: '2026-10-25T10:00:00.000Z' },
    { startedAt: '2026-10-25T10:00:30.000Z', endedAt: '2026-10-25T11:00:00.000Z' },
  ]

  it('gives each commit to the first session whose widened window holds it, so none is told twice', () => {
    const [first, second] = assignCommitsToSessions(windows, [
      gitCommit('hook ran long', '08:58'),
      gitCommit('at the boundary', '10:00'),
      gitCommit('afternoon', '10:30'),
    ])

    expect(first.map((commit) => commit.subject)).toEqual(['hook ran long', 'at the boundary'])
    expect(second.map((commit) => commit.subject)).toEqual(['afternoon'])
  })

  it('drops a commit outside every session', () => {
    expect(assignCommitsToSessions(windows, [gitCommit('lunchtime', '12:30')])).toEqual([[], []])
  })
})
