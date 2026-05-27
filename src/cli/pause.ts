import { Command } from 'commander'
import fs from 'fs'
import { PAUSE_FLAG_PATH } from '../utils/paths'
import { log } from '../utils/logger'

export function registerPause(program: Command): void {
  program
    .command('pause')
    .description('Pause capture temporarily')
    .action(() => {
      if (fs.existsSync(PAUSE_FLAG_PATH)) {
        log.info('Capture is already paused. Run workscribe resume to restart.')
        return
      }
      fs.writeFileSync(PAUSE_FLAG_PATH, '', { mode: 0o600 })
      log.success('Capture paused. Run workscribe resume to restart.')
    })

  program
    .command('resume')
    .description('Resume capture after a pause')
    .action(() => {
      if (!fs.existsSync(PAUSE_FLAG_PATH)) {
        log.info('Capture is not paused.')
        return
      }
      fs.rmSync(PAUSE_FLAG_PATH)
      log.success('Capture resumed.')
    })
}
