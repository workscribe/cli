import type { SkillAgent } from './types'

/** Folder name the skill is installed under, inside each agent's skills folder. */
export const SKILL_NAME = 'workscribe'

/** Marker file that identifies a Workscribe-installed copy of the skill. */
export const MARKER_FILE = '.workscribe-skill.json'

// Skills folders checked against each vendor's docs (2026-10-26). If a vendor moves its folder,
// only this table needs to change.
export const SKILL_AGENTS: SkillAgent[] = [
  {
    id: 'claude-code',
    name: 'Claude Code',
    skillsFolder: '.claude/skills',
    commands: ['claude'],
    homeFolders: ['.claude'],
    vscodeExtensionPrefixes: [],
    docsUrl: 'https://code.claude.com/docs/en/skills',
  },
  {
    id: 'codex',
    name: 'Codex',
    skillsFolder: '.agents/skills',
    commands: ['codex'],
    homeFolders: ['.codex'],
    vscodeExtensionPrefixes: [],
    docsUrl: 'https://learn.chatgpt.com/docs/build-skills',
  },
  {
    id: 'copilot',
    name: 'GitHub Copilot',
    skillsFolder: '.agents/skills',
    commands: ['copilot'],
    homeFolders: ['.copilot'],
    vscodeExtensionPrefixes: ['github.copilot-chat'],
    docsUrl: 'https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills',
  },
  {
    id: 'cursor',
    name: 'Cursor',
    skillsFolder: '.cursor/skills',
    commands: ['cursor', 'cursor-agent'],
    homeFolders: ['.cursor'],
    vscodeExtensionPrefixes: [],
    docsUrl: 'https://cursor.com/docs/skills',
  },
]

export const SKILL_AGENT_IDS = SKILL_AGENTS.map((agent) => agent.id)
