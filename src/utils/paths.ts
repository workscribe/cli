import path from 'path'
import os from 'os'
import fs from 'fs'
import { resolveDataDirs } from './data-dirs'

// Decided once per process: legacy installs keep ~/.workscribe, fresh ones use XDG (see data-dirs.ts)
const {
  legacyDir: LEGACY_DIR,
  dataDir: xdgDataDir,
  configDir: xdgConfigDir,
  stateDir: xdgStateDir,
} = resolveDataDirs({ homeDir: os.homedir(), env: process.env, exists: fs.existsSync })

// All directories that must exist for Workscribe to function (deduplicated for legacy installs).
// LEGACY_DIR (~/.workscribe) is always included so the alerts signal file has a predictable
// location that shell hooks can check without knowing the XDG paths.
export const REQUIRED_DIRS: string[] = [...new Set([xdgDataDir, xdgConfigDir, xdgStateDir, LEGACY_DIR])]

export const WORKSCRIBE_DIR = xdgDataDir
export const DB_PATH = path.join(xdgDataDir, 'workscribe.db')
export const CONFIG_PATH = path.join(xdgConfigDir, 'config.json')
export const DEBUG_LOG_PATH = path.join(xdgStateDir, 'debug.log')
export const UPDATE_CHECK_PATH = path.join(xdgStateDir, 'update-check.json')
export const EXPORTS_DIR = path.join(xdgDataDir, 'exports')
// Copies of the database taken before a data upgrade (src/db/jobs/backup.ts) — private, newest 3 kept
export const BACKUPS_DIR = path.join(xdgDataDir, 'backups')
export const PAUSE_FLAG_PATH = path.join(xdgStateDir, 'paused')
export const PROFILES_DIR = path.join(xdgDataDir, 'profiles')
// Fixed at ~/.workscribe/alerts.pending so shell hooks can check it without knowing XDG paths.
// Content is irrelevant — its presence signals pending alerts.
export const ALERTS_PENDING_PATH = path.join(LEGACY_DIR, 'alerts.pending')
