import path from 'path'
import os from 'os'

export const WORKSCRIBE_DIR = path.join(os.homedir(), '.workscribe')
export const DB_PATH = path.join(WORKSCRIBE_DIR, 'workscribe.db')
export const CONFIG_PATH = path.join(WORKSCRIBE_DIR, 'config.json')
export const DEBUG_LOG_PATH = path.join(WORKSCRIBE_DIR, 'debug.log')
export const EXPORTS_DIR = path.join(WORKSCRIBE_DIR, 'exports')
export const PAUSE_FLAG_PATH = path.join(WORKSCRIBE_DIR, 'paused')
