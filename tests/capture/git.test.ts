import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock child_process and fs before importing the module
vi.mock('child_process', () => ({ execSync: vi.fn() }))
vi.mock('fs', () => ({ default: { readFileSync: vi.fn(), existsSync: vi.fn(), realpathSync: vi.fn() } }))

import { execSync } from 'child_process'
import fs from 'fs'
import { getRepoContext, probeDirectory } from '../../src/capture/git'
import { createTestConfig } from '../helpers/config'

const mockExecSync = execSync as ReturnType<typeof vi.fn>
const mockReadFileSync = fs.readFileSync as ReturnType<typeof vi.fn>
const mockExistsSync = fs.existsSync as ReturnType<typeof vi.fn>
const mockRealpathSync = fs.realpathSync as ReturnType<typeof vi.fn>

function setupGitRoot(root = '/home/user/sandbox/chronicle') {
  mockExecSync.mockImplementation((cmd: string) => {
    if (cmd === 'git rev-parse --show-toplevel') return Buffer.from(root + '\n')
    if (cmd === 'git branch --show-current') return Buffer.from('main\n')
    if (cmd === 'git remote get-url origin') throw new Error('no remote')
    throw new Error(`unexpected: ${cmd}`)
  })
}

beforeEach(() => {
  mockReadFileSync.mockImplementation(() => {
    throw new Error('no package.json')
  })
})

describe('getRepoContext — the projects override', () => {
  it('the projects override always wins over remote and package.json', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/root\n')
      if (cmd === 'git branch --show-current') return Buffer.from('main\n')
      if (cmd === 'git remote get-url origin') return Buffer.from('https://github.com/org/remote-name.git\n')
      throw new Error(`unexpected: ${cmd}`)
    })
    const { repoName } = getRepoContext('/root', createTestConfig({ projects: { '/root': 'my-override' } }))
    expect(repoName).toBe('my-override')
  })
})

describe('getRepoContext — remote URL', () => {
  it('extracts repo name from HTTPS URL with .git suffix', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/home/user/chronicle\n')
      if (cmd === 'git branch --show-current') return Buffer.from('main\n')
      if (cmd === 'git remote get-url origin') return Buffer.from('https://github.com/org/workscribe.git\n')
      throw new Error(`unexpected: ${cmd}`)
    })
    const { repoName } = getRepoContext('/home/user/chronicle', createTestConfig())
    expect(repoName).toBe('workscribe')
  })

  it('extracts repo name from HTTPS URL without .git suffix', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/home/user/chronicle\n')
      if (cmd === 'git branch --show-current') return Buffer.from('main\n')
      if (cmd === 'git remote get-url origin') return Buffer.from('https://gitlab.com/org/workscribe\n')
      throw new Error(`unexpected: ${cmd}`)
    })
    const { repoName } = getRepoContext('/home/user/chronicle', createTestConfig())
    expect(repoName).toBe('workscribe')
  })

  it('extracts repo name from SSH remote URL', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/home/user/chronicle\n')
      if (cmd === 'git branch --show-current') return Buffer.from('main\n')
      if (cmd === 'git remote get-url origin') return Buffer.from('git@github.com:org/workscribe.git\n')
      throw new Error(`unexpected: ${cmd}`)
    })
    const { repoName } = getRepoContext('/home/user/chronicle', createTestConfig())
    expect(repoName).toBe('workscribe')
  })
})

