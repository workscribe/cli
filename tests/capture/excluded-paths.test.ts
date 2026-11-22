import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { isExcluded, toExcludedPath } from '../../src/capture/excluded-paths'

const HOME = '/Users/dev'
const EXCLUDED = ['/Users/dev/work/client']

function excluded(location: Parameters<typeof isExcluded>[0], excludePaths: unknown = EXCLUDED): boolean {
  return isExcluded(location, excludePaths, HOME)
}

describe('isExcluded: where the event happened', () => {
  it('excludes the folder itself and anything below it', () => {
    expect(excluded({ cwd: '/Users/dev/work/client' })).toBe(true)
    expect(excluded({ cwd: '/Users/dev/work/client/src/deep' })).toBe(true)
  })

  it('does not exclude a sibling that shares a name prefix', () => {
    expect(excluded({ cwd: '/Users/dev/work/client-old' })).toBe(false)
    expect(excluded({ cwd: '/Users/dev/work' })).toBe(false)
  })

  it('excludes an edit to a file under the folder, whichever folder the agent reports', () => {
    expect(excluded({ cwd: '/Users/dev/work', file: '/Users/dev/work/client/src/app.ts' })).toBe(true)
    expect(excluded({ cwd: '/Users/dev/work', file: '/Users/dev/work/client-old/app.ts' })).toBe(false)
  })
})

describe('isExcluded: how an entry is written', () => {
  it('reads a trailing slash and a ~ the same as the plain path', () => {
    expect(excluded({ cwd: '/Users/dev/work/client/src' }, ['/Users/dev/work/client/'])).toBe(true)
    expect(excluded({ cwd: '/Users/dev/work/client/src' }, ['~/work/client'])).toBe(true)
  })

  it('reads a missing, empty or invalid list as nothing excluded', () => {
    // Not through `excluded`, whose default list would stand in for undefined
    expect(isExcluded({ cwd: '/Users/dev/work/client' }, undefined, HOME)).toBe(false)
    expect(excluded({ cwd: '/Users/dev/work/client' }, [])).toBe(false)
    expect(excluded({ cwd: '/Users/dev/work/client' }, 'not-a-list')).toBe(false)
    expect(excluded({ cwd: '/Users/dev/work/client' }, ['', 3, null])).toBe(false)
  })
})

describe('isExcluded: a command naming the folder', () => {
  it('excludes a command that names the folder or a path below it', () => {
    expect(excluded({ cwd: '/Users/dev', command: 'cd ~/work/client && npm test' })).toBe(true)
    expect(excluded({ cwd: '/Users/dev', command: 'cat ~/work/client/src/a.ts' })).toBe(true)
    expect(excluded({ cwd: '/Users/dev', command: 'cd ~/work/client/sub;' })).toBe(true)
    expect(excluded({ cwd: '/Users/dev', command: 'ls "/Users/dev/work/client/src"' })).toBe(true)
  })

  it('reads a path out of a flag value, a redirect, and $HOME', () => {
    expect(excluded({ cwd: '/Users/dev', command: 'tool --out=/Users/dev/work/client/build' })).toBe(true)
    expect(excluded({ cwd: '/Users/dev', command: 'cc -I/Users/dev/work/client/include main.c' })).toBe(true)
    expect(excluded({ cwd: '/Users/dev', command: 'echo hi >/Users/dev/work/client/log.txt' })).toBe(true)
    expect(excluded({ cwd: '/Users/dev', command: 'make 2>/Users/dev/work/client/err.txt' })).toBe(true)
    expect(excluded({ cwd: '/Users/dev', command: 'cat $HOME/work/client/a.ts' })).toBe(true)
    expect(excluded({ cwd: '/Users/dev', command: 'cat ${HOME}/work/client/a.ts' })).toBe(true)
  })

  it('does not read a sibling out of a flag value, a redirect or $HOME', () => {
    expect(excluded({ cwd: '/Users/dev', command: 'tool --out=/Users/dev/work/client-old/build' })).toBe(false)
    expect(excluded({ cwd: '/Users/dev', command: 'cat $HOME/work/client-old/a.ts' })).toBe(false)
  })

  it('does not exclude a command naming a sibling, or only a relative name', () => {
    expect(excluded({ cwd: '/Users/dev', command: 'cd ~/work/client-old && npm test' })).toBe(false)
    expect(excluded({ cwd: '/Users/dev/work', command: 'cd client && npm test' })).toBe(false)
  })
})

