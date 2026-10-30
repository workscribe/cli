import { describe, it, expect } from 'vitest'
import { canonicalRemote, nameIdentity, projectIdentity, withoutCredentials } from '../../src/capture/project-identity'

describe('canonicalRemote', () => {
  it.each([
    'git@github.com:Workscribe/cli.git',
    'https://github.com/workscribe/cli.git',
    'https://user@github.com/workscribe/cli',
    'https://user:token@github.com/workscribe/cli/',
    'ssh://git@github.com:22/workscribe/cli.git',
    'git://github.com/workscribe/cli',
  ])('gives the same key for %s', (url) => {
    expect(canonicalRemote(url)).toBe('github.com/workscribe/cli')
  })

  it('keeps every group of a nested path', () => {
    expect(canonicalRemote('git@gitlab.com:group/sub/repo.git')).toBe('gitlab.com/group/sub/repo')
  })

  it.each(['/srv/git/repo.git', '../repo', 'file:///srv/git/repo.git', 'https://github.com', ''])(
    'has no key for %j, which has no host and path',
    (url) => {
      expect(canonicalRemote(url)).toBeNull()
    }
  )
})

describe('projectIdentity', () => {
  it('prefers the remote', () => {
    expect(projectIdentity({ remoteUrl: 'git@github.com:acme/api.git', commonDir: '/code/api/.git' })).toEqual({
      identity: 'remote:github.com/acme/api',
      kind: 'remote',
    })
  })

  it('falls back to the git folder when the remote has no host', () => {
    expect(projectIdentity({ remoteUrl: '/srv/git/api.git', commonDir: '/code/api/.git' })).toEqual({
      identity: 'local:/code/api/.git',
      kind: 'local',
    })
  })

  it('has none without either', () => {
    expect(projectIdentity({ remoteUrl: null, commonDir: null })).toBeNull()
  })
})

describe('nameIdentity', () => {
  it('is case-insensitive', () => {
    expect(nameIdentity('Acme/API')).toEqual({ identity: 'name:acme/api', kind: 'name' })
  })
})

describe('withoutCredentials', () => {
  it.each([
    ['https://user:ghp_secret@github.com/acme/api.git', 'https://github.com/acme/api.git'],
    ['https://oauth2:p%40ss@gitlab.com/group/api', 'https://gitlab.com/group/api'],
    ['ssh://git@github.com:22/acme/api.git', 'ssh://github.com:22/acme/api.git'],
    ['https://github.com/acme/api.git', 'https://github.com/acme/api.git'],
    ['git@github.com:acme/api.git', 'git@github.com:acme/api.git'],
    ['/srv/git/api.git', '/srv/git/api.git'],
  ])('turns %s into %s', (url, expected) => {
    expect(withoutCredentials(url)).toBe(expected)
  })
})