describe('getRepoContext — qualifyRepoName', () => {
  it('returns bare repo name by default (qualifyRepoName off)', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/home/user/vscode\n')
      if (cmd === 'git branch --show-current') return Buffer.from('main\n')
      if (cmd === 'git remote get-url origin') return Buffer.from('https://github.com/workscribe/vscode.git\n')
      throw new Error(`unexpected: ${cmd}`)
    })
    const { repoName } = getRepoContext('/home/user/vscode', createTestConfig())
    expect(repoName).toBe('vscode')
  })

  it('returns owner/repo when qualifyRepoName is true (HTTPS remote)', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/home/user/vscode\n')
      if (cmd === 'git branch --show-current') return Buffer.from('main\n')
      if (cmd === 'git remote get-url origin') return Buffer.from('https://github.com/workscribe/vscode.git\n')
      throw new Error(`unexpected: ${cmd}`)
    })
    const { repoName } = getRepoContext('/home/user/vscode', createTestConfig({ git: { qualifyRepoName: true } }))
    expect(repoName).toBe('workscribe/vscode')
  })

  it('returns owner/repo when qualifyRepoName is true (SSH remote)', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/home/user/vscode\n')
      if (cmd === 'git branch --show-current') return Buffer.from('main\n')
      if (cmd === 'git remote get-url origin') return Buffer.from('git@github.com:workscribe/vscode.git\n')
      throw new Error(`unexpected: ${cmd}`)
    })
    const { repoName } = getRepoContext('/home/user/vscode', createTestConfig({ git: { qualifyRepoName: true } }))
    expect(repoName).toBe('workscribe/vscode')
  })

  it('the projects override still wins over qualifyRepoName', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/home/user/vscode\n')
      if (cmd === 'git branch --show-current') return Buffer.from('main\n')
      if (cmd === 'git remote get-url origin') return Buffer.from('https://github.com/workscribe/vscode.git\n')
      throw new Error(`unexpected: ${cmd}`)
    })
    const { repoName } = getRepoContext(
      '/home/user/vscode',
      createTestConfig({ git: { qualifyRepoName: true }, projects: { '/home/user/vscode': 'my-override' } })
    )
    expect(repoName).toBe('my-override')
  })
})

describe('getRepoContext — package.json fallback', () => {
  it('uses package.json name when remote fails', () => {
    setupGitRoot('/home/user/chronicle')
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'workscribe' }))
    const { repoName } = getRepoContext('/home/user/chronicle', createTestConfig())
    expect(repoName).toBe('workscribe')
  })

  it('strips @scope/ prefix from scoped package name', () => {
    setupGitRoot('/home/user/chronicle')
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@workscribe/cli' }))
    const { repoName } = getRepoContext('/home/user/chronicle', createTestConfig())
    expect(repoName).toBe('cli')
  })

  it('falls back to folder name when package.json has no name field', () => {
    setupGitRoot('/home/user/chronicle')
    mockReadFileSync.mockReturnValue(JSON.stringify({}))
    const { repoName } = getRepoContext('/home/user/chronicle', createTestConfig())
    expect(repoName).toBe('chronicle')
  })
})

describe('getRepoContext — folder name fallback', () => {
  it('uses folder name when remote and package.json both fail', () => {
    setupGitRoot('/home/user/chronicle')
    // readFileSync already throws by default from beforeEach
    const { repoName } = getRepoContext('/home/user/chronicle', createTestConfig())
    expect(repoName).toBe('chronicle')
  })
})

describe('getRepoContext — one name for every caller (WOR-118)', () => {
  const ROOT = '/home/user/vscode'

  function setupRemote(url: string | null) {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --show-toplevel') return Buffer.from(`${ROOT}\n`)
      if (cmd === 'git branch --show-current') return Buffer.from('main\n')
      if (cmd === 'git remote get-url origin') {
        if (url) return Buffer.from(`${url}\n`)
        throw new Error('no remote')
      }
      throw new Error(`unexpected: ${cmd}`)
    })
  }

  it('applies git.qualifyRepoName, and reports the root and the remote it named the repo from', () => {
    setupRemote('git@github.com:workscribe/vscode.git')
    const config = createTestConfig({ git: { qualifyRepoName: true } })

    expect(getRepoContext(ROOT, config)).toEqual({
      repoName: 'workscribe/vscode',
      branch: 'main',
      root: ROOT,
      remote: { owner: 'workscribe', repo: 'vscode' },
      project: { identity: 'remote:github.com/workscribe/vscode', kind: 'remote' },
    })
  })

  it('uses the bare name when git.qualifyRepoName is off', () => {
    setupRemote('git@github.com:workscribe/vscode.git')
    expect(getRepoContext(ROOT, createTestConfig()).repoName).toBe('vscode')
  })

  it('applies the projects override for the folder, with no remote to match against', () => {
    setupRemote('git@github.com:workscribe/vscode.git')
    const config = createTestConfig({ git: { qualifyRepoName: true }, projects: { [ROOT]: 'my-name' } })

    expect(getRepoContext(ROOT, config)).toMatchObject({ repoName: 'my-name', root: ROOT, remote: null })
  })

  it('keeps an empty-string override as the name, as before', () => {
    setupRemote('git@github.com:workscribe/vscode.git')
    expect(getRepoContext(ROOT, createTestConfig({ projects: { [ROOT]: '' } })).repoName).toBe('')
  })

  it('has no remote when the name came from the folder', () => {
    setupRemote(null)
    expect(getRepoContext(ROOT, createTestConfig())).toMatchObject({ repoName: 'vscode', remote: null })
  })

  it('is all null outside a git repository', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('not a git repository')
    })
    expect(getRepoContext('/tmp', createTestConfig())).toEqual({
      repoName: null,
      branch: null,
      root: null,
      remote: null,
      project: null,
    })
  })
})