describe('isExcluded: through a symlink', () => {
  let temporary: string
  let realFolder: string
  let linkFolder: string

  beforeAll(() => {
    temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'excluded-paths-')))
    realFolder = path.join(temporary, 'real-client')
    linkFolder = path.join(temporary, 'link-client')
    fs.mkdirSync(path.join(realFolder, 'src'), { recursive: true })
    fs.symlinkSync(realFolder, linkFolder)
  })

  afterAll(() => {
    fs.rmSync(temporary, { recursive: true, force: true })
  })

  it('excludes the real folder when the symlink is listed', () => {
    expect(excluded({ cwd: path.join(realFolder, 'src') }, [linkFolder])).toBe(true)
  })

  it('excludes the symlink when the real folder is listed', () => {
    expect(excluded({ cwd: path.join(linkFolder, 'src') }, [realFolder])).toBe(true)
  })

  it('excludes a command that names the folder through a symlink', () => {
    expect(excluded({ cwd: temporary, command: `cat ${path.join(linkFolder, 'src', 'a.ts')}` }, [realFolder])).toBe(
      true
    )
  })

  it('excludes the edit of a file that no longer exists under an excluded folder', () => {
    const deletedFile = path.join(linkFolder, 'src', 'deleted.ts')

    expect(excluded({ cwd: temporary, file: deletedFile }, [realFolder])).toBe(true)
  })

  it('stores the real path for what the user typed', () => {
    expect(toExcludedPath('link-client', { baseDirectory: temporary })).toBe(realFolder)
  })
})

describe('isExcluded: a folder with a space in its name behind a symlink', () => {
  let temporary: string

  beforeAll(() => {
    temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'excluded-paths-space-')))
    fs.mkdirSync(path.join(temporary, 'My Client', 'src'), { recursive: true })
    fs.symlinkSync(path.join(temporary, 'My Client'), path.join(temporary, 'link'))
  })

  afterAll(() => {
    fs.rmSync(temporary, { recursive: true, force: true })
  })

  it('still matches a command that names the symlink', () => {
    const command = `cat ${path.join(temporary, 'link', 'src', 'a.ts')}`

    expect(excluded({ cwd: temporary, command }, [path.join(temporary, 'My Client')])).toBe(true)
  })
})

describe('isExcluded: capitals on a case-insensitive disk', () => {
  let temporary: string
  let isCaseInsensitive = false

  beforeAll(() => {
    temporary = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'excluded-paths-case-')))
    fs.mkdirSync(path.join(temporary, 'Client', 'Src'), { recursive: true })
    isCaseInsensitive = fs.existsSync(path.join(temporary, 'client'))
  })

  afterAll(() => {
    fs.rmSync(temporary, { recursive: true, force: true })
  })

  it.skipIf(process.platform === 'linux')('excludes a folder reached with other capitals', () => {
    if (!isCaseInsensitive) return

    expect(excluded({ cwd: path.join(temporary, 'CLIENT', 'SRC') }, [path.join(temporary, 'client')])).toBe(true)
    expect(excluded({ cwd: path.join(temporary, 'client', 'src') }, [path.join(temporary, 'CLIENT')])).toBe(true)
  })

  it.skipIf(process.platform === 'linux')('stores the capitals the disk has', () => {
    if (!isCaseInsensitive) return

    expect(toExcludedPath(path.join(temporary, 'client'), { baseDirectory: temporary })).toBe(
      path.join(temporary, 'Client')
    )
  })

  it('still tells a sibling apart', () => {
    expect(excluded({ cwd: path.join(temporary, 'Client-old') }, [path.join(temporary, 'Client')])).toBe(false)
  })
})

describe('toExcludedPath', () => {
  it('makes a relative path absolute, expands ~ and drops a trailing slash', () => {
    expect(toExcludedPath('client/', { baseDirectory: '/Users/dev/work', homeDirectory: HOME })).toBe(
      '/Users/dev/work/client'
    )
    expect(toExcludedPath('~/work/client', { baseDirectory: '/tmp', homeDirectory: HOME })).toBe(
      '/Users/dev/work/client'
    )
  })
})
