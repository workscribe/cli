import { describe, it, expect, vi, beforeEach } from 'vitest'
import { assertNodeVersion, detectVersionManager } from '../src/utils/node-version'

const VERSION_MANAGER_ENV_VARS = [
  'NVM_DIR',
  'VOLTA_HOME',
  'FNM_DIR',
  'MISE_DATA_DIR',
  'MISE_SHELL',
  'ASDF_DIR',
  'ASDF_DATA_DIR',
  'NODENV_ROOT',
]

beforeEach(() => {
  vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  // Clear all version manager env vars so each test starts from a clean slate
  VERSION_MANAGER_ENV_VARS.forEach((key) => vi.stubEnv(key, ''))
})

// ─── assertNodeVersion ────────────────────────────────────────────────────────

describe('assertNodeVersion', () => {
  it('does nothing on Node 22', () => {
    assertNodeVersion('22.0.0')
    expect(process.exit).not.toHaveBeenCalled()
  })

  it('does nothing on Node 23', () => {
    assertNodeVersion('23.1.0')
    expect(process.exit).not.toHaveBeenCalled()
  })

  it('exits with code 1 on Node 20', () => {
    assertNodeVersion('20.11.0')
    expect(process.exit).toHaveBeenCalledWith(1)
  })

  it('exits with code 1 on Node 18', () => {
    assertNodeVersion('18.20.0')
    expect(process.exit).toHaveBeenCalledWith(1)
  })

  it('includes the actual version in the error message', () => {
    assertNodeVersion('18.20.0')
    const output = (process.stderr.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(output).toContain('v18.20.0')
  })

  it('mentions Node 22 as the minimum required version', () => {
    assertNodeVersion('20.0.0')
    const output = (process.stderr.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(output).toContain('Node.js 22 or later')
  })

  it('shows nodejs.org download link when no version manager is detected', () => {
    assertNodeVersion('20.0.0')
    const output = (process.stderr.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(output).toContain('https://nodejs.org')
  })

  it('shows nvm upgrade command when NVM_DIR is set', () => {
    vi.stubEnv('NVM_DIR', '/home/user/.nvm')
    assertNodeVersion('20.0.0')
    const output = (process.stderr.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(output).toContain('nvm install 22 && nvm use 22')
  })

  it('shows volta upgrade command when VOLTA_HOME is set', () => {
    vi.stubEnv('VOLTA_HOME', '/home/user/.volta')
    assertNodeVersion('20.0.0')
    const output = (process.stderr.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(output).toContain('volta install node@22')
  })

  it('shows fnm upgrade command when FNM_DIR is set', () => {
    vi.stubEnv('FNM_DIR', '/home/user/.fnm')
    assertNodeVersion('20.0.0')
    const output = (process.stderr.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(output).toContain('fnm install 22 && fnm use 22')
  })

  it('shows mise upgrade command when MISE_DATA_DIR is set', () => {
    vi.stubEnv('MISE_DATA_DIR', '/home/user/.local/share/mise')
    assertNodeVersion('20.0.0')
    const output = (process.stderr.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(output).toContain('mise use --global node@22')
  })

  it('shows mise upgrade command when MISE_SHELL is set', () => {
    vi.stubEnv('MISE_SHELL', 'zsh')
    assertNodeVersion('20.0.0')
    const output = (process.stderr.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(output).toContain('mise use --global node@22')
  })

  it('shows asdf upgrade command when ASDF_DIR is set', () => {
    vi.stubEnv('ASDF_DIR', '/home/user/.asdf')
    assertNodeVersion('20.0.0')
    const output = (process.stderr.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(output).toContain('asdf install nodejs 22 && asdf global nodejs 22')
  })

  it('shows asdf upgrade command when ASDF_DATA_DIR is set', () => {
    vi.stubEnv('ASDF_DATA_DIR', '/home/user/.asdf')
    assertNodeVersion('20.0.0')
    const output = (process.stderr.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(output).toContain('asdf install nodejs 22 && asdf global nodejs 22')
  })

  it('shows nodenv upgrade command when NODENV_ROOT is set', () => {
    vi.stubEnv('NODENV_ROOT', '/home/user/.nodenv')
    assertNodeVersion('20.0.0')
    const output = (process.stderr.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(output).toContain('nodenv install 22 && nodenv global 22')
  })
})

// ─── detectVersionManager ─────────────────────────────────────────────────────

describe('detectVersionManager', () => {
  it('returns null when no version manager env vars are set', () => {
    expect(detectVersionManager()).toBeNull()
  })

  it('detects nvm via NVM_DIR', () => {
    vi.stubEnv('NVM_DIR', '/home/user/.nvm')
    expect(detectVersionManager()).toBe('nvm')
  })

  it('detects volta via VOLTA_HOME', () => {
    vi.stubEnv('VOLTA_HOME', '/home/user/.volta')
    expect(detectVersionManager()).toBe('volta')
  })

  it('detects fnm via FNM_DIR', () => {
    vi.stubEnv('FNM_DIR', '/home/user/.fnm')
    expect(detectVersionManager()).toBe('fnm')
  })

  it('detects mise via MISE_DATA_DIR', () => {
    vi.stubEnv('MISE_DATA_DIR', '/home/user/.local/share/mise')
    expect(detectVersionManager()).toBe('mise')
  })

  it('detects mise via MISE_SHELL', () => {
    vi.stubEnv('MISE_SHELL', 'zsh')
    expect(detectVersionManager()).toBe('mise')
  })

  it('detects asdf via ASDF_DIR', () => {
    vi.stubEnv('ASDF_DIR', '/home/user/.asdf')
    expect(detectVersionManager()).toBe('asdf')
  })

  it('detects asdf via ASDF_DATA_DIR', () => {
    vi.stubEnv('ASDF_DATA_DIR', '/home/user/.asdf')
    expect(detectVersionManager()).toBe('asdf')
  })

  it('detects nodenv via NODENV_ROOT', () => {
    vi.stubEnv('NODENV_ROOT', '/home/user/.nodenv')
    expect(detectVersionManager()).toBe('nodenv')
  })

  it('gives nvm priority when multiple env vars are set', () => {
    vi.stubEnv('NVM_DIR', '/home/user/.nvm')
    vi.stubEnv('VOLTA_HOME', '/home/user/.volta')
    expect(detectVersionManager()).toBe('nvm')
  })
})
