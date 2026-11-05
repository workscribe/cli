import { describe, it, expect, vi } from 'vitest'

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    copyFileSync: vi.fn(),
    appendFileSync: vi.fn(),
    constants: { COPYFILE_EXCL: 1 },
  },
}))

vi.mock('child_process', () => ({
  execFileSync: vi.fn(),
}))

import fs from 'fs'
import { execFileSync } from 'child_process'
import {
  getInstalledHookBlock,
  isHookInstalled,
  isHookOutdated,
  installHook,
  updateHook,
  removeHook,
  resolveWorkscribeBinary,
  injectBinaryPath,
  SHELL_HOOK_VERSIONS,
  findChronicleHook,
  hookBlockOf,
  installedHookVersion,
  removeChronicleHook,
  shellHookHealth,
} from '../../src/capture/shell-hook'

const mockFs = fs as unknown as Record<string, ReturnType<typeof vi.fn>>

const HOOK_BLOCK = `# workscribe:hook:start
_workscribe_preexec() { echo "hook"; }
# workscribe:hook:end`

const RC_WITH_HOOK = `# other config\n${HOOK_BLOCK}\n# more config`
const RC_WITHOUT_HOOK = `# just some zsh config\nexport PATH="$HOME/bin:$PATH"`

describe('getInstalledHookBlock', () => {
  it('returns null when file does not exist', () => {
    mockFs.existsSync.mockReturnValue(false)
    expect(getInstalledHookBlock('/home/user/.zshrc')).toBeNull()
  })

  it('returns null when hook markers are not present', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(RC_WITHOUT_HOOK)
    expect(getInstalledHookBlock('/home/user/.zshrc')).toBeNull()
  })

  it('returns the hook block when markers are present', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(RC_WITH_HOOK)
    const result = getInstalledHookBlock('/home/user/.zshrc')
    expect(result).toBe(HOOK_BLOCK)
  })

  it('preserves content between start and end markers exactly', () => {
    const rc = `before\n${HOOK_BLOCK}\nafter`
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(rc)
    const result = getInstalledHookBlock('/home/user/.zshrc')
    expect(result).toContain('# workscribe:hook:start')
    expect(result).toContain('# workscribe:hook:end')
    expect(result).not.toContain('before')
    expect(result).not.toContain('after')
  })
})

describe('isHookInstalled', () => {
  it('returns false when file does not exist', () => {
    mockFs.existsSync.mockReturnValue(false)
    expect(isHookInstalled('/home/user/.zshrc')).toBe(false)
  })

  it('returns false when markers are absent', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(RC_WITHOUT_HOOK)
    expect(isHookInstalled('/home/user/.zshrc')).toBe(false)
  })

  it('returns true when markers are present', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(RC_WITH_HOOK)
    expect(isHookInstalled('/home/user/.zshrc')).toBe(true)
  })
})

describe('isHookOutdated', () => {
  it('returns false when hook is not installed', () => {
    mockFs.existsSync.mockReturnValue(false)
    expect(isHookOutdated('/home/user/.zshrc', HOOK_BLOCK)).toBe(false)
  })

  it('returns false when installed hook matches current template', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(RC_WITH_HOOK)
    expect(isHookOutdated('/home/user/.zshrc', HOOK_BLOCK)).toBe(false)
  })

  it('returns true when installed hook differs from current template', () => {
    const oldHook = `# workscribe:hook:start\n_old_hook() { echo "old"; }\n# workscribe:hook:end`
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(`prefix\n${oldHook}\nsuffix`)
    expect(isHookOutdated('/home/user/.zshrc', HOOK_BLOCK)).toBe(true)
  })

  it('ignores leading/trailing whitespace in comparison', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(`\n${HOOK_BLOCK}\n`)
    expect(isHookOutdated('/home/user/.zshrc', `  ${HOOK_BLOCK}  `)).toBe(false)
  })
})

describe('installHook', () => {
  it('backs up the rc file before installing', () => {
    mockFs.readFileSync.mockReturnValue(RC_WITHOUT_HOOK)
    installHook('/home/user/.zshrc', HOOK_BLOCK)
    expect(mockFs.copyFileSync).toHaveBeenCalledWith(
      '/home/user/.zshrc',
      expect.stringContaining('.zshrc.workscribe-backup-'),
      1
    )
  })

  it('appends hook content to the rc file', () => {
    mockFs.readFileSync.mockReturnValue(RC_WITHOUT_HOOK)
    installHook('/home/user/.zshrc', HOOK_BLOCK)
    expect(mockFs.appendFileSync).toHaveBeenCalledWith('/home/user/.zshrc', expect.stringContaining(HOOK_BLOCK))
  })
})

