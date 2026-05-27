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

const HOOK_START = '# workscribe:hook:start'
const HOOK_END = '# workscribe:hook:end'

function detectShell(): { name: string; rcFile: string } | null {
  const shell = process.env.SHELL ?? ''
  if (shell.includes('zsh')) return { name: 'zsh', rcFile: path.join(os.homedir(), '.zshrc') }
  if (shell.includes('bash')) return { name: 'bash', rcFile: path.join(os.homedir(), '.bashrc') }
  return null
}

function isHookInstalled(rcFile: string): boolean {
  if (!fs.existsSync(rcFile)) return false
  return fs.readFileSync(rcFile, 'utf-8').includes(HOOK_START)
}

function installHook(rcFile: string, hookContent: string): void {
  // Back up the rc file
  const backup = `${rcFile}.workscribe-backup-${Date.now()}`
  fs.copyFileSync(rcFile, backup)
  log.info(`Backed up ${rcFile} → ${path.basename(backup)}`)

  // Append hook
  fs.appendFileSync(rcFile, `\n${hookContent}\n`)
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Install shell hooks and set up Workscribe')
    .action(async () => {
      log.plain(chalk.bold('\n  Workscribe — Developer Work Journal\n'))

      // 1. Create ~/.workscribe/ with owner-only permissions
      if (!fs.existsSync(WORKSCRIBE_DIR)) {
        fs.mkdirSync(WORKSCRIBE_DIR, { recursive: true, mode: 0o700 })
        log.success(`Created ${WORKSCRIBE_DIR}`)
      } else {
        // Secure the directory for existing installs
        try { fs.chmodSync(WORKSCRIBE_DIR, 0o700) } catch { /* ignore */ }
      }

      // 2. Initialize database (runs migrations)
      getDb()
      log.success('Database initialized')

      // 3. Detect shell
      const shell = detectShell()
      if (!shell) {
        log.warn('Could not detect shell. Supported: zsh, bash')
        log.plain(`Manually add the hook from: ${chalk.cyan('shell/hook.zsh')} or ${chalk.cyan('shell/hook.bash')}`)
      } else {
        if (isHookInstalled(shell.rcFile)) {
          log.info(`Shell hook already installed in ${shell.rcFile}`)
        } else {
          // Load hook template from package
          const hookFile = path.join(__dirname, '..', 'shell', `hook.${shell.name}`)
          if (!fs.existsSync(hookFile)) {
            log.warn(`Hook template not found at ${hookFile}`)
          } else {
            const hookContent = fs.readFileSync(hookFile, 'utf-8')
            if (!fs.existsSync(shell.rcFile)) fs.writeFileSync(shell.rcFile, '')
            installHook(shell.rcFile, hookContent)
            log.success(`Shell hook installed in ${shell.rcFile}`)
          }
        }
      }

      // 4. AI provider setup
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

      // 5. Write config if not exists
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
