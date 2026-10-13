import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/config', () => ({ readConfig: vi.fn(), writeConfig: vi.fn() }))
vi.mock('../../src/db', () => ({ getOtherEventToolCounts: vi.fn() }))
vi.mock('../../src/profiles/fetcher', () => ({
  installProfile: vi.fn(),
  cacheManifest: vi.fn(),
  readCachedManifest: vi.fn(),
}))
vi.mock('../../src/profiles/loader', () => ({
  getCachedProfiles: vi.fn(),
  detectProfilesForDirectory: vi.fn(),
  getActiveProfileRules: vi.fn().mockReturnValue([]),
  loadUserProfiles: vi.fn().mockReturnValue([]),
}))
vi.mock('fs', () => ({
  default: { existsSync: vi.fn(), unlinkSync: vi.fn() },
}))
vi.mock('../../src/utils/paths', () => ({ PROFILES_DIR: '/home/user/.workscribe/profiles' }))

import { Command } from 'commander'
import fs from 'fs'
import { readConfig, writeConfig } from '../../src/config'
import { getOtherEventToolCounts } from '../../src/db'
import { installProfile, cacheManifest, readCachedManifest } from '../../src/profiles/fetcher'
import { getCachedProfiles, detectProfilesForDirectory } from '../../src/profiles/loader'
import { log } from '../../src/utils/logger'
import { registerProfile } from '../../src/cli/profile'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>
const mockReadConfig = readConfig as ReturnType<typeof vi.fn>
const mockWriteConfig = writeConfig as ReturnType<typeof vi.fn>
const mockGetOtherEventToolCounts = getOtherEventToolCounts as ReturnType<typeof vi.fn>
const mockInstallProfile = installProfile as ReturnType<typeof vi.fn>
const mockCacheManifest = cacheManifest as ReturnType<typeof vi.fn>
const mockReadCachedManifest = readCachedManifest as ReturnType<typeof vi.fn>
const mockGetCachedProfiles = getCachedProfiles as ReturnType<typeof vi.fn>
const mockDetectProfilesForDirectory = detectProfilesForDirectory as ReturnType<typeof vi.fn>
const mockLog = log as Record<string, ReturnType<typeof vi.fn>>

const MANIFEST = [
  {
    name: 'flutter',
    displayName: 'Flutter',
    tags: ['mobile'],
    description: 'Flutter CLI',
    keywords: ['flutter'],
    detect: { files: ['pubspec.yaml'] },
  },
  {
    name: 'android',
    displayName: 'Android',
    tags: ['mobile'],
    description: 'Android tools',
    keywords: ['adb', './gradlew'],
    detect: { files: ['build.gradle'] },
  },
  {
    name: 'rails',
    displayName: 'Ruby on Rails',
    tags: ['framework'],
    description: 'Rails commands',
    keywords: ['rails', 'rake'],
    detect: { files: ['config/application.rb'] },
  },
]

const BASE_CONFIG = { capture: { profiles: [] } }

function makeProgram() {
  const program = new Command()
  program.exitOverride()
  registerProfile(program)
  return program
}

beforeEach(() => {
  mockReadConfig.mockReturnValue({ ...BASE_CONFIG, capture: { profiles: [] } })
  mockFs.existsSync.mockReturnValue(false)
  mockReadCachedManifest.mockReturnValue(MANIFEST)
  mockCacheManifest.mockResolvedValue(MANIFEST)
  mockGetCachedProfiles.mockReturnValue([])
})

describe('workscribe profile list', () => {
  it('fetches the manifest when not cached', async () => {
    mockReadCachedManifest.mockReturnValue(null)
    await makeProgram().parseAsync(['profile', 'list'], { from: 'user' })
    expect(mockCacheManifest).toHaveBeenCalled()
  })

  it('uses cached manifest without re-fetching when available', async () => {
    await makeProgram().parseAsync(['profile', 'list'], { from: 'user' })
    // cacheManifest called for background refresh but not blocking
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('flutter'))
  })

  it('shows offline warning when registry is unreachable and no cache', async () => {
    mockReadCachedManifest.mockReturnValue(null)
    mockCacheManifest.mockRejectedValue(new Error('network'))
    mockGetCachedProfiles.mockReturnValue([])
    await makeProgram().parseAsync(['profile', 'list'], { from: 'user' })
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('Registry unreachable'))
  })
})

describe('workscribe profile add', () => {
  it('installs a profile and writes it to config', async () => {
    mockInstallProfile.mockResolvedValue(undefined)
    await makeProgram().parseAsync(['profile', 'add', 'flutter'], { from: 'user' })
    expect(mockInstallProfile).toHaveBeenCalledWith('flutter')
    expect(mockWriteConfig).toHaveBeenCalledWith(
      expect.objectContaining({ capture: expect.objectContaining({ profiles: ['flutter'] }) })
    )
  })

  it('installs multiple profiles in one command', async () => {
    mockInstallProfile.mockResolvedValue(undefined)
    await makeProgram().parseAsync(['profile', 'add', 'flutter', 'android'], { from: 'user' })
    expect(mockInstallProfile).toHaveBeenCalledWith('flutter')
    expect(mockInstallProfile).toHaveBeenCalledWith('android')
  })

  it('skips a profile that is already active', async () => {
    mockReadConfig.mockReturnValue({ capture: { profiles: ['flutter'] } })
    await makeProgram().parseAsync(['profile', 'add', 'flutter'], { from: 'user' })
    expect(mockInstallProfile).not.toHaveBeenCalled()
    expect(mockLog.info).toHaveBeenCalledWith(expect.stringContaining('already active'))
  })

  it('logs an error and continues when install fails', async () => {
    mockInstallProfile
      .mockRejectedValueOnce(new Error('Profile "badname" not found in registry'))
      .mockResolvedValueOnce(undefined)
    await makeProgram().parseAsync(['profile', 'add', 'badname', 'flutter'], { from: 'user' })
    expect(mockLog.error).toHaveBeenCalledWith(expect.stringContaining('badname'))
    expect(mockInstallProfile).toHaveBeenCalledWith('flutter')
  })
})

