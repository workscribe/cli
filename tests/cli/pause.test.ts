import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// Use a temp dir so tests never touch ~/.workscribe
const TEST_DIR = path.join(os.tmpdir(), `workscribe-pause-test-${process.pid}`)
const PAUSE_FLAG = path.join(TEST_DIR, 'paused')

// Override paths before importing anything that uses them
process.env.HOME = TEST_DIR

beforeEach(() => {
  if (!fs.existsSync(TEST_DIR)) fs.mkdirSync(TEST_DIR, { recursive: true })
  if (fs.existsSync(PAUSE_FLAG)) fs.rmSync(PAUSE_FLAG)
})

afterEach(() => {
  if (fs.existsSync(TEST_DIR)) fs.rmSync(TEST_DIR, { recursive: true })
})

// ─── Pure flag file logic (no DB, no Commander) ───────────────────────────────

function isPaused(flagPath: string): boolean {
  return fs.existsSync(flagPath)
}

function pause(flagPath: string): 'paused' | 'already_paused' {
  if (fs.existsSync(flagPath)) return 'already_paused'
  fs.writeFileSync(flagPath, '', { mode: 0o600 })
  return 'paused'
}

function resume(flagPath: string): 'resumed' | 'not_paused' {
  if (!fs.existsSync(flagPath)) return 'not_paused'
  fs.rmSync(flagPath)
  return 'resumed'
}

describe('pause flag', () => {
  it('is not present initially', () => {
    expect(isPaused(PAUSE_FLAG)).toBe(false)
  })

  it('pause creates the flag file', () => {
    pause(PAUSE_FLAG)
    expect(fs.existsSync(PAUSE_FLAG)).toBe(true)
  })

  it('pause returns paused', () => {
    expect(pause(PAUSE_FLAG)).toBe('paused')
  })

  it('pause when already paused is idempotent', () => {
    pause(PAUSE_FLAG)
    expect(pause(PAUSE_FLAG)).toBe('already_paused')
    // File still exists, no error thrown
    expect(fs.existsSync(PAUSE_FLAG)).toBe(true)
  })

  it('resume removes the flag file', () => {
    pause(PAUSE_FLAG)
    resume(PAUSE_FLAG)
    expect(fs.existsSync(PAUSE_FLAG)).toBe(false)
  })

  it('resume returns resumed', () => {
    pause(PAUSE_FLAG)
    expect(resume(PAUSE_FLAG)).toBe('resumed')
  })

  it('resume when not paused is idempotent', () => {
    expect(resume(PAUSE_FLAG)).toBe('not_paused')
    // No error thrown, no file created
    expect(fs.existsSync(PAUSE_FLAG)).toBe(false)
  })

  it('flag file is created with owner-only permissions', () => {
    pause(PAUSE_FLAG)
    const stat = fs.statSync(PAUSE_FLAG)
    // 0o100600 = regular file + owner rw only
    expect(stat.mode & 0o777).toBe(0o600)
  })

  it('pause → resume → pause cycle works correctly', () => {
    expect(pause(PAUSE_FLAG)).toBe('paused')
    expect(resume(PAUSE_FLAG)).toBe('resumed')
    expect(pause(PAUSE_FLAG)).toBe('paused')
    expect(isPaused(PAUSE_FLAG)).toBe(true)
  })
})
