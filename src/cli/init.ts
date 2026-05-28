import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import os from 'os'
import prompts from 'prompts'
import chalk from 'chalk'
import { WORKSCRIBE_DIR, CONFIG_PATH } from '../utils/paths'
import { readConfig, writeConfig } from '../config'
import { getDb } from '../db'
import { log } from '../utils/logger'
import AI_TOOLS from '../config/ai-tools.json'
import { isHookInstalled, isHookOutdated, installHook, updateHook } from '../capture/shell-hook'
import { AI_HOOK_INTEGRATIONS } from '../capture/hooks'

function detectShell(): { name: string; rcFile: string } | null {
  const shell = process.env.SHELL ?? ''
  if (shell.includes('zsh')) return { name: 'zsh', rcFile: path.join(os.homedir(), '.zshrc') }
  if (shell.includes('bash')) return { name: 'bash', rcFile: path.join(os.homedir(), '.bashrc') }
  return null
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Set up Workscribe and install or update shell hooks')
    .action(async () => {
      log.plain(chalk.bold('\n  Workscribe — Developer Work Journal\n'))

      // 1. Create ~/.workscribe/ with owner-only permissions
      if (!fs.existsSync(WORKSCRIBE_DIR)) {
        fs.mkdirSync(WORKSCRIBE_DIR, { recursive: true, mode: 0o700 })
        log.success(`Created ${WORKSCRIBE_DIR}`)
      } else {
        try { fs.chmodSync(WORKSCRIBE_DIR, 0o700) } catch { /* ignore */ }
      }

      // 2. Initialize database (runs migrations)
      getDb()
      log.success('Database initialized')

      // 3. Detect shell and install or update hook
      const shell = detectShell()
      if (!shell) {
        log.warn('Could not detect shell. Supported: zsh, bash')
        log.plain(`Manually add the hook from: ${chalk.cyan('shell/hook.zsh')} or ${chalk.cyan('shell/hook.bash')}`)
      } else {
        const hookFile = path.join(__dirname, '..', 'shell', `hook.${shell.name}`)
        if (!fs.existsSync(hookFile)) {
          log.warn(`Hook template not found at ${hookFile}`)
        } else {
          const hookContent = fs.readFileSync(hookFile, 'utf-8')
          if (!fs.existsSync(shell.rcFile)) fs.writeFileSync(shell.rcFile, '')

          if (!isHookInstalled(shell.rcFile)) {
            installHook(shell.rcFile, hookContent)
            log.success(`Shell hook installed in ${shell.rcFile}`)
          } else if (isHookOutdated(shell.rcFile, hookContent)) {
            const { update } = await prompts({
              type: 'confirm',
              name: 'update',
              message: `Shell hook in ${shell.rcFile} is outdated. Update?`,
              initial: true,
            })
            if (update) {
              updateHook(shell.rcFile, hookContent)
              log.success(`Shell hook updated in ${shell.rcFile}`)
            } else {
              log.info('Shell hook update skipped')
            }
          } else {
            log.info(`Shell hook up to date in ${shell.rcFile}`)
          }
        }
      }

      // 4. AI tool hook integrations (registry-driven — add new tools in src/capture/hooks/)
      for (const tool of AI_TOOLS.filter((t) => t.hook !== null)) {
        const integration = AI_HOOK_INTEGRATIONS[tool.hook!]
        if (!integration?.isInstalled()) continue

        if (integration.isHookInstalled()) {
          log.info(`${integration.displayName} session hook already installed`)
        } else {
          const { install } = await prompts({
            type: 'confirm',
            name: 'install',
            message: `${integration.displayName} detected. Install session capture hook?`,
            initial: true,
          })
          if (install) {
            integration.install()
            log.success(`${integration.displayName} session hook installed`)
          }
        }
      }

      // 5. AI provider setup
      const config = readConfig()

      if (config.ai.provider) {
        log.info(`AI provider already configured: ${chalk.cyan(config.ai.provider)}`)
      } else {
        log.plain('')
        const { provider } = await prompts({
          type: 'select',
          name: 'provider',
          message: 'Which AI provider do you want to use?',
          choices: [
            { title: 'Anthropic (Claude) — requires API key', value: 'anthropic' },
            { title: 'OpenAI — requires API key', value: 'openai' },
            { title: 'Ollama (local) — free, runs on your machine', value: 'ollama' },
            { title: 'Other (OpenAI-compatible) — Groq, Together, Mistral…', value: 'openai-compatible' },
            { title: 'Skip — configure later', value: 'skip' },
          ],
        })

        if (provider && provider !== 'skip') {
          config.ai.provider = provider

          if (provider === 'ollama') {
            log.plain(`\n  ${chalk.dim('Make sure Ollama is running: ollama serve')}`)
            log.plain(`  ${chalk.dim('Default model: llama3  (change with: workscribe config set ai.model <model>)')}\n`)
          } else {
            const { apiKey } = await prompts({
              type: 'password',
              name: 'apiKey',
              message: `Enter your ${provider === 'openai-compatible' ? '' : provider + ' '}API key:`,
            })
            if (apiKey) config.ai.apiKey = apiKey

            if (provider === 'openai-compatible') {
              const { baseUrl } = await prompts({
                type: 'text',
                name: 'baseUrl',
                message: 'Enter the base URL (e.g. https://api.groq.com/openai/v1):',
              })
              if (baseUrl) config.ai.baseUrl = baseUrl
            }
          }

          writeConfig(config)
          log.success(`AI provider set to ${chalk.cyan(provider)}`)
        } else if (provider === 'skip' || !provider) {
          log.info('Skipped — run later: workscribe config set ai.provider <provider>')
        }
      }

      // 6. Write config if not exists
      if (!fs.existsSync(CONFIG_PATH)) {
        writeConfig(config)
        log.success('Config file created')
      }

      log.plain('')
      log.plain(chalk.bold('  Setup complete!'))
      if (shell) {
        log.plain('')
        log.plain(`  Activate capture now:  ${chalk.cyan(`source ${shell.rcFile}`)}`)
        log.plain(`  Or restart your terminal.`)
      }
      log.plain('')
      log.plain(`  ${chalk.dim('workscribe summary')}   — generate today\'s work summary`)
      log.plain(`  ${chalk.dim('workscribe status')}    — check capture is working`)
      log.plain('')
    })
}