describe('workscribe profile remove', () => {
  it('removes a profile from config and deletes the cache file', async () => {
    mockReadConfig.mockReturnValue({ capture: { profiles: ['flutter', 'android'] } })
    mockFs.existsSync.mockReturnValue(true)
    await makeProgram().parseAsync(['profile', 'remove', 'flutter'], { from: 'user' })
    expect(mockFs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining('flutter.json'))
    expect(mockWriteConfig).toHaveBeenCalledWith(
      expect.objectContaining({ capture: expect.objectContaining({ profiles: ['android'] }) })
    )
  })

  it('warns when removing a profile that is not active', async () => {
    mockReadConfig.mockReturnValue({ capture: { profiles: [] } })
    await makeProgram().parseAsync(['profile', 'remove', 'flutter'], { from: 'user' })
    expect(mockLog.warn).toHaveBeenCalledWith(expect.stringContaining('not active'))
    expect(mockWriteConfig).toHaveBeenCalled()
  })
})

describe('workscribe profile update', () => {
  it('re-fetches all installed profiles when no name given', async () => {
    mockReadConfig.mockReturnValue({ capture: { profiles: ['flutter', 'android'] } })
    mockInstallProfile.mockResolvedValue(undefined)
    await makeProgram().parseAsync(['profile', 'update'], { from: 'user' })
    expect(mockInstallProfile).toHaveBeenCalledWith('flutter')
    expect(mockInstallProfile).toHaveBeenCalledWith('android')
  })

  it('re-fetches a specific profile when name is given', async () => {
    mockReadConfig.mockReturnValue({ capture: { profiles: ['flutter', 'android'] } })
    mockInstallProfile.mockResolvedValue(undefined)
    await makeProgram().parseAsync(['profile', 'update', 'flutter'], { from: 'user' })
    expect(mockInstallProfile).toHaveBeenCalledWith('flutter')
    expect(mockInstallProfile).not.toHaveBeenCalledWith('android')
  })

  it('logs a message when no profiles are installed', async () => {
    mockReadConfig.mockReturnValue({ capture: { profiles: [] } })
    await makeProgram().parseAsync(['profile', 'update'], { from: 'user' })
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('No profiles installed'))
  })
})

describe('workscribe profile detect', () => {
  it('prints detected profiles and the add command', async () => {
    mockDetectProfilesForDirectory.mockReturnValue([MANIFEST[0]])
    await makeProgram().parseAsync(['profile', 'detect'], { from: 'user' })
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('flutter'))
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('workscribe profile add flutter'))
  })

  it('prompts to run profile list when no manifest is cached and nothing detected', async () => {
    mockReadCachedManifest.mockReturnValue(null)
    mockDetectProfilesForDirectory.mockReturnValue([])
    await makeProgram().parseAsync(['profile', 'detect'], { from: 'user' })
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('workscribe profile list'))
  })

  it('shows "no profiles detected" message when manifest is cached but nothing matches', async () => {
    mockDetectProfilesForDirectory.mockReturnValue([])
    await makeProgram().parseAsync(['profile', 'detect'], { from: 'user' })
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('No profiles detected'))
  })
})

describe('workscribe profile suggest', () => {
  it('lists profile suggestions matched against manifest keywords', async () => {
    mockGetOtherEventToolCounts.mockReturnValue([
      { tool: 'flutter', count: 94 },
      { tool: 'adb', count: 47 },
    ])
    await makeProgram().parseAsync(['profile', 'suggest'], { from: 'user' })
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('flutter'))
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('android'))
  })

  it('excludes already active profiles from suggestions', async () => {
    mockReadConfig.mockReturnValue({ capture: { profiles: ['flutter'] } })
    mockGetOtherEventToolCounts.mockReturnValue([{ tool: 'flutter', count: 94 }])
    await makeProgram().parseAsync(['profile', 'suggest'], { from: 'user' })
    const calls = (mockLog.plain as ReturnType<typeof vi.fn>).mock.calls.flat().join(' ')
    expect(calls).not.toContain('flutter')
  })

  it('shows no matches message when counts are below threshold', async () => {
    mockGetOtherEventToolCounts.mockReturnValue([{ tool: 'flutter', count: 2 }])
    await makeProgram().parseAsync(['profile', 'suggest'], { from: 'user' })
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('No profile matches'))
  })

  it('prompts to run profile list when no manifest is cached', async () => {
    mockReadCachedManifest.mockReturnValue(null)
    mockGetOtherEventToolCounts.mockReturnValue([{ tool: 'flutter', count: 94 }])
    await makeProgram().parseAsync(['profile', 'suggest'], { from: 'user' })
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('workscribe profile list'))
  })

  it('shows no activity message when there are no other events', async () => {
    mockGetOtherEventToolCounts.mockReturnValue([])
    await makeProgram().parseAsync(['profile', 'suggest'], { from: 'user' })
    expect(mockLog.plain).toHaveBeenCalledWith(expect.stringContaining('No unclassified commands'))
  })
})
