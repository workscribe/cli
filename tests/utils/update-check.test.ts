import { describe, it, expect, vi, beforeEach, onTestFinished } from 'vitest'

vi.mock('fs', () => ({
  default: { readFileSync: vi.fn(), writeFileSync: vi.fn() },
}))
vi.mock('../../src/utils/paths', () => ({ UPDATE_CHECK_PATH: '/home/user/.workscribe/update-check.json' }))

import fs from 'fs'
import { checkForUpdate } from '../../src/utils/update-check'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockFetch = vi.fn()

const ONE_HOUR_MS = 60 * 60 * 1000
const TWO_DAYS_MS = 48 * ONE_HOUR_MS
const NEWER_VERSION = '9.0.0'
const REGISTRY_URL = 'https://registry.npmjs.org/@workscribe/cli/latest'

function cacheOnDisk(cache: Record<string, unknown>): void {
  mockFs.readFileSync.mockReturnValue(JSON.stringify(cache))
}

function registryAnswers(version: string): void {
  mockFetch.mockResolvedValue({ json: () => Promise.resolve({ version }) })
}

function savedCache(): Record<string, unknown> {
  return JSON.parse(mockFs.writeFileSync.mock.calls[0][1] as string)
}

/** Lets the fire-and-forget registry request settle, for the cases where nothing is expected to be written. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

beforeEach(() => {
  mockFs.readFileSync.mockReset()
  mockFs.writeFileSync.mockReset()
  mockFetch.mockReset()
  mockFs.readFileSync.mockImplementation(() => {
    throw new Error('ENOENT')
  })
  vi.stubGlobal('fetch', mockFetch)
  registryAnswers(NEWER_VERSION)
})

describe('checkForUpdate', () => {
  it('tells the user about a newer version already in the cache', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    onTestFinished(() => stderr.mockRestore())
    cacheOnDisk({ lastChecked: Date.now() - ONE_HOUR_MS, latestVersion: NEWER_VERSION })

    checkForUpdate()

    expect(stderr).toHaveBeenCalledWith(expect.stringContaining(`→ ${NEWER_VERSION}`))
  })

  it('says nothing when the cached version is not newer', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    onTestFinished(() => stderr.mockRestore())
    cacheOnDisk({ lastChecked: Date.now() - ONE_HOUR_MS, latestVersion: '0.0.0' })

    checkForUpdate()

    expect(stderr).not.toHaveBeenCalled()
  })

  it('does not ask the registry again within a day of the last check', async () => {
    cacheOnDisk({ lastChecked: Date.now() - ONE_HOUR_MS, latestVersion: '0.0.0' })

    checkForUpdate()
    await settle()

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('asks the registry when there is no cache yet, and saves what it answers', async () => {
    checkForUpdate()

    await vi.waitFor(() => expect(mockFs.writeFileSync).toHaveBeenCalled())
    expect(mockFetch).toHaveBeenCalledWith(REGISTRY_URL)
    expect(savedCache()).toMatchObject({ latestVersion: NEWER_VERSION, lastChecked: expect.any(Number) })
  })

  it('asks the registry again when the last check was over a day ago', async () => {
    cacheOnDisk({ lastChecked: Date.now() - TWO_DAYS_MS, latestVersion: '0.0.0' })

    checkForUpdate()

    await vi.waitFor(() => expect(mockFs.writeFileSync).toHaveBeenCalled())
    expect(mockFetch).toHaveBeenCalledWith(REGISTRY_URL)
  })

  it('keeps the other fields of the cache when it saves, such as one an older version wrote', async () => {
    cacheOnDisk({ lastChecked: Date.now() - TWO_DAYS_MS, latestVersion: '0.0.0', lastTelemetryPing: 123 })

    checkForUpdate()

    await vi.waitFor(() => expect(mockFs.writeFileSync).toHaveBeenCalled())
    expect(savedCache()).toMatchObject({ latestVersion: NEWER_VERSION, lastTelemetryPing: 123 })
  })

  it('saves nothing when the registry answers without a version', async () => {
    mockFetch.mockResolvedValue({ json: () => Promise.resolve({}) })

    checkForUpdate()
    await settle()

    expect(mockFs.writeFileSync).not.toHaveBeenCalled()
  })

  it('swallows a network failure and saves nothing, so the next run tries again', async () => {
    mockFetch.mockRejectedValue(new Error('offline'))

    expect(() => checkForUpdate()).not.toThrow()
    await settle()

    expect(mockFs.writeFileSync).not.toHaveBeenCalled()
  })
})
