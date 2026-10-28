import { describe, it, expect, onTestFinished } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { currentDirectory, rootForms } from '../../src/utils/working-directory'

/** A real repo folder, `real/api/src`, and a symlink `link` → `real` beside it, in a resolved temp folder. */
function symlinkedRepo(): { realRoot: string; linkedRoot: string } {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-cwd-')))
  onTestFinished(() => fs.rmSync(base, { recursive: true, force: true }))
  fs.mkdirSync(path.join(base, 'real', 'api', 'src'), { recursive: true })
  fs.symlinkSync(path.join(base, 'real'), path.join(base, 'link'))
  return { realRoot: path.join(base, 'real', 'api'), linkedRoot: path.join(base, 'link', 'api') }
}

describe('currentDirectory', () => {
  it('is $PWD when it is the same folder through a symlink, as the shell hook stores it', () => {
    const { realRoot, linkedRoot } = symlinkedRepo()
    expect(currentDirectory({ pwd: linkedRoot, cwd: realRoot })).toBe(linkedRoot)
  })

  it('is the resolved folder when $PWD is stale or missing', () => {
    const { realRoot } = symlinkedRepo()
    expect(currentDirectory({ pwd: path.dirname(realRoot), cwd: realRoot })).toBe(realRoot)
    expect(currentDirectory({ pwd: undefined, cwd: realRoot })).toBe(realRoot)
  })
})

describe('rootForms', () => {
  it("gives git's resolved root and the root as reached through the symlink", () => {
    const { realRoot, linkedRoot } = symlinkedRepo()
    expect(rootForms(path.join(linkedRoot, 'src'), realRoot)).toEqual([realRoot, linkedRoot])
  })

  it('gives just the root when nothing is symlinked', () => {
    const { realRoot } = symlinkedRepo()
    expect(rootForms(path.join(realRoot, 'src'), realRoot)).toEqual([realRoot])
  })

  it('gives just the root when the folder no longer exists', () => {
    expect(rootForms('/nonexistent/api/src', '/nonexistent/api')).toEqual(['/nonexistent/api'])
  })

  it("covers macOS's /tmp → /private/tmp", () => {
    const tmp = os.tmpdir() // a symlinked path on macOS (/var → /private/var); a plain one elsewhere
    const forms = rootForms(tmp, fs.realpathSync(tmp))
    expect(forms).toContain(fs.realpathSync(tmp))
    expect(forms).toContain(path.resolve(tmp))
  })
})
