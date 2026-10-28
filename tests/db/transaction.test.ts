import { describe, it, expect, onTestFinished } from 'vitest'
import { DatabaseSync } from 'node:sqlite'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { BUSY_TIMEOUT_MS, isDatabaseLocked, withImmediateTransaction } from '../../src/db/transaction'

/** Two connections to one database file, as two Workscribe processes would have. */
function twoConnections(): { first: DatabaseSync; second: DatabaseSync } {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-transaction-'))
  const file = path.join(directory, 'workscribe.db')
  const first = new DatabaseSync(file)
  const second = new DatabaseSync(file)
  onTestFinished(() => {
    first.close()
    second.close()
    fs.rmSync(directory, { recursive: true, force: true })
  })
  first.exec('PRAGMA journal_mode = WAL; CREATE TABLE notes (text TEXT)')
  return { first, second }
}

function busyTimeout(db: DatabaseSync): number {
  return (db.prepare('PRAGMA busy_timeout').get() as { timeout: number }).timeout
}

describe('withImmediateTransaction', () => {
  it('holds the write lock while it works, so another process gives up with a locked error', () => {
    const { first, second } = twoConnections()
    let otherProcessError: unknown = null

    withImmediateTransaction(first, () => {
      try {
        withImmediateTransaction(second, () => undefined, { busyTimeoutMs: 50 })
      } catch (error) {
        otherProcessError = error
      }
    })

    expect(isDatabaseLocked(otherProcessError)).toBe(true)
  })

  it('commits what the work wrote and returns its result', () => {
    const { first, second } = twoConnections()

    const result = withImmediateTransaction(first, () => {
      first.prepare('INSERT INTO notes VALUES (?)').run('kept')
      return 'done'
    })

    expect(result).toBe('done')
    expect(second.prepare('SELECT text FROM notes').all()).toEqual([{ text: 'kept' }])
  })

  it('rolls back and rethrows when the work fails', () => {
    const { first } = twoConnections()

    expect(() =>
      withImmediateTransaction(first, () => {
        first.prepare('INSERT INTO notes VALUES (?)').run('discarded')
        throw new Error('rebuild failed')
      })
    ).toThrow('rebuild failed')
    expect(first.prepare('SELECT COUNT(*) AS count FROM notes').get()).toEqual({ count: 0 })
  })

  it('restores the normal busy timeout after a shorter wait, even when the lock was busy', () => {
    const { first, second } = twoConnections()
    second.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`)

    withImmediateTransaction(first, () => {
      expect(() => withImmediateTransaction(second, () => undefined, { busyTimeoutMs: 20 })).toThrow()
    })

    expect(busyTimeout(second)).toBe(BUSY_TIMEOUT_MS)
  })
})

describe('isDatabaseLocked', () => {
  it('is false for other errors', () => {
    expect(isDatabaseLocked(new Error('no such table'))).toBe(false)
    expect(isDatabaseLocked(null)).toBe(false)
  })
})
