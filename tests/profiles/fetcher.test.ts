import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(),
  },
}))

vi.mock('../../src/utils/paths', () => ({
  PROFILES_DIR: '/home/user/.workscribe/profiles',
  WORKSCRIBE_DIR: '/home/user/.workscribe',
}))

import fs from 'fs'
import { fetchManifest, fetchProfile, installProfile, readCachedManifest } from '../../src/profiles/fetcher'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>

const VALID_PROFILE = {
  name: 'flutter',
  displayName: 'Flutter',
  version: '1.0',
  rules: [{ pattern: '^flutter\\s+run\\b', category: 'running' }],
}

const VALID_MANIFEST = [
  { name: 'flutter', displayName: 'Flutter', tags: ['mobile'], description: '', keywords: ['flutter'] },
]

function jsonResponse(data: unknown, status = 200) {
  return { ok: status < 400, status, json: () => Promise.resolve(data) }
}

beforeEach(() => {
  vi.clearAllMocks()
  mockFs.existsSync.mockReturnValue(true)
})

describe('fetchManifest', () => {
  it('returns manifest entries on success', async () => {
    mockFetch.mockResolvedValue(jsonResponse(VALID_MANIFEST))
    const result = await fetchManifest()
    expect(result).toEqual(VALID_MANIFEST)
  })

  it('throws on non-ok response', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 503))
    await expect(fetchManifest()).rejects.toThrow('Registry unreachable')
  })

  it('throws when manifest format is unrecognised', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ not: 'an array' }))
    await expect(fetchManifest()).rejects.toThrow('Manifest format unrecognised')
  })
})

describe('fetchProfile', () => {
  it('returns a valid profile on success', async () => {
    mockFetch.mockResolvedValue(jsonResponse(VALID_PROFILE))
    const result = await fetchProfile('flutter')
    expect(result.name).toBe('flutter')
  })

  it('throws a clear message on 404', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) })
    await expect(fetchProfile('unknown')).rejects.toThrow('Profile "unknown" not found')
  })

  it('throws on non-ok non-404 response', async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 500))
    await expect(fetchProfile('flutter')).rejects.toThrow('Registry unreachable')
  })

  it('throws when fetched JSON fails schema validation', async () => {
    mockFetch.mockResolvedValue(jsonResponse({ name: 'flutter' })) // missing required fields
    await expect(fetchProfile('flutter')).rejects.toThrow('schema validation')
  })
})

describe('installProfile', () => {
  it('writes the profile JSON to PROFILES_DIR', async () => {
    mockFetch.mockResolvedValue(jsonResponse(VALID_PROFILE))
    mockFs.existsSync.mockReturnValue(true)
    await installProfile('flutter')
    expect(mockFs.writeFileSync).toHaveBeenCalledWith(
      expect.stringContaining('flutter.json'),
      expect.stringContaining('"name": "flutter"'),
      expect.any(Object)
    )
  })

  it('creates PROFILES_DIR when it does not exist', async () => {
    mockFetch.mockResolvedValue(jsonResponse(VALID_PROFILE))
    mockFs.existsSync.mockReturnValue(false)
    await installProfile('flutter')
    expect(mockFs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining('profiles'), expect.any(Object))
  })

  it('propagates fetch errors', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) })
    await expect(installProfile('unknown')).rejects.toThrow()
  })
})

describe('readCachedManifest', () => {
  it('returns null when manifest file does not exist', () => {
    mockFs.existsSync.mockReturnValue(false)
    expect(readCachedManifest()).toBeNull()
  })

  it('returns the parsed manifest when file is valid', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify(VALID_MANIFEST))
    expect(readCachedManifest()).toEqual(VALID_MANIFEST)
  })

  it('returns null when file contains invalid JSON', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('{ broken json')
    expect(readCachedManifest()).toBeNull()
  })

  it('returns null when file contains an invalid manifest structure', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ not: 'an array' }))
    expect(readCachedManifest()).toBeNull()
  })
})