describe('updateHook', () => {
  it('backs up the rc file before updating', () => {
    const rc = `before\n${HOOK_BLOCK}\nafter`
    mockFs.readFileSync.mockReturnValue(rc)
    updateHook('/home/user/.zshrc', HOOK_BLOCK)
    expect(mockFs.copyFileSync).toHaveBeenCalledWith(
      '/home/user/.zshrc',
      expect.stringContaining('.zshrc.workscribe-backup-'),
      1
    )
  })

  it('replaces only the hook block, preserving surrounding content', () => {
    const newHook = `# workscribe:hook:start\n_new_hook() { echo "new"; }\n# workscribe:hook:end`
    const rc = `before\n${HOOK_BLOCK}\nafter`
    mockFs.readFileSync.mockReturnValue(rc)
    updateHook('/home/user/.zshrc', newHook)
    const written = mockFs.writeFileSync.mock.calls[0][1] as string
    expect(written).toContain('before')
    expect(written).toContain('after')
    expect(written).toContain('_new_hook')
    expect(written).not.toContain('_workscribe_preexec')
  })

  it('does not duplicate the hook block', () => {
    const rc = `before\n${HOOK_BLOCK}\nafter`
    mockFs.readFileSync.mockReturnValue(rc)
    updateHook('/home/user/.zshrc', HOOK_BLOCK)
    const written = mockFs.writeFileSync.mock.calls[0][1] as string
    const count = (written.match(/workscribe:hook:start/g) ?? []).length
    expect(count).toBe(1)
  })
})

describe('removeHook', () => {
  it('backs up the rc file before removing', () => {
    const rc = `before\n${HOOK_BLOCK}\nafter`
    mockFs.readFileSync.mockReturnValue(rc)
    removeHook('/home/user/.zshrc')
    expect(mockFs.copyFileSync).toHaveBeenCalledWith(
      '/home/user/.zshrc',
      expect.stringContaining('.zshrc.workscribe-backup-'),
      1
    )
  })

  it('removes the hook block entirely', () => {
    const rc = `before\n${HOOK_BLOCK}\nafter`
    mockFs.readFileSync.mockReturnValue(rc)
    removeHook('/home/user/.zshrc')
    const written = mockFs.writeFileSync.mock.calls[0][1] as string
    expect(written).not.toContain('workscribe:hook:start')
    expect(written).not.toContain('workscribe:hook:end')
  })

  it('preserves content before and after the hook block', () => {
    const rc = `before\n${HOOK_BLOCK}\nafter`
    mockFs.readFileSync.mockReturnValue(rc)
    removeHook('/home/user/.zshrc')
    const written = mockFs.writeFileSync.mock.calls[0][1] as string
    expect(written).toContain('before')
    expect(written).toContain('after')
  })

  it('does not leave extra blank lines where the hook was', () => {
    const rc = `line one\n\n${HOOK_BLOCK}\nline two`
    mockFs.readFileSync.mockReturnValue(rc)
    removeHook('/home/user/.zshrc')
    const written = mockFs.writeFileSync.mock.calls[0][1] as string
    expect(written).not.toMatch(/\n{3,}/)
  })

  it('also removes the preamble comment lines written by installHook', () => {
    const withPreamble =
      `# existing config\n` +
      `# Workscribe — developer work journal\n` +
      `# Do not edit this block manually. Managed by \`workscribe init\`.\n` +
      `${HOOK_BLOCK}\n` +
      `# after`
    mockFs.readFileSync.mockReturnValue(withPreamble)
    removeHook('/home/user/.zshrc')
    const written = mockFs.writeFileSync.mock.calls[0][1] as string
    expect(written).not.toContain('Workscribe — developer work journal')
    expect(written).not.toContain('Do not edit this block manually')
    expect(written).toContain('# existing config')
    expect(written).toContain('# after')
  })
})

const mockChildProcess = execFileSync as unknown as ReturnType<typeof vi.fn>

describe('resolveWorkscribeBinary', () => {
  it('returns the trimmed path when which succeeds', () => {
    mockChildProcess.mockReturnValue('/usr/local/bin/workscribe\n')
    expect(resolveWorkscribeBinary()).toBe('/usr/local/bin/workscribe')
  })

  it('returns null when which returns an empty string', () => {
    mockChildProcess.mockReturnValue('')
    expect(resolveWorkscribeBinary()).toBeNull()
  })

  it('returns null when which throws', () => {
    mockChildProcess.mockImplementation(() => {
      throw new Error('not found')
    })
    expect(resolveWorkscribeBinary()).toBeNull()
  })
})

