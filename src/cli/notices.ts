import os from 'os'
import { log } from '../utils/logger'
import { CONFIG_PATH } from '../utils/paths'
import { describeLegacyAiSettings } from '../summary/legacy-ai'
import { displayPath } from '../skills/report'
import type { WorkscribeConfig } from '../config'

/** Tells a 1.x user, once per run, that their AI provider settings no longer do anything (stderr, so JSON output stays clean). */
export function printLegacyAiNotice(config: WorkscribeConfig): void {
  const notice = describeLegacyAiSettings(config, displayPath(CONFIG_PATH, os.homedir()))
  if (notice) log.notice(notice)
}
