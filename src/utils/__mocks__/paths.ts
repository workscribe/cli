// Manual mock for src/utils/paths — used by tests that call vi.mock('../../src/utils/paths')
// without a factory. Values use a stable fake home so tests never touch ~/.workscribe.

export const WORKSCRIBE_DIR = '/home/user/.workscribe'
export const DB_PATH = '/home/user/.workscribe/workscribe.db'
export const CONFIG_PATH = '/home/user/.workscribe/config.json'
export const DEBUG_LOG_PATH = '/home/user/.workscribe/debug.log'
export const EXPORTS_DIR = '/home/user/.workscribe/exports'
export const PAUSE_FLAG_PATH = '/home/user/.workscribe/paused'
export const WEEKLY_CACHE_DIR = '/home/user/.workscribe/weekly-cache'