describe('injectBinaryPath', () => {
  const BIN = '/home/user/.nvm/versions/node/v22.0.0/bin/workscribe'
  const NODE = '/home/user/.nvm/versions/node/v22.0.0/bin/node'

  const ZSH_HOOK = `# workscribe:hook:start
_workscribe_preexec() {
  _workscribe_cmd_start=$EPOCHREALTIME
}

_workscribe_precmd() {
  local exit_code=$?
  command -v workscribe > /dev/null 2>&1 || return 0
  command workscribe _capture \\
    --cmd "$_workscribe_cmd" \\
    > /dev/null 2>&1 &!
}
# workscribe:hook:end`

  const BASH_HOOK = `# workscribe:hook:start
_workscribe_precmd() {
  local exit_code=$?
  command -v workscribe &>/dev/null || return 0
  command workscribe _capture \\
    --cmd "$_workscribe_last_cmd" \\
    > /dev/null 2>&1 &
}
# workscribe:hook:end`

  const FISH_HOOK = `# workscribe:hook:start
function _workscribe_postexec --on-event fish_postexec
    set -l exit_code $status
    type -q workscribe
    or return 0
    if set -q _workscribe_cmd
        command workscribe _capture \\
            --cmd "$_workscribe_cmd" \\
            > /dev/null 2>&1 &
    else
        command workscribe _capture \\
            --cmd "$_workscribe_cmd" \\
            > /dev/null 2>&1 &
    end
end
# workscribe:hook:end`

  it('replaces zsh availability check with absolute path test', () => {
    const result = injectBinaryPath(ZSH_HOOK, BIN, NODE)
    expect(result).not.toContain('command -v workscribe')
    expect(result).toContain(`[[ -x "${BIN}" ]] || return 0`)
  })

  it('replaces zsh invocation with pinned node and binary path', () => {
    const result = injectBinaryPath(ZSH_HOOK, BIN, NODE)
    expect(result).not.toContain('command workscribe _capture')
    expect(result).toContain(`"${NODE}" --disable-warning=ExperimentalWarning "${BIN}" _capture`)
  })

  it('replaces bash availability check with absolute path test', () => {
    const result = injectBinaryPath(BASH_HOOK, BIN, NODE)
    expect(result).not.toContain('command -v workscribe')
    expect(result).toContain(`[[ -x "${BIN}" ]] || return 0`)
  })

  it('replaces bash invocation with pinned node and binary path', () => {
    const result = injectBinaryPath(BASH_HOOK, BIN, NODE)
    expect(result).not.toContain('command workscribe _capture')
    expect(result).toContain(`"${NODE}" --disable-warning=ExperimentalWarning "${BIN}" _capture`)
  })

  it('replaces fish availability check with absolute path test', () => {
    const result = injectBinaryPath(FISH_HOOK, BIN, NODE)
    expect(result).not.toContain('type -q workscribe')
    expect(result).toContain(`test -x "${BIN}"`)
  })

  it('replaces all fish invocations with pinned node and binary path', () => {
    const result = injectBinaryPath(FISH_HOOK, BIN, NODE)
    expect(result).not.toContain('command workscribe _capture')
    const escapedNode = NODE.replace(/\//g, '\\/')
    const escapedBin = BIN.replace(/\//g, '\\/')
    const count = (
      result.match(
        new RegExp(`"${escapedNode}"\\ --disable-warning=ExperimentalWarning\\ "${escapedBin}"\\ _capture`, 'g')
      ) ?? []
    ).length
    expect(count).toBe(2)
  })

  it('leaves hook content unchanged when no matching patterns are present', () => {
    const unrecognised = `# workscribe:hook:start\n_some_other_hook() {}\n# workscribe:hook:end`
    expect(injectBinaryPath(unrecognised, BIN, NODE)).toBe(unrecognised)
  })
})

// fs is mocked above, so the real templates are read through the actual module
const realFs = await vi.importActual<typeof import('fs')>('fs')
const template = (shell: string) => realFs.readFileSync(new URL(`../../shell/hook.${shell}`, import.meta.url), 'utf-8')
const ZSH_TEMPLATE = template('zsh')
const PREAMBLE =
  '# Workscribe — developer work journal\n# Do not edit this block manually. Managed by `workscribe init`.'
const CHRONICLE_BLOCK = [
  '# Chronicle — developer work journal',
  '# Do not edit this block manually. Managed by `chronicle init`.',
  '# chronicle:hook:start',
  '_chronicle_precmd() { local duration_ms=$(( int(1) )); }',
  '# chronicle:hook:end',
].join('\n')

describe('the real hook templates (WOR-153)', () => {
  it.each(['zsh', 'bash', 'fish'])('%s: the version it declares is SHELL_HOOK_VERSIONS', (shell) => {
    expect(installedHookVersion(hookBlockOf(template(shell)))).toBe(SHELL_HOOK_VERSIONS[shell])
  })

  it('is not outdated when the installed hook is the template itself, header and all', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(`# mine\n${ZSH_TEMPLATE}\n# more`)

    expect(isHookOutdated('/home/user/.zshrc', ZSH_TEMPLATE)).toBe(false)
  })

  it('is outdated when the binary path or the version changed', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(ZSH_TEMPLATE)

    expect(isHookOutdated('/home/user/.zshrc', injectBinaryPath(ZSH_TEMPLATE, '/bin/ws', '/bin/node'))).toBe(true)
    expect(isHookOutdated('/home/user/.zshrc', ZSH_TEMPLATE.replace('hook-version 2', 'hook-version 3'))).toBe(true)
  })

  it('updating an rc with 11 stacked headers leaves exactly one, and the rest of the file as it was', () => {
    const stacked = Array.from({ length: 11 }, () => PREAMBLE).join('\n')
    const oldBlock = '# workscribe:hook:start\n_old() { :; }\n# workscribe:hook:end'
    mockFs.readFileSync.mockReturnValue(`export A=1\n\n${stacked}\n${oldBlock}\n\nexport B=2\n`)

    updateHook('/home/user/.zshrc', ZSH_TEMPLATE)

    const written = mockFs.writeFileSync.mock.calls[0][1] as string
    expect(written.match(/developer work journal/g)).toHaveLength(1)
    expect(written).toBe(`export A=1\n\n${ZSH_TEMPLATE.trimEnd()}\n\nexport B=2\n`)
  })

  it('removing the hook removes every stacked header too', () => {
    mockFs.readFileSync.mockReturnValue(`export A=1\n${PREAMBLE}\n${PREAMBLE}\n${HOOK_BLOCK}\nexport B=2`)

    removeHook('/home/user/.zshrc')

    expect(mockFs.writeFileSync.mock.calls[0][1]).toBe('export A=1\nexport B=2')
  })

  it('reads a block without a version line as version 1', () => {
    expect(installedHookVersion(HOOK_BLOCK)).toBe(1)
  })
})

