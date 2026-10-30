import type { DirectoryProbe } from '../../capture/git'
import { nameIdentity, projectIdentity, type ProjectIdentity } from '../../capture/project-identity'
import type { ProjectRecord } from '../dimensions'
import { relativeInside } from '../../utils/working-directory'

// Which project each stored (folder, name) pair belongs to. Pure: the backfill job feeds it the pairs it found and
// what git said about each folder, and stores the answer.

/** How a pair found its project. Everything but `git` and `none` is a fallback, and is recorded. */
export type ResolutionMethod = 'git' | 'folder' | 'qualified-name' | 'bare-name' | 'name' | 'none'

export const FALLBACK_METHODS: ResolutionMethod[] = ['folder', 'qualified-name', 'bare-name', 'name']

export interface ObservedPair {
  cwd: string
  repoName: string | null
}

export interface PairResolution extends ObservedPair {
  method: ResolutionMethod
  project: ProjectRecord | null
}

/** A project git found at a folder that still exists, with every root and bare name it was stored under. */
interface KnownProject extends ProjectIdentity {
  roots: Set<string>
  bareNames: Set<string>
}

function isQualified(name: string): boolean {
  return name.includes('/')
}

function gitProject(probe: DirectoryProbe | undefined): (ProjectIdentity & { root: string }) | null {
  if (probe?.outcome !== 'repo') return null
  const identity = projectIdentity(probe)
  return identity && { ...identity, root: probe.root }
}

/**
 * Whether a stored name could have come from this project's remote, as `repo` or `owner/repo`. A name that doesn't
 * is a `projects` override, or a `git -C ../other …` stored with the shell's folder but the other repo's name. A
 * project without a remote has nothing to check the name against.
 */
function nameFitsRemote(project: ProjectIdentity, name: string): boolean {
  return project.kind !== 'remote' || project.identity.endsWith(`/${name.toLowerCase()}`)
}

function knownProjects(pairs: ObservedPair[], probes: Map<string, DirectoryProbe>): KnownProject[] {
  const known = new Map<string, KnownProject>()
  for (const pair of pairs) {
    const found = gitProject(probes.get(pair.cwd))
    if (found === null || pair.repoName === null) continue
    const project = known.get(found.identity) ?? {
      identity: found.identity,
      kind: found.kind,
      roots: new Set<string>(),
      bareNames: new Set<string>(),
    }
    project.roots.add(found.root)
    const isBareFittingName = !isQualified(pair.repoName) && nameFitsRemote(found, pair.repoName)
    if (isBareFittingName) project.bareNames.add(pair.repoName.toLowerCase())
    known.set(found.identity, project)
  }
  return [...known.values()]
}

function singleOrNull<T>(candidates: T[]): T | null {
  return candidates.length === 1 ? candidates[0] : null
}

/** The project whose root holds the folder, the deepest root first. Null when two projects share that root. */
function byFolder(cwd: string, known: KnownProject[]): KnownProject | null {
  const holders = known.flatMap((project) =>
    [...project.roots]
      .filter((root) => relativeInside(root, cwd) !== null)
      .map((root) => ({ project, depth: root.length }))
  )
  const deepest = Math.max(...holders.map((holder) => holder.depth))
  return singleOrNull(holders.filter((holder) => holder.depth === deepest).map((holder) => holder.project))
}

type NamedPair = ObservedPair & { repoName: string }

function asFallback(pair: NamedPair, project: KnownProject | null, method: ResolutionMethod): PairResolution | null {
  if (project === null) return null
  return {
    ...pair,
    method,
    project: { identity: project.identity, kind: project.kind, name: pair.repoName, root: null },
  }
}

/** For `owner/repo`, the one live remote ending in it; for a bare `repo`, the one live project also stored as it. */
function byName(pair: NamedPair, known: KnownProject[]): PairResolution | null {
  const name = pair.repoName.toLowerCase()
  if (isQualified(name)) {
    const remotes = known.filter((project) => project.kind === 'remote' && project.identity.endsWith(`/${name}`))
    return asFallback(pair, singleOrNull(remotes), 'qualified-name')
  }
  const sameBareName = known.filter((project) => project.bareNames.has(name))
  return asFallback(pair, singleOrNull(sameBareName), 'bare-name')
}

/**
 * For a folder that's gone or no longer a repo, the one live project that fits, if any: the project whose checkout
 * holds the folder, else the one the name fits (`byName`). Two candidates are never guessed between.
 */
function byFallback(pair: NamedPair, known: KnownProject[]): PairResolution | null {
  return asFallback(pair, byFolder(pair.cwd, known), 'folder') ?? byName(pair, known)
}

/**
 * The folder's own repo — unless the stored name doesn't fit it and does fit exactly one other live project: then
 * the command worked in that other repo (`git -C`). A name that fits neither is kept as an override, but never as an
 * alias, so it can't rename the project or match other history to it.
 */
function byGit(pair: NamedPair, found: ProjectIdentity & { root: string }, known: KnownProject[]): PairResolution {
  const fits = nameFitsRemote(found, pair.repoName)
  const elsewhere = fits
    ? null
    : byName(
        pair,
        known.filter((project) => project.identity !== found.identity)
      )
  if (elsewhere !== null) return elsewhere
  const project = { identity: found.identity, kind: found.kind, name: fits ? pair.repoName : null, root: found.root }
  return { ...pair, method: 'git', project }
}

function resolvePair(pair: ObservedPair, probes: Map<string, DirectoryProbe>, known: KnownProject[]): PairResolution {
  // No name means the folder wasn't in a repo when the event was captured: those events stay unlinked
  if (pair.repoName === null) return { ...pair, method: 'none', project: null }
  // The same pair, with TypeScript told its name is set
  const named: NamedPair = { ...pair, repoName: pair.repoName }
  const found = gitProject(probes.get(pair.cwd))
  if (found !== null) return byGit(named, found, known)
  return (
    byFallback(named, known) ?? {
      ...pair,
      method: 'name',
      project: { ...nameIdentity(pair.repoName), name: pair.repoName, root: null },
    }
  )
}

/** A bare `x` left on its own joins the one name-only `owner/x`, when there's exactly one. */
function mergeBareNames(resolutions: PairResolution[]): PairResolution[] {
  const qualifiedByRepo = new Map<string, Set<string>>()
  for (const resolution of resolutions) {
    if (resolution.method !== 'name' || !resolution.repoName || !isQualified(resolution.repoName)) continue
    const repo = resolution.repoName.toLowerCase().split('/').at(-1) ?? ''
    qualifiedByRepo.set(repo, (qualifiedByRepo.get(repo) ?? new Set()).add(resolution.project?.identity ?? ''))
  }
  return resolutions.map((resolution) => {
    if (resolution.method !== 'name' || !resolution.repoName || isQualified(resolution.repoName)) return resolution
    const identities = [...(qualifiedByRepo.get(resolution.repoName.toLowerCase()) ?? [])]
    const identity = singleOrNull(identities)
    if (identity === null || resolution.project === null) return resolution
    return { ...resolution, project: { ...resolution.project, identity } }
  })
}

/**
 * Each pair's project, in order: what git says about the folder now; else a live project whose checkout holds the
 * folder; else the one live project the name fits (`owner/repo` by its remote, a bare `repo` by the bare names it
 * was stored under); else a project of its own, by name.
 */
export function resolvePairs(pairs: ObservedPair[], probes: Map<string, DirectoryProbe>): PairResolution[] {
  const known = knownProjects(pairs, probes)
  return mergeBareNames(pairs.map((pair) => resolvePair(pair, probes, known)))
}
