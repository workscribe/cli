import { describe, it, expect, vi } from 'vitest'
import { detectAgents, type DetectionEnvironment } from '../../src/skills/detect'

const HOME = '/Users/dev'

function machine(
  options: { folders?: string[]; commands?: string[]; extensions?: string[] } = {}
): DetectionEnvironment & { isCommandInstalled: ReturnType<typeof vi.fn> } {
  const folders = new Set((options.folders ?? []).map((folder) => `${HOME}/${folder}`))
  return {
    homeDir: HOME,
    isCommandInstalled: vi.fn((command: string) => (options.commands ?? []).includes(command)),
    pathExists: (absolutePath) => folders.has(absolutePath),
    listDirectory: (absolutePath) => (absolutePath === `${HOME}/.vscode/extensions` ? (options.extensions ?? []) : []),
  }
}

const ids = (environment: DetectionEnvironment) => detectAgents(environment).map((agent) => agent.id)

describe('detectAgents', () => {
  it('finds nothing on a machine without agents', () => {
    expect(ids(machine())).toEqual([])
  })

  it('detects agents by their home folder', () => {
    expect(ids(machine({ folders: ['.claude', '.codex', '.cursor'] }))).toEqual(['claude-code', 'codex', 'cursor'])
  })

  it('detects agents by their command on PATH', () => {
    expect(ids(machine({ commands: ['claude', 'cursor-agent'] }))).toEqual(['claude-code', 'cursor'])
  })

  it('detects Copilot by its VS Code extension', () => {
    expect(ids(machine({ extensions: ['github.copilot-chat-0.31.2', 'esbenp.prettier-vscode-11.0.0'] }))).toEqual([
      'copilot',
    ])
  })

  it('does not spawn `which` for an agent already found by its folder', () => {
    const environment = machine({ folders: ['.claude'] })

    detectAgents(environment)

    expect(environment.isCommandInstalled).not.toHaveBeenCalledWith('claude')
  })
})
