import { describe, it, expect, vi, onTestFinished } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

vi.mock('../../src/capture/git', () => ({ getRepoContext: vi.fn() }))

import { getRepoContext, type RepoContext } from '../../src/capture/git'
import { eventDimensions, fileEventDimensions } from '../../src/capture/dimensions'
import { createTestConfig } from '../helpers/config'

const mockGetRepoContext = vi.mocked(getRepoContext)

const API: RepoContext = {
  repoName: 'api',
  branch: 'main',
  root: '/code/api',
  remote: { owner: 'acme', repo: 'api' },
  project: { identity: 'remote:github.com/acme/api', kind: 'remote' },
}
const OUTSIDE_A_REPO: RepoContext = { repoName: null, branch: null, root: null, remote: null, project: null }
const SITE: RepoContext = {
  repoName: 'site',
  branch: 'redesign',
  root: '/code/site',
  remote: { owner: 'acme', repo: 'site' },
  project: { identity: 'remote:github.com/acme/site', kind: 'remote' },
}

describe('eventDimensions', () => {
  it("links the event to the repo's project, under the name and root capture found", () => {
    expect(eventDimensions(API)).toEqual({
      project: { identity: 'remote:github.com/acme/api', kind: 'remote', name: 'api', root: '/code/api' },
      branch: 'main',
      file: null,
    })
  })

  it('links nothing outside a repo, or when the context has no project', () => {
    expect(eventDimensions(OUTSIDE_A_REPO)).toEqual({ project: null, branch: null, file: null })
    const { project: _project, ...withoutProject } = API
    expect(eventDimensions(withoutProject as RepoContext).project).toBeNull()
  })
})

describe('fileEventDimensions', () => {
  it('links a save in the open repo to its file, without asking git again', () => {
    const dimensions = fileEventDimensions(API, '/code/api/src/index.ts', createTestConfig())

    expect(dimensions).toMatchObject({
      project: { identity: 'remote:github.com/acme/api' },
      branch: 'main',
      file: { relativePath: 'src/index.ts', action: 'save' },
    })
    expect(mockGetRepoContext).not.toHaveBeenCalled()
  })

  it("takes the file's own repo when the editor has a folder above it open, and drops the folder's branch", () => {
    mockGetRepoContext.mockReturnValue(SITE)

    const dimensions = fileEventDimensions(OUTSIDE_A_REPO, '/code/site/README.md', createTestConfig())

    expect(mockGetRepoContext).toHaveBeenCalledWith('/code/site', expect.anything())
    expect(dimensions).toEqual({
      project: { identity: 'remote:github.com/acme/site', kind: 'remote', name: 'site', root: '/code/site' },
      branch: null,
      file: { relativePath: 'README.md', action: 'save' },
    })
  })

  it("keeps the open folder's links when the file is in no repo", () => {
    mockGetRepoContext.mockReturnValue(OUTSIDE_A_REPO)

    expect(fileEventDimensions(OUTSIDE_A_REPO, '/home/me/.zshrc', createTestConfig())).toEqual({
      project: null,
      branch: null,
      file: null,
    })
  })

  it('finds the file inside the root when it was opened through a symlink', () => {
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-dimensions-')))
    onTestFinished(() => fs.rmSync(directory, { recursive: true, force: true }))
    const root = path.join(directory, 'api')
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'src', 'index.ts'), '')
    const link = path.join(directory, 'link')
    fs.symlinkSync(root, link)

    const dimensions = fileEventDimensions({ ...API, root }, path.join(link, 'src', 'index.ts'), createTestConfig())

    expect(dimensions.file).toEqual({ relativePath: path.join('src', 'index.ts'), action: 'save' })
  })

  it('takes the nested repo or submodule a save is in, not the open repo around it', () => {
    const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-nested-')))
    onTestFinished(() => fs.rmSync(directory, { recursive: true, force: true }))
    const outer = path.join(directory, 'api')
    const inner = path.join(outer, 'vendor', 'lib')
    fs.mkdirSync(path.join(inner, 'src'), { recursive: true })
    fs.writeFileSync(path.join(inner, '.git'), 'gitdir: ../../.git/modules/lib\n')
    mockGetRepoContext.mockReturnValue({ ...SITE, root: inner })

    const dimensions = fileEventDimensions({ ...API, root: outer }, path.join(inner, 'src', 'x.ts'), createTestConfig())

    expect(mockGetRepoContext).toHaveBeenCalledWith(path.join(inner, 'src'), expect.anything())
    expect(dimensions).toMatchObject({
      project: { identity: 'remote:github.com/acme/site' },
      branch: null,
      file: { relativePath: path.join('src', 'x.ts') },
    })
  })
})
