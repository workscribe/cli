import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock child_process and fs before importing the module
vi.mock('child_process', () => ({ execSync: vi.fn() }))
vi.mock('fs', () => ({ default: { readFileSync: vi.fn() } }))

import { execSync } from 'child_process'
import fs from 'fs'
import { getGitContext } from '../../src/capture/git'

const mockExecSync = execSync as ReturnType<typeof vi.fn>
const mockReadFileSync = fs.readFileSync as ReturnType<typeof vi.fn>

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

describe('getGitContext — nameOverride', () => {
  it('nameOverride always wins over remote and package.json', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/root\n')
      if (cmd === 'git branch --show-current') return Buffer.from('main\n')
      if (cmd === 'git remote get-url origin') return Buffer.from('https://github.com/org/remote-name.git\n')
      throw new Error(`unexpected: ${cmd}`)
    })
    const { repoName } = getGitContext('/root', 'my-override')
    expect(repoName).toBe('my-override')
  })
})

describe('getGitContext — remote URL', () => {
  it('extracts repo name from HTTPS URL with .git suffix', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/home/user/chronicle\n')
      if (cmd === 'git branch --show-current') return Buffer.from('main\n')
      if (cmd === 'git remote get-url origin') return Buffer.from('https://github.com/org/workscribe.git\n')
      throw new Error(`unexpected: ${cmd}`)
    })
    const { repoName } = getGitContext('/home/user/chronicle')
    expect(repoName).toBe('workscribe')
  })

  it('extracts repo name from HTTPS URL without .git suffix', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/home/user/chronicle\n')
      if (cmd === 'git branch --show-current') return Buffer.from('main\n')
      if (cmd === 'git remote get-url origin') return Buffer.from('https://gitlab.com/org/workscribe\n')
      throw new Error(`unexpected: ${cmd}`)
    })
    const { repoName } = getGitContext('/home/user/chronicle')
    expect(repoName).toBe('workscribe')
  })

  it('extracts repo name from SSH remote URL', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/home/user/chronicle\n')
      if (cmd === 'git branch --show-current') return Buffer.from('main\n')
      if (cmd === 'git remote get-url origin') return Buffer.from('git@github.com:org/workscribe.git\n')
      throw new Error(`unexpected: ${cmd}`)
    })
    const { repoName } = getGitContext('/home/user/chronicle')
    expect(repoName).toBe('workscribe')
  })
})

describe('getGitContext — qualifyRepoName', () => {
  it('returns bare repo name by default (qualifyRepoName not passed)', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/home/user/vscode\n')
      if (cmd === 'git branch --show-current') return Buffer.from('main\n')
      if (cmd === 'git remote get-url origin') return Buffer.from('https://github.com/workscribe/vscode.git\n')
      throw new Error(`unexpected: ${cmd}`)
    })
    const { repoName } = getGitContext('/home/user/vscode')
    expect(repoName).toBe('vscode')
  })

  it('returns owner/repo when qualifyRepoName is true (HTTPS remote)', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/home/user/vscode\n')
      if (cmd === 'git branch --show-current') return Buffer.from('main\n')
      if (cmd === 'git remote get-url origin') return Buffer.from('https://github.com/workscribe/vscode.git\n')
      throw new Error(`unexpected: ${cmd}`)
    })
    const { repoName } = getGitContext('/home/user/vscode', null, true)
    expect(repoName).toBe('workscribe/vscode')
  })

  it('returns owner/repo when qualifyRepoName is true (SSH remote)', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/home/user/vscode\n')
      if (cmd === 'git branch --show-current') return Buffer.from('main\n')
      if (cmd === 'git remote get-url origin') return Buffer.from('git@github.com:workscribe/vscode.git\n')
      throw new Error(`unexpected: ${cmd}`)
    })
    const { repoName } = getGitContext('/home/user/vscode', null, true)
    expect(repoName).toBe('workscribe/vscode')
  })

  it('nameOverride still wins over qualifyRepoName', () => {
    mockExecSync.mockImplementation((cmd: string) => {
      if (cmd === 'git rev-parse --show-toplevel') return Buffer.from('/home/user/vscode\n')
      if (cmd === 'git branch --show-current') return Buffer.from('main\n')
      if (cmd === 'git remote get-url origin') return Buffer.from('https://github.com/workscribe/vscode.git\n')
      throw new Error(`unexpected: ${cmd}`)
    })
    const { repoName } = getGitContext('/home/user/vscode', 'my-override', true)
    expect(repoName).toBe('my-override')
  })
})

describe('getGitContext — package.json fallback', () => {
  it('uses package.json name when remote fails', () => {
    setupGitRoot('/home/user/chronicle')
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: 'workscribe' }))
    const { repoName } = getGitContext('/home/user/chronicle')
    expect(repoName).toBe('workscribe')
  })

  it('strips @scope/ prefix from scoped package name', () => {
    setupGitRoot('/home/user/chronicle')
    mockReadFileSync.mockReturnValue(JSON.stringify({ name: '@workscribe/cli' }))
    const { repoName } = getGitContext('/home/user/chronicle')
    expect(repoName).toBe('cli')
  })

  it('falls back to folder name when package.json has no name field', () => {
    setupGitRoot('/home/user/chronicle')
    mockReadFileSync.mockReturnValue(JSON.stringify({}))
    const { repoName } = getGitContext('/home/user/chronicle')
    expect(repoName).toBe('chronicle')
  })
})

describe('getGitContext — folder name fallback', () => {
  it('uses folder name when remote and package.json both fail', () => {
    setupGitRoot('/home/user/chronicle')
    // readFileSync already throws by default from beforeEach
    const { repoName } = getGitContext('/home/user/chronicle')
    expect(repoName).toBe('chronicle')
  })
})
