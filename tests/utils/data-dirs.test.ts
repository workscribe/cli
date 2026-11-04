import { describe, it, expect } from 'vitest'
import { resolveDataDirs } from '../../src/utils/data-dirs'

const HOME = '/Users/dev'
const XDG = {
  legacyDir: '/Users/dev/.workscribe',
  dataDir: '/Users/dev/.local/share/workscribe',
  configDir: '/Users/dev/.config/workscribe',
  stateDir: '/Users/dev/.local/state/workscribe',
}
const LEGACY = {
  legacyDir: '/Users/dev/.workscribe',
  dataDir: '/Users/dev/.workscribe',
  configDir: '/Users/dev/.workscribe',
  stateDir: '/Users/dev/.workscribe',
}

function dirsWith(files: string[], env = {}) {
  return resolveDataDirs({ homeDir: HOME, env, exists: (filePath) => files.includes(filePath) })
}

describe('resolveDataDirs', () => {
  it('uses the XDG folders on a fresh install', () => {
    expect(dirsWith([])).toEqual(XDG)
  })

  it('stays on XDG once ~/.workscribe exists for the alerts file or because init created it', () => {
    expect(dirsWith(['/Users/dev/.workscribe', '/Users/dev/.workscribe/alerts.pending'])).toEqual(XDG)
  })

  it.each([['workscribe.db'], ['config.json']])('keeps ~/.workscribe for an install that has its %s there', (file) => {
    expect(dirsWith(['/Users/dev/.workscribe', `/Users/dev/.workscribe/${file}`])).toEqual(LEGACY)
  })

  it('follows XDG_*_HOME when they are set', () => {
    expect(dirsWith([], { XDG_DATA_HOME: '/data', XDG_CONFIG_HOME: '/conf', XDG_STATE_HOME: '/state' })).toEqual({
      legacyDir: '/Users/dev/.workscribe',
      dataDir: '/data/workscribe',
      configDir: '/conf/workscribe',
      stateDir: '/state/workscribe',
    })
  })

  it('treats an empty XDG_*_HOME as unset rather than as the current folder', () => {
    expect(dirsWith([], { XDG_DATA_HOME: '', XDG_CONFIG_HOME: '', XDG_STATE_HOME: '' })).toEqual(XDG)
  })
})
