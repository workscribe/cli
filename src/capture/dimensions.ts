import fs from 'fs'
import path from 'path'
import { getRepoContext, type RepoContext, type RepoNamingConfig } from './git'
import { FILE_SAVE_ACTION, type EventDimensions, type ProjectRecord } from '../db/dimensions'
import { pathInsideRoot } from '../utils/working-directory'

function projectRecord(context: RepoContext): ProjectRecord | null {
  if (!context.project) return null
  return { ...context.project, name: context.repoName, root: context.root }
}

/** What an event links to, from the repo context capture already found for it. */
export function eventDimensions(context: RepoContext): EventDimensions {
  const project = projectRecord(context)
  return { project, branch: project === null ? null : context.branch, file: null }
}

/**
 * Whether a folder between the file and the root it was found under is a repo of its own — a nested repo or a
 * submodule, which owns the file instead. The root itself isn't checked.
 */
function isInNestedRepo(filePath: string, relativePath: string): boolean {
  const foldersBelowRoot = relativePath.split(path.sep).length - 1
  let folder = path.dirname(filePath)
  for (let level = 0; level < foldersBelowRoot; level++) {
    if (fs.existsSync(path.join(folder, '.git'))) return true
    folder = path.dirname(folder)
  }
  return false
}

/**
 * What a save links to. The project is the file's own repo, which may not be the folder the editor has open (a
 * workspace above several repos, or a nested repo or submodule inside the open one): git is asked again only then.
 * The branch is the open folder's, so it's only kept when the file is in that repo.
 */
export function fileEventDimensions(context: RepoContext, filePath: string, config: RepoNamingConfig): EventDimensions {
  const pathInWorkspaceRepo = context.root === null ? null : pathInsideRoot(filePath, context.root)
  if (pathInWorkspaceRepo !== null && context.project && !isInNestedRepo(filePath, pathInWorkspaceRepo)) {
    return { ...eventDimensions(context), file: { relativePath: pathInWorkspaceRepo, action: FILE_SAVE_ACTION } }
  }
  const fileContext = getRepoContext(path.dirname(filePath), config)
  const project = projectRecord(fileContext)
  if (project === null || fileContext.root === null) return eventDimensions(context)
  const relativePath = pathInsideRoot(filePath, fileContext.root)
  return {
    project,
    branch: null,
    file: relativePath === null ? null : { relativePath, action: FILE_SAVE_ACTION },
  }
}
