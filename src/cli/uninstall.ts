import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import os from 'os'
import prompts from 'prompts'
import chalk from 'chalk'
import { WORKSCRIBE_DIR, REQUIRED_DIRS } from '../utils/paths'
import { isHookInstalled, removeCompletions, removeFishCompletions, removeHook } from '../capture/shell-hook'
import { claudeCodeIntegration } from '../capture/hooks/claude-code'
import { log } from '../utils/logger'
import { SKILL_AGENTS } from '../skills/agents'
import { removeSkills } from '../skills/actions'

// The rc files `init` may have added a completions block to — checked on their own, since a file can have the
// completions block without the hook block
function completionRcFiles(): string[] {
  return ['.zshrc', '.bashrc', '.bash_profile'].map((file) => path.join(os.homedir(), file))
}

/** Removes everything else `init` adds to your shell and tools: completions and the Claude Code session hook. */
function removeCompletionsAndToolHooks(): void {
  for (const rcFile of completionRcFiles()) {
    if (removeCompletions(rcFile)) log.success(`Shell completions removed from ${rcFile}`)
  }
  if (removeFishCompletions()) log.success('Fish completions removed')

  // Not only when Claude Code is on PATH — someone who removed Claude Code can still have the hook in its settings
  const outcome = claudeCodeIntegration.uninstall?.()
  if (outcome === 'removed') log.success('Claude Code session hook removed from ~/.claude/settings.json')
  if (outcome === 'unreadable') {
    log.warn(
      "Couldn't read ~/.claude/settings.json, so the Claude Code session hook was left in place. Fix the file's JSON, then run: workscribe uninstall --hooks-only"
    )
  }
}

function detectShellRcFiles(): { name: string; rcFile: string }[] {
  const candidates = [
    { name: 'zsh', rcFile: path.join(os.homedir(), '.zshrc') },
    { name: 'bash', rcFile: path.join(os.homedir(), '.bashrc') },
    { name: 'bash', rcFile: path.join(os.homedir(), '.bash_profile') },
    { name: 'fish', rcFile: path.join(os.homedir(), '.config', 'fish', 'conf.d', 'workscribe.fish') },
  ]
  return candidates.filter((candidate) => fs.existsSync(candidate.rcFile) && isHookInstalled(candidate.rcFile))
}

export function registerUninstall(program: Command): void {
  program
    .command('uninstall')
    .description(
      'Remove shell hooks, completions, the Claude Code hook and the agent skill; optionally delete all data'
    )
    .option(
      '--hooks-only',
      'remove shell hooks, completions and the Claude Code hook only — keep the agent skill and skip the data prompt'
    )
    .action(async (options) => {
      log.plain(chalk.bold('\n  Workscribe — Uninstall\n'))

      // 1. Remove shell hooks from any rc files that have them
      const hooked = detectShellRcFiles()
      if (hooked.length === 0) {
        log.info('No shell hooks found')
      } else {
        for (const { name, rcFile } of hooked) {
          if (name === 'fish') {
            // The conf.d file is ours entirely — delete it rather than leaving an empty file
            fs.unlinkSync(rcFile)
            log.success(`Shell hook removed: ${rcFile}`)
            log.plain(`  ${chalk.dim('Restart your terminal to take effect')}`)
          } else {
            removeHook(rcFile)
            log.success(`Shell hook removed from ${rcFile}`)
            log.plain(`  ${chalk.dim(`Run: source ${rcFile}`)}  (or restart your terminal to take effect)`)
            log.plain(
              `  ${chalk.dim(`${name === 'zsh' ? 'unfunction' : 'unset -f'} _workscribe_preexec _workscribe_precmd`)}`
            )
          }
        }
      }

      removeCompletionsAndToolHooks()

      // Agent skills are only removed on a full uninstall: `--hooks-only` is for clearing what runs in your
      // shell and tools, and the skill is something you chose to install into your coding agents
      if (options.hooksOnly) return

      removeSkills(SKILL_AGENTS, { reportMissing: false })

      // 2. Optionally delete all Workscribe data directories
      const existingDirs = [...new Set(REQUIRED_DIRS)].filter((dir) => fs.existsSync(dir))

      if (existingDirs.length > 0) {
        log.plain('')
        const { deleteData } = await prompts({
          type: 'confirm',
          name: 'deleteData',
          message: `Delete all Workscribe data in ${WORKSCRIBE_DIR}? (database, config, exports, backups)`,
          initial: false,
        })

        if (deleteData) {
          for (const dir of existingDirs) {
            fs.rmSync(dir, { recursive: true, force: true })
            log.success(`Deleted ${dir}`)
          }
        } else {
          log.info(`Data kept at ${WORKSCRIBE_DIR}`)
        }
      }

      log.plain('')
      log.plain(`  ${chalk.dim('npm uninstall -g @workscribe/cli')}  — then remove the CLI itself`)
      log.plain('')
    })
}
