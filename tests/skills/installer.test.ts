import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { installSkill, readInstallState, uninstallSkill } from '../../src/skills/installer'
import { MARKER_FILE } from '../../src/skills/agents'
import { packagedSkillCandidates, resolvePackagedSkillDir } from '../../src/skills/package-path'

// Real files in a throwaway folder: the installer's job is moving folders around, so fakes would hide the risk.
let root: string
let sourceDir: string
let skillsFolder: string

function writeFile(filePath: string, content: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, content)
}

const installed = (file: string) => path.join(skillsFolder, 'workscribe', file)

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'workscribe-skill-'))
  sourceDir = path.join(root, 'package', 'skills', 'workscribe')
  writeFile(path.join(sourceDir, 'SKILL.md'), '---\nname: workscribe\n---\nv2')
  writeFile(path.join(sourceDir, 'references', 'summary-format.md'), '# format')
  skillsFolder = path.join(root, 'home', '.claude', 'skills')
})

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

describe('installSkill', () => {
  it('installs a fresh copy with its references and a marker, creating the skills folder', () => {
    expect(installSkill({ sourceDir, skillsFolder, version: '2.0.0' })).toBe('installed')

    expect(fs.readFileSync(installed('SKILL.md'), 'utf-8')).toContain('v2')
    expect(fs.existsSync(installed('references/summary-format.md'))).toBe(true)
    expect(JSON.parse(fs.readFileSync(installed(MARKER_FILE), 'utf-8')).version).toBe('2.0.0')
    expect(readInstallState(skillsFolder, '2.0.0')).toEqual({ kind: 'installed', version: '2.0.0' })
  })

  it('leaves an up-to-date copy alone', () => {
    installSkill({ sourceDir, skillsFolder, version: '2.0.0' })

    expect(installSkill({ sourceDir, skillsFolder, version: '2.0.0' })).toBe('up-to-date')
  })

  it('replaces an older copy, dropping files the new version no longer ships', () => {
    installSkill({ sourceDir, skillsFolder, version: '1.9.0' })
    writeFile(installed('obsolete.md'), 'old')

    expect(installSkill({ sourceDir, skillsFolder, version: '2.0.0' })).toBe('updated')
    expect(fs.existsSync(installed('obsolete.md'))).toBe(false)
    expect(readInstallState(skillsFolder, '2.0.0').kind).toBe('installed')
  })

  it("skips a workscribe skill it didn't install, and replaces it only with force", () => {
    writeFile(installed('SKILL.md'), 'my own skill')

    expect(installSkill({ sourceDir, skillsFolder, version: '2.0.0' })).toBe('skipped-not-ours')
    expect(fs.readFileSync(installed('SKILL.md'), 'utf-8')).toBe('my own skill')

    expect(installSkill({ sourceDir, skillsFolder, version: '2.0.0', force: true })).toBe('updated')
    expect(fs.readFileSync(installed('SKILL.md'), 'utf-8')).toContain('v2')
  })

  it('ignores temp and backup folders left behind by a run that was killed', () => {
    installSkill({ sourceDir, skillsFolder, version: '1.9.0' })
    writeFile(path.join(skillsFolder, `.workscribe.tmp-${process.pid}`, 'stale.md'), 'stale')
    writeFile(path.join(skillsFolder, `.workscribe.old-${process.pid}`, 'stale.md'), 'stale')

    expect(installSkill({ sourceDir, skillsFolder, version: '2.0.0' })).toBe('updated')
    expect(fs.existsSync(installed('stale.md'))).toBe(false)
    expect(fs.readdirSync(skillsFolder)).toEqual(['workscribe'])
  })

  it('restores the previous copy if swapping the new one in fails, and leaves no temp folders', () => {
    installSkill({ sourceDir, skillsFolder, version: '1.9.0' })
    const realRename = fs.renameSync
    const renameSpy = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
      if (String(from).includes('.workscribe.tmp-')) throw new Error('EXDEV: simulated failure')
      return realRename(from, to)
    })

    expect(() => installSkill({ sourceDir, skillsFolder, version: '2.0.0' })).toThrow('simulated failure')
    renameSpy.mockRestore()

    expect(readInstallState(skillsFolder, '1.9.0')).toEqual({ kind: 'installed', version: '1.9.0' })
    expect(fs.readdirSync(skillsFolder)).toEqual(['workscribe'])
  })
})

describe('uninstallSkill', () => {
  it('removes a copy Workscribe installed', () => {
    installSkill({ sourceDir, skillsFolder, version: '2.0.0' })

    expect(uninstallSkill(skillsFolder)).toBe('removed')
    expect(fs.existsSync(path.join(skillsFolder, 'workscribe'))).toBe(false)
  })

  it("never removes a workscribe skill it didn't install", () => {
    writeFile(installed('SKILL.md'), 'my own skill')

    expect(uninstallSkill(skillsFolder)).toBe('skipped-not-ours')
    expect(fs.existsSync(installed('SKILL.md'))).toBe(true)
  })

  it('reports when nothing is installed', () => {
    expect(uninstallSkill(skillsFolder)).toBe('not-installed')
  })
})

describe('resolvePackagedSkillDir', () => {
  it('finds the skill from the bundle (dist/) and from the sources (src/<folder>/)', () => {
    const packageRoot = path.join(root, 'package')

    expect(resolvePackagedSkillDir(path.join(packageRoot, 'dist'))).toBe(sourceDir)
    expect(resolvePackagedSkillDir(path.join(packageRoot, 'src', 'skills'))).toBe(sourceDir)
  })

  it('explains how to fix a broken install when the skill files are missing', () => {
    expect(() => resolvePackagedSkillDir(path.join(root, 'elsewhere', 'dist'))).toThrow(
      'npm install -g @workscribe/cli'
    )
  })

  it('checks the bundle location before the source location', () => {
    expect(packagedSkillCandidates('/pkg/dist')).toEqual(['/pkg/skills/workscribe', '/skills/workscribe'])
  })
})
