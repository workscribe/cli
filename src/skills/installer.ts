import fs from 'fs'
import path from 'path'
import { MARKER_FILE, SKILL_NAME } from './agents'
import { describeInstallState } from './state'
import type { InstallOutcome, InstallSkillOptions, SkillInstallState, SkillMarker, UninstallOutcome } from './types'

function isSkillMarker(value: unknown): value is SkillMarker {
  const candidate = value as Partial<SkillMarker> | null
  return typeof candidate?.version === 'string' && typeof candidate?.installedAt === 'string'
}

function readMarker(skillDir: string): SkillMarker | null {
  try {
    const parsed: unknown = JSON.parse(fs.readFileSync(path.join(skillDir, MARKER_FILE), 'utf-8'))
    return isSkillMarker(parsed) ? parsed : null
  } catch {
    return null // no marker, or not ours to read — either way it isn't a Workscribe install
  }
}

/** State of the Workscribe skill inside one agent skills folder (e.g. `~/.claude/skills`). */
export function readInstallState(skillsFolder: string, currentVersion: string): SkillInstallState {
  const skillDir = path.join(skillsFolder, SKILL_NAME)
  return describeInstallState({
    folderExists: fs.existsSync(skillDir),
    marker: readMarker(skillDir),
    currentVersion,
  })
}

function copyDirectory(from: string, to: string): void {
  fs.mkdirSync(to, { recursive: true })
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name)
    const destination = path.join(to, entry.name)
    if (entry.isDirectory()) copyDirectory(source, destination)
    else fs.copyFileSync(source, destination)
  }
}

/**
 * Swaps a fully prepared copy into place: move any existing copy aside, rename the new one in, then
 * delete the old one — or put it back if the rename fails. A plain rename over a non-empty folder
 * fails on POSIX, and this way an interrupted install never leaves a half-written skill.
 */
function swapInto(skillDir: string, preparedDir: string): void {
  const previousDir = path.join(path.dirname(skillDir), `.${SKILL_NAME}.old-${process.pid}`)
  fs.rmSync(previousDir, { recursive: true, force: true }) // left behind by a run that was killed
  const hadPrevious = fs.existsSync(skillDir)
  if (hadPrevious) fs.renameSync(skillDir, previousDir)
  try {
    fs.renameSync(preparedDir, skillDir)
  } catch (error) {
    if (hadPrevious) fs.renameSync(previousDir, skillDir)
    throw error
  }
  if (hadPrevious) fs.rmSync(previousDir, { recursive: true, force: true })
}

export function installSkill(options: InstallSkillOptions): InstallOutcome {
  const state = readInstallState(options.skillsFolder, options.version)
  if (state.kind === 'installed') return 'up-to-date'
  if (state.kind === 'not-ours' && !options.force) return 'skipped-not-ours'

  fs.mkdirSync(options.skillsFolder, { recursive: true })
  const preparedDir = path.join(options.skillsFolder, `.${SKILL_NAME}.tmp-${process.pid}`)
  fs.rmSync(preparedDir, { recursive: true, force: true }) // left behind by a run that was killed
  try {
    copyDirectory(options.sourceDir, preparedDir)
    const marker: SkillMarker = { version: options.version, installedAt: new Date().toISOString() }
    fs.writeFileSync(path.join(preparedDir, MARKER_FILE), JSON.stringify(marker, null, 2))
    swapInto(path.join(options.skillsFolder, SKILL_NAME), preparedDir)
  } finally {
    fs.rmSync(preparedDir, { recursive: true, force: true })
  }
  return state.kind === 'not-installed' ? 'installed' : 'updated'
}

/** Removes the skill only if Workscribe installed it — a user's own `workscribe` skill is left alone. */
export function uninstallSkill(skillsFolder: string): UninstallOutcome {
  const skillDir = path.join(skillsFolder, SKILL_NAME)
  if (!fs.existsSync(skillDir)) return 'not-installed'
  if (!readMarker(skillDir)) return 'skipped-not-ours'
  fs.rmSync(skillDir, { recursive: true, force: true })
  return 'removed'
}
