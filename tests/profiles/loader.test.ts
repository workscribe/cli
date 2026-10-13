import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    readdirSync: vi.fn(),
  },
}))

vi.mock('../../src/config', () => ({ readConfig: vi.fn() }))
vi.mock('../../src/profiles/fetcher', () => ({ readCachedManifest: vi.fn() }))

import fs from 'fs'
import { readConfig } from '../../src/config'
import { readCachedManifest } from '../../src/profiles/fetcher'
import {
  getActiveProfileRules,
  getActiveProfileAiContexts,
  getCachedProfiles,
  detectProfilesForDirectory,
} from '../../src/profiles/loader'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
const mockReadCachedManifest = readCachedManifest as ReturnType<typeof vi.fn>

const FLUTTER_PROFILE = {
  name: 'flutter',
  displayName: 'Flutter',
  version: '1.0',
  detect: { files: ['pubspec.yaml'] },
  rules: [
    { pattern: '^flutter\\s+run\\b', category: 'running', metadata: { tool: 'flutter' } },
    { pattern: '^flutter\\s+build\\s+(\\S+)', category: 'building', metadata: { tool: 'flutter', target: '$1' } },
    { pattern: '^flutter\\s+pub\\s+(get|install)\\b', category: 'dependencies', metadata: { tool: 'flutter' } },
    { pattern: '^flutter\\s+test\\b', category: 'testing', metadata: { tool: 'flutter' } },
  ],
  aiContext: 'This developer works with Flutter and Dart.',
}

beforeEach(() => {
  mockReadConfig.mockReturnValue({ capture: { profiles: [] } })
  mockFs.existsSync.mockReturnValue(false)
  mockReadCachedManifest.mockReturnValue(null)
})

describe('getActiveProfileRules', () => {
  it('returns empty array when no profiles are active', () => {
    mockReadConfig.mockReturnValue({ capture: { profiles: [] } })
    expect(getActiveProfileRules()).toEqual([])
  })

  it('returns empty array when a profile is active but not cached', () => {
    mockReadConfig.mockReturnValue({ capture: { profiles: ['flutter'] } })
    mockFs.existsSync.mockReturnValue(false)
    expect(getActiveProfileRules()).toEqual([])
  })

  it('returns compiled rules for a valid cached profile', () => {
    mockReadConfig.mockReturnValue({ capture: { profiles: ['flutter'] } })
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify(FLUTTER_PROFILE))
    const rules = getActiveProfileRules()
    expect(rules.length).toBe(FLUTTER_PROFILE.rules.length)
  })

  it('matches flutter run to running category', () => {
    mockReadConfig.mockReturnValue({ capture: { profiles: ['flutter'] } })
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify(FLUTTER_PROFILE))
    const rules = getActiveProfileRules()
    const result = rules.map((r) => r.match('flutter run')).find(Boolean)
    expect(result?.category).toBe('running')
    expect(result?.metadata.tool).toBe('flutter')
  })

  it('resolves $1 capture group substitution in metadata', () => {
    mockReadConfig.mockReturnValue({ capture: { profiles: ['flutter'] } })
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify(FLUTTER_PROFILE))
    const rules = getActiveProfileRules()
    const result = rules.map((r) => r.match('flutter build apk')).find(Boolean)
    expect(result?.category).toBe('building')
    expect(result?.metadata.target).toBe('apk')
  })

  it('skips a rule with an invalid regex pattern', () => {
    const profileWithBadRule = {
      ...FLUTTER_PROFILE,
      rules: [
        { pattern: '[invalid regex', category: 'running' },
        { pattern: '^flutter\\s+test\\b', category: 'testing', metadata: { tool: 'flutter' } },
      ],
    }
    mockReadConfig.mockReturnValue({ capture: { profiles: ['flutter'] } })
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify(profileWithBadRule))
    const rules = getActiveProfileRules()
    // Only the valid rule is compiled
    expect(rules.length).toBe(1)
    expect(rules[0].match('flutter test')).toBeTruthy()
  })

  it('skips a profile with invalid JSON', () => {
    mockReadConfig.mockReturnValue({ capture: { profiles: ['flutter'] } })
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue('{ not valid json }')
    expect(getActiveProfileRules()).toEqual([])
  })

  it('skips a profile that fails schema validation', () => {
    mockReadConfig.mockReturnValue({ capture: { profiles: ['flutter'] } })
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify({ name: 'flutter' })) // missing required fields
    expect(getActiveProfileRules()).toEqual([])
  })

  it('returns rules from multiple active profiles', () => {
    const androidProfile = {
      name: 'android',
      displayName: 'Android',
      version: '1.0',
      rules: [{ pattern: '^adb\\b', category: 'infrastructure', metadata: { tool: 'adb' } }],
    }
    mockReadConfig.mockReturnValue({ capture: { profiles: ['flutter', 'android'] } })
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync
      .mockReturnValueOnce(JSON.stringify(FLUTTER_PROFILE))
      .mockReturnValueOnce(JSON.stringify(androidProfile))
    const rules = getActiveProfileRules()
    expect(rules.length).toBe(FLUTTER_PROFILE.rules.length + 1)
  })
})

