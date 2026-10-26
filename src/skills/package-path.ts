import fs from 'fs'
import path from 'path'
import { SKILL_NAME } from './agents'

const SKILL_ENTRY_FILE = 'SKILL.md'

/**
 * Where the skill shipped in this npm package lives. The bundle runs from `dist/`, so it's one level
 * up; the TypeScript sources run from `src/<folder>/`, so it's two. The first with a SKILL.md wins.
 */
export function packagedSkillCandidates(fromDirectory: string): string[] {
  return [
    path.join(fromDirectory, '..', 'skills', SKILL_NAME),
    path.join(fromDirectory, '..', '..', 'skills', SKILL_NAME),
  ]
}

export function resolvePackagedSkillDir(fromDirectory: string = __dirname): string {
  const found = packagedSkillCandidates(fromDirectory).find((candidate) =>
    fs.existsSync(path.join(candidate, SKILL_ENTRY_FILE))
  )
  if (!found) {
    throw new Error(
      'The Workscribe skill files are missing from this install. Reinstall it: npm install -g @workscribe/cli'
    )
  }
  return found
}
