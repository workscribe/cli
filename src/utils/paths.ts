import path from 'path'
import os from 'os'
import fs from 'fs'

const LEGACY_DIR = path.join(os.homedir(), '.workscribe')

// Existing installs keep ~/.workscribe/ — fresh installs use XDG Base Directory spec
const USE_XDG = !fs.existsSync(LEGACY_DIR)

const xdgDataDir = USE_XDG
  ? path.join(process.env.XDG_DATA_HOME ?? path.join(os.homedir(), '.local', 'share'), 'workscribe')
  : LEGACY_DIR

const xdgConfigDir = USE_XDG
  ? path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'workscribe')
  : LEGACY_DIR

const xdgStateDir = USE_XDG
  ? path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), '.local', 'state'), 'workscribe')
  : LEGACY_DIR

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
export const PAUSE_FLAG_PATH = path.join(xdgStateDir, 'paused')
export const WEEKLY_CACHE_DIR = path.join(xdgDataDir, 'weekly-cache')
export const PROFILES_DIR = path.join(xdgDataDir, 'profiles')
// Fixed at ~/.workscribe/alerts.pending so shell hooks can check it without knowing XDG paths.
// Content is irrelevant — its presence signals pending alerts.
export const ALERTS_PENDING_PATH = path.join(LEGACY_DIR, 'alerts.pending')
