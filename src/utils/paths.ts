import path from 'path'
import os from 'os'

export const CHRONICLE_DIR = path.join(os.homedir(), '.chronicle')
export const DB_PATH = path.join(CHRONICLE_DIR, 'chronicle.db')
export const CONFIG_PATH = path.join(CHRONICLE_DIR, 'config.json')
export const DEBUG_LOG_PATH = path.join(CHRONICLE_DIR, 'debug.log')
export const EXPORTS_DIR = path.join(CHRONICLE_DIR, 'exports')