describe('getActiveProfileAiContexts', () => {
  it('returns empty array when no profiles are active', () => {
    expect(getActiveProfileAiContexts()).toEqual([])
  })

  it('returns aiContext strings for active profiles', () => {
    mockReadConfig.mockReturnValue({ capture: { profiles: ['flutter'] } })
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify(FLUTTER_PROFILE))
    expect(getActiveProfileAiContexts()).toEqual([FLUTTER_PROFILE.aiContext])
  })

  it('omits profiles with no aiContext', () => {
    const { aiContext: _ac, ...noContext } = FLUTTER_PROFILE
    mockReadConfig.mockReturnValue({ capture: { profiles: ['flutter'] } })
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(JSON.stringify(noContext))
    expect(getActiveProfileAiContexts()).toEqual([])
  })
})

describe('getCachedProfiles', () => {
  it('returns empty array when profiles dir does not exist', () => {
    mockFs.existsSync.mockReturnValue(false)
    expect(getCachedProfiles()).toEqual([])
  })

  it('returns all valid cached profiles', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readdirSync.mockReturnValue(['flutter.json', 'manifest.json', 'android.json'])
    mockFs.readFileSync.mockReturnValue(JSON.stringify(FLUTTER_PROFILE))
    const profiles = getCachedProfiles()
    // manifest.json is excluded, 2 valid profiles
    expect(profiles.length).toBe(2)
  })
})

describe('detectProfilesForDirectory', () => {
  it('returns empty array when manifest is not cached', () => {
    mockReadCachedManifest.mockReturnValue(null)
    expect(detectProfilesForDirectory('/some/dir')).toEqual([])
  })

  it('returns matching profiles when indicator files are present', () => {
    mockReadCachedManifest.mockReturnValue([
      {
        name: 'flutter',
        displayName: 'Flutter',
        tags: ['mobile'],
        description: '',
        keywords: ['flutter'],
        detect: { files: ['pubspec.yaml'] },
      },
    ])
    mockReadConfig.mockReturnValue({ capture: { profiles: [] } })
    mockFs.existsSync.mockImplementation((p: string) => (p as string).endsWith('pubspec.yaml'))
    const result = detectProfilesForDirectory('/my/app')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('flutter')
  })

  it('excludes profiles that are already active', () => {
    mockReadCachedManifest.mockReturnValue([
      {
        name: 'flutter',
        displayName: 'Flutter',
        tags: ['mobile'],
        description: '',
        keywords: ['flutter'],
        detect: { files: ['pubspec.yaml'] },
      },
    ])
    mockReadConfig.mockReturnValue({ capture: { profiles: ['flutter'] } })
    mockFs.existsSync.mockReturnValue(true)
    expect(detectProfilesForDirectory('/my/app')).toEqual([])
  })

  it('excludes profiles where not all indicator files are present', () => {
    mockReadCachedManifest.mockReturnValue([
      {
        name: 'laravel',
        displayName: 'Laravel',
        tags: ['framework'],
        description: '',
        keywords: ['artisan'],
        detect: { files: ['artisan', 'composer.json'] },
      },
    ])
    mockReadConfig.mockReturnValue({ capture: { profiles: [] } })
    // Only artisan present, composer.json missing
    mockFs.existsSync.mockImplementation((p: string) => (p as string).endsWith('artisan'))
    expect(detectProfilesForDirectory('/my/app')).toEqual([])
  })

  it('excludes profiles with no detect.files', () => {
    mockReadCachedManifest.mockReturnValue([
      { name: 'sre', displayName: 'SRE', tags: ['domain'], description: '', keywords: ['kubectl'] },
    ])
    mockReadConfig.mockReturnValue({ capture: { profiles: [] } })
    expect(detectProfilesForDirectory('/my/app')).toEqual([])
  })
})
