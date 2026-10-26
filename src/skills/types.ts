/** A coding agent Workscribe can install its skill into. */
export interface SkillAgent {
  id: string
  name: string
  /** Personal skills folder, relative to the home directory. Several agents can share one. */
  skillsFolder: string
  /** Commands on PATH that indicate the agent is installed. */
  commands: string[]
  /** Folders under home that indicate the agent is installed. */
  homeFolders: string[]
  /** Folder-name prefixes under ~/.vscode/extensions that indicate the agent (VS Code extensions). */
  vscodeExtensionPrefixes: string[]
  /** Where the agent documents its skills folder — check here if it ever moves. */
  docsUrl: string
}

/** Written next to an installed skill so Workscribe knows the copy is its own, and which version. */
export interface SkillMarker {
  version: string
  installedAt: string
}

export type SkillInstallState =
  | { kind: 'not-installed' }
  | { kind: 'installed'; version: string }
  | { kind: 'outdated'; version: string }
  | { kind: 'not-ours' }

export interface InstallSkillOptions {
  /** The packaged `skills/workscribe/` folder to copy from. */
  sourceDir: string
  /** The agent's skills folder, e.g. `~/.claude/skills` — the skill goes in `<skillsFolder>/workscribe`. */
  skillsFolder: string
  version: string
  /** Replace a `workscribe` folder that Workscribe didn't install. */
  force?: boolean
}

export type InstallOutcome = 'installed' | 'updated' | 'up-to-date' | 'skipped-not-ours'

export type UninstallOutcome = 'removed' | 'not-installed' | 'skipped-not-ours'

/** Agents that share one skills folder get one copy of the skill. */
export interface SkillsFolderGroup {
  skillsFolder: string
  agents: SkillAgent[]
}