describe('a leftover Chronicle hook (WOR-153)', () => {
  const rc = `export A=1\n\n${CHRONICLE_BLOCK}\n\n${ZSH_TEMPLATE}`

  it('is found with its header lines', () => {
    const region = findChronicleHook(rc)

    expect(region && rc.slice(region.start, region.end)).toBe(CHRONICLE_BLOCK)
    expect(findChronicleHook(ZSH_TEMPLATE)).toBeNull()
  })

  it('is removed after a backup, leaving the Workscribe hook and everything else', () => {
    mockFs.readFileSync.mockReturnValue(rc)

    expect(removeChronicleHook('/home/user/.zshrc')).toBe(true)

    expect(mockFs.copyFileSync).toHaveBeenCalled()
    expect(mockFs.writeFileSync.mock.calls[0][1]).toBe(`export A=1\n\n${ZSH_TEMPLATE}`)
  })

  it('is left alone, with no backup, when there is none', () => {
    mockFs.readFileSync.mockReturnValue(ZSH_TEMPLATE)

    expect(removeChronicleHook('/home/user/.zshrc')).toBe(false)
    expect(mockFs.copyFileSync).not.toHaveBeenCalled()
  })
})

describe('shellHookHealth', () => {
  it('flags a zsh hook from before versions as outdated, and a Chronicle hook beside it', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(`${CHRONICLE_BLOCK}\n${HOOK_BLOCK}`)

    expect(shellHookHealth({ name: 'zsh', rcFile: '/home/user/.zshrc' })).toEqual({
      isOutdated: true,
      hasChronicleHook: true,
    })
  })

  it('flags nothing for the current template, nor for fish, whose hook has not changed', () => {
    mockFs.existsSync.mockReturnValue(true)
    mockFs.readFileSync.mockReturnValue(ZSH_TEMPLATE)
    expect(shellHookHealth({ name: 'zsh', rcFile: '/home/user/.zshrc' }).isOutdated).toBe(false)

    mockFs.readFileSync.mockReturnValue(template('fish'))
    expect(shellHookHealth({ name: 'fish', rcFile: '/home/user/workscribe.fish' }).isOutdated).toBe(false)
  })

  it('flags nothing when the hook is not installed', () => {
    mockFs.existsSync.mockReturnValue(false)
    mockFs.readFileSync.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    expect(shellHookHealth({ name: 'zsh', rcFile: '/home/user/.zshrc' })).toEqual({
      isOutdated: false,
      hasChronicleHook: false,
    })
  })
})