describe('getRepoContext — the project identity', () => {
  const ROOT = '/home/user/api'

  function setupRepo(options: { remote: string | null; commonDir?: string }) {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --show-toplevel') return Buffer.from(`${ROOT}\n`)
      if (cmd === 'git branch --show-current') return Buffer.from('main\n')
      if (cmd === 'git rev-parse --git-common-dir' && options.commonDir) return Buffer.from(`${options.commonDir}\n`)
      if (cmd === 'git remote get-url origin' && options.remote) return Buffer.from(`${options.remote}\n`)
      throw new Error(`unexpected: ${cmd}`)
    })
  }

  it('is the same for both name forms, so qualifyRepoName never changes it', () => {
    setupRepo({ remote: 'git@github.com:acme/api.git' })

    const bare = getRepoContext(ROOT, createTestConfig())
    const qualified = getRepoContext(ROOT, createTestConfig({ git: { qualifyRepoName: true } }))

    expect(bare.repoName).not.toBe(qualified.repoName)
    expect(bare.project).toEqual(qualified.project)
  })

  it('still comes from the remote when a projects override names the repo', () => {
    setupRepo({ remote: 'https://github.com/acme/api.git' })

    const context = getRepoContext(ROOT, createTestConfig({ projects: { [ROOT]: 'my-name' } }))

    expect(context).toMatchObject({
      repoName: 'my-name',
      remote: null,
      project: { identity: 'remote:github.com/acme/api', kind: 'remote' },
    })
  })

  it('is the resolved git folder when there is no remote, so every worktree shares it', () => {
    setupRepo({ remote: null, commonDir: '../main/.git' })
    mockRealpathSync.mockImplementation((target: string) => target)

    expect(getRepoContext(ROOT, createTestConfig()).project).toEqual({
      identity: 'local:/home/user/main/.git',
      kind: 'local',
    })
  })
})

describe('probeDirectory', () => {
  it('reports a folder that is gone without asking git', () => {
    mockExistsSync.mockReturnValue(false)

    expect(probeDirectory('/gone')).toEqual({ outcome: 'missing' })
    expect(mockExecSync).not.toHaveBeenCalled()
  })

  it('reports a folder outside any repo', () => {
    mockExistsSync.mockReturnValue(true)
    mockExecSync.mockImplementation(() => {
      throw new Error('not a git repository')
    })

    expect(probeDirectory('/tmp')).toEqual({ outcome: 'not-a-repo' })
  })

  it("reports a repo's root, git folder and remote", () => {
    mockExistsSync.mockReturnValue(true)
    mockRealpathSync.mockImplementation((target: string) => target)
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/repo\n')
      if (cmd === 'git rev-parse --git-common-dir') return Buffer.from('../.git\n')
      if (cmd === 'git remote get-url origin') return Buffer.from('git@github.com:acme/api.git\n')
      throw new Error(`unexpected: ${cmd}`)
    })

    expect(probeDirectory('/repo/src')).toEqual({
      outcome: 'repo',
      root: '/repo',
      commonDir: '/repo/.git',
      remoteUrl: 'git@github.com:acme/api.git',
    })
  })

  it('never returns a credential from the remote', () => {
    mockExistsSync.mockReturnValue(true)
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/repo\n')
      if (cmd === 'git rev-parse --git-common-dir') return Buffer.from('.git\n')
      if (cmd === 'git remote get-url origin') return Buffer.from('https://me:ghp_secret@github.com/acme/api.git\n')
      throw new Error(`unexpected: ${cmd}`)
    })

    expect(probeDirectory('/repo')).toMatchObject({ remoteUrl: 'https://github.com/acme/api.git' })
  })
})
