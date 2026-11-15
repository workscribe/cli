import { describe, it, expect } from 'vitest'
import { buildHistory } from '../../../src/summary/history'
import { buildHistoryJson } from '../../../src/summary/contract/build'
import { HISTORY_SCHEMA_VERSION } from '../../../src/summary/contract/constants'
import { capturedRow } from './fixtures'

const SINCE = '2026-11-09T09:00:00.000Z'

describe('buildHistoryJson', () => {
  const rows = [
    capturedRow('git stash', { id: 1, branch: 'main', cwd: '/Users/dev/secret-project' }),
    capturedRow('git reset --hard HEAD~1 && cat /Users/dev/.ssh/id_rsa', { id: 2, branch: 'main' }),
  ]
  const json = buildHistoryJson('api', SINCE, buildHistory(rows, { all: false }))

  it('has the documented keys, at version 1', () => {
    expect(json.schemaVersion).toBe(HISTORY_SCHEMA_VERSION)
    expect(Object.keys(json).sort()).toEqual(['entries', 'leftStashed', 'repo', 'schemaVersion', 'since'])
    expect(Object.keys(json.entries[0]).sort()).toEqual([
      'branch',
      'capturedAt',
      'exitCode',
      'isGit',
      'moves',
      'recovery',
      'source',
    ])
  })

  it('carries no command, folder or file path', () => {
    const text = JSON.stringify(json)

    expect(text).not.toMatch(/id_rsa|secret-project|\/Users\/dev|git stash &&/)
    expect(text).not.toContain('"command"')
    expect(text).not.toContain('"cwd"')
  })
})
