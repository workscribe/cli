import { describe, it, expect } from 'vitest'
import { isValidProfile, isValidManifest } from '../../src/profiles/schema'

const VALID_PROFILE = {
  name: 'flutter',
  displayName: 'Flutter',
  version: '1.0',
  rules: [{ pattern: '^flutter\\s+run\\b', category: 'running' }],
}

describe('isValidProfile', () => {
  it('accepts a minimal valid profile', () => {
    expect(isValidProfile(VALID_PROFILE)).toBe(true)
  })

  it('accepts a profile with all optional fields', () => {
    expect(
      isValidProfile({
        ...VALID_PROFILE,
        detect: { files: ['pubspec.yaml'] },
        aiContext: 'Flutter developer',
        rules: [{ pattern: '^flutter\\b', category: 'running', metadata: { tool: 'flutter', target: '$1' } }],
      })
    ).toBe(true)
  })

  it('rejects null', () => expect(isValidProfile(null)).toBe(false))
  it('rejects a plain string', () => expect(isValidProfile('flutter')).toBe(false))
  it('rejects an array', () => expect(isValidProfile([])).toBe(false))

  it('rejects a profile with missing name', () => {
    const { name: _n, ...rest } = VALID_PROFILE
    expect(isValidProfile(rest)).toBe(false)
  })

  it('rejects a profile with empty name', () => {
    expect(isValidProfile({ ...VALID_PROFILE, name: '' })).toBe(false)
  })

  it('rejects a profile with missing displayName', () => {
    const { displayName: _d, ...rest } = VALID_PROFILE
    expect(isValidProfile(rest)).toBe(false)
  })

  it('rejects a profile with missing version', () => {
    const { version: _v, ...rest } = VALID_PROFILE
    expect(isValidProfile(rest)).toBe(false)
  })

  it('rejects a profile where rules is not an array', () => {
    expect(isValidProfile({ ...VALID_PROFILE, rules: 'bad' })).toBe(false)
  })

  it('rejects a profile where a rule is missing pattern', () => {
    expect(isValidProfile({ ...VALID_PROFILE, rules: [{ category: 'running' }] })).toBe(false)
  })

  it('rejects a profile where a rule is missing category', () => {
    expect(isValidProfile({ ...VALID_PROFILE, rules: [{ pattern: '^flutter\\b' }] })).toBe(false)
  })

  it('rejects a profile where a rule has an empty pattern', () => {
    expect(isValidProfile({ ...VALID_PROFILE, rules: [{ pattern: '', category: 'running' }] })).toBe(false)
  })
})

describe('isValidManifest', () => {
  it('accepts a valid manifest array', () => {
    expect(
      isValidManifest([{ name: 'flutter', displayName: 'Flutter', tags: ['mobile'], description: '', keywords: [] }])
    ).toBe(true)
  })

  it('accepts an empty array', () => {
    expect(isValidManifest([])).toBe(true)
  })

  it('rejects null', () => expect(isValidManifest(null)).toBe(false))
  it('rejects a non-array', () => expect(isValidManifest({ name: 'flutter' })).toBe(false))

  it('rejects an array where an entry is missing name', () => {
    expect(isValidManifest([{ displayName: 'Flutter' }])).toBe(false)
  })
})
