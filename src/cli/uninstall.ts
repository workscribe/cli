import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import os from 'os'
import prompts from 'prompts'
import chalk from 'chalk'
import { WORKSCRIBE_DIR } from '../utils/paths'
import { isHookInstalled, removeHook } from '../capture/shell-hook'
import { log } from '../utils/logger'

function detectShellRcFiles(): { name: string; rcFile: string }[] {
  const candidates = [
    { name: 'zsh', rcFile: path.join(os.homedir(), '.zshrc') },
    { name: 'bash', rcFile: path.join(os.homedir(), '.bashrc') },
    { name: 'bash', rcFile: path.join(os.homedir(), '.bash_profile') },
  ]
  return candidates.filter((c) => fs.existsSync(c.rcFile) && isHookInstalled(c.rcFile))
}

export function registerUninstall(program: Command): void {
  program
    .command('uninstall')
    .description('Remove shell hooks and optionally delete all Workscribe data')
    .option('--hooks-only', 'remove shell hooks only, skip data deletion prompt (used by npm preuninstall)')
    .action(async (opts) => {
      log.plain(chalk.bold('\n  Workscribe — Uninstall\n'))

      // 1. Remove shell hooks from any rc files that have them
      const hooked = detectShellRcFiles()
      if (hooked.length === 0) {
        log.info('No shell hooks found')
      } else {
        for (const { name, rcFile } of hooked) {
          removeHook(rcFile)
          log.success(`Shell hook removed from ${rcFile}`)
          log.plain(`  ${chalk.dim(`Run: source ${rcFile}`)}  (or restart your terminal to take effect)`)
          log.plain(
            `  ${chalk.dim(`${name === 'zsh' ? 'unfunction' : 'unset -f'} _workscribe_preexec _workscribe_precmd`)}`
          )
        }
      }

      if (opts.hooksOnly) return

      // 2. Optionally delete ~/.workscribe/ data
      if (fs.existsSync(WORKSCRIBE_DIR)) {
        log.plain('')
        const { deleteData } = await prompts({
          type: 'confirm',
          name: 'deleteData',
          message: `Delete all Workscribe data in ${WORKSCRIBE_DIR}? (database, config, exports)`,
          initial: false,
        })

        if (deleteData) {
          fs.rmSync(WORKSCRIBE_DIR, { recursive: true, force: true })
          log.success(`Deleted ${WORKSCRIBE_DIR}`)
        } else {
          log.info(`Data kept at ${WORKSCRIBE_DIR}`)
        }
      }

      log.plain('')
      log.plain(`  ${chalk.dim('npm uninstall -g @workscribe/cli')}  — remove the CLI itself`)
      log.plain('')
    })
}
