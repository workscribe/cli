import path from 'path'

// Where Workscribe keeps its data, config and state (pure). Installs from before the XDG layout keep everything in
// ~/.workscribe; fresh ones follow the XDG Base Directory spec. ~/.workscribe exists in both — the alerts file lives
// there so shell hooks can find it — so a legacy install is known by its data, never by the folder.

const LEGACY_DIR_NAME = '.workscribe'
const APP_DIR_NAME = 'workscribe'
/** A legacy install has one of these in ~/.workscribe; an XDG install never writes them there. */
const LEGACY_MARKERS = ['workscribe.db', 'config.json']

export interface DataDirsInput {
  homeDir: string
  env: Partial<Record<'XDG_DATA_HOME' | 'XDG_CONFIG_HOME' | 'XDG_STATE_HOME', string>>
  exists: (filePath: string) => boolean
}

export interface DataDirs {
  legacyDir: string
  dataDir: string
  configDir: string
  stateDir: string
}

export function resolveDataDirs({ homeDir, env, exists }: DataDirsInput): DataDirs {
  const legacyDir = path.join(homeDir, LEGACY_DIR_NAME)
  const isLegacy = LEGACY_MARKERS.some((marker) => exists(path.join(legacyDir, marker)))
  if (isLegacy) return { legacyDir, dataDir: legacyDir, configDir: legacyDir, stateDir: legacyDir }
  // An empty XDG_*_HOME counts as unset, as the spec says — else the data would land in the current folder
  const xdgDir = (variable: keyof DataDirsInput['env'], fallback: string[]): string =>
    path.join(env[variable] || path.join(homeDir, ...fallback), APP_DIR_NAME)
  return {
    legacyDir,
    dataDir: xdgDir('XDG_DATA_HOME', ['.local', 'share']),
    configDir: xdgDir('XDG_CONFIG_HOME', ['.config']),
    stateDir: xdgDir('XDG_STATE_HOME', ['.local', 'state']),
  }
}
