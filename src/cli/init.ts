import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import os from 'os'
import prompts from 'prompts'
import chalk from 'chalk'
import { CONFIG_PATH, PROFILES_DIR, REQUIRED_DIRS } from '../utils/paths'
import { readConfig, writeConfig } from '../config'
import { detectProfilesForDirectory } from '../profiles/loader'
import { installProfile, cacheManifest } from '../profiles/fetcher'
import { getDb } from '../db'
import { getProvider } from '../ai/router'
import { log } from '../utils/logger'
import { loadAIToolRegistry } from '../config/registry'
import {
  isHookInstalled,
  isHookOutdated,
  installHook,
  updateHook,
  isCompletionsInstalled,
  installCompletions,
  resolveWorkscribeBinary,
  injectBinaryPath,
} from '../capture/shell-hook'
import { AI_HOOK_INTEGRATIONS } from '../capture/hooks'
import { getPublicCommands } from './completions'

function detectShell(): { name: string; rcFile: string } | null {
  const shell = process.env.SHELL ?? ''
  if (shell.includes('zsh')) return { name: 'zsh', rcFile: path.join(os.homedir(), '.zshrc') }
  if (shell.includes('bash')) return { name: 'bash', rcFile: path.join(os.homedir(), '.bashrc') }
  if (shell.includes('fish')) {
    const confDir = path.join(os.homedir(), '.config', 'fish', 'conf.d')
    return { name: 'fish', rcFile: path.join(confDir, 'workscribe.fish') }
  }
  return null
}

function step(current: number, total: number, label: string): void {
  log.plain(chalk.bold(`\n  [${current}/${total}] ${label}`))
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Set up Workscribe and install or update shell hooks')
    .action(async () => {
      const TOTAL_STEPS = 5
      log.plain(chalk.bold('\n  Workscribe — Developer Work Journal\n'))

      // ── Step 1: Data directories ──────────────────────────────────────────────
      step(1, TOTAL_STEPS, 'Creating data directories')

      for (const dir of REQUIRED_DIRS) {
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
          log.success(`Created ${dir}`)
        } else {
          try {
            fs.chmodSync(dir, 0o700)
          } catch {
            /* ignore */
          }
          log.info(`${dir} already exists`)
        }
      }

      if (!fs.existsSync(PROFILES_DIR)) {
        fs.mkdirSync(PROFILES_DIR, { recursive: true, mode: 0o700 })
      }

      // ── Step 2: Database ──────────────────────────────────────────────────────
      step(2, TOTAL_STEPS, 'Initialising database')
      getDb()
      log.success('Database ready')

      // ── Step 3: Shell hook + completions ──────────────────────────────────────
      step(3, TOTAL_STEPS, 'Installing shell hook')

      const shell = detectShell()
      if (!shell) {
        log.warn('Could not detect shell. Supported: zsh, bash, fish')
        log.plain(
          `  Manually add the hook from: ${chalk.cyan('shell/hook.zsh')}, ${chalk.cyan('shell/hook.bash')}, or ${chalk.cyan('shell/hook.fish')}`
        )
      } else {
        const hookFile = path.join(__dirname, '..', 'shell', `hook.${shell.name}`)
        if (!fs.existsSync(hookFile)) {
          log.warn(`Hook template not found at ${hookFile}`)
        } else {
          const hookContent = fs.readFileSync(hookFile, 'utf-8')
          const binaryPath = resolveWorkscribeBinary()
          const hookWithPath = binaryPath ? injectBinaryPath(hookContent, binaryPath) : hookContent

          // For fish: ensure conf.d directory exists before touching the file
          if (shell.name === 'fish') {
            const confDir = path.dirname(shell.rcFile)
            if (!fs.existsSync(confDir)) fs.mkdirSync(confDir, { recursive: true })
          }

          if (!fs.existsSync(shell.rcFile)) fs.writeFileSync(shell.rcFile, '')

          if (!isHookInstalled(shell.rcFile)) {
            log.plain('')
            log.plain(chalk.dim('  Workscribe adds a lightweight hook to your shell that captures each'))
            log.plain(chalk.dim('  command you run — the text, exit code, duration, and working directory.'))
            log.plain(chalk.dim('  It runs in the background and adds no latency to your terminal.'))
            log.plain(chalk.dim('  Credentials and secrets are redacted before anything is stored.'))
            log.plain('')
            installHook(shell.rcFile, hookWithPath)
            log.success(`Shell hook installed in ${shell.rcFile}`)
          } else if (isHookOutdated(shell.rcFile, hookWithPath)) {
            const { update } = await prompts({
              type: 'confirm',
              name: 'update',
              message: `Shell hook in ${shell.rcFile} is outdated. Update?`,
              initial: true,
            })
            if (update) {
              updateHook(shell.rcFile, hookWithPath)
              log.success(`Shell hook updated in ${shell.rcFile}`)
            } else {
              log.info('Shell hook update skipped')
            }
          } else {
            log.info(`Shell hook up to date in ${shell.rcFile}`)
          }

          // Offer completions install
          if (isCompletionsInstalled(shell)) {
            log.info('Shell completions already installed')
          } else {
            const { installComps } = await prompts({
              type: 'confirm',
              name: 'installComps',
              message: 'Install shell completions (tab-complete workscribe commands)?',
              initial: true,
            })
            if (installComps) {
              try {
                installCompletions(shell, getPublicCommands(program))
                log.success('Shell completions installed')
              } catch (error) {
                log.warn(`Completions install failed: ${(error as Error).message}`)
              }
            }
          }
        }
      }

      // ── Step 4: AI tools ──────────────────────────────────────────────────────
      step(4, TOTAL_STEPS, 'Detecting AI coding tools')

      const installedTools = loadAIToolRegistry().filter(
        (entry) => entry.hook !== null && AI_HOOK_INTEGRATIONS[entry.hook!]?.isInstalled()
      )

      if (installedTools.length === 0) {
        log.info('No AI coding tools detected — re-run workscribe init after installing one')
      } else {
        for (const tool of installedTools) {
          const integration = AI_HOOK_INTEGRATIONS[tool.hook!]!

          if (integration.isHookInstalled()) {
            log.info(`${integration.displayName} session hook already installed`)
          } else {
            const { install } = await prompts({
              type: 'confirm',
              name: 'install',
              message: `${integration.displayName} detected. Install session capture hook?`,
              initial: false,
            })
            if (install) {
              integration.install()
              log.success(`${integration.displayName} session hook installed`)
            } else {
              log.info(`${integration.displayName} hook skipped — re-run workscribe init to install later`)
            }
          }
        }
      }

      // Profile detection (part of environment scan, no separate step)
      const config = readConfig()
      try {
        await cacheManifest()
        const detected = detectProfilesForDirectory(process.cwd())
        const alreadyActive = new Set(config.capture.profiles)
        const toPrompt = detected.filter((entry) => !alreadyActive.has(entry.name))

        if (toPrompt.length > 0) {
          log.plain('')
          for (const entry of toPrompt) {
            const { install } = await prompts({
              type: 'confirm',
              name: 'install',
              message: `${entry.displayName} project detected. Enable the ${entry.displayName} profile?`,
              initial: true,
            })
            if (install) {
              await installProfile(entry.name)
              config.capture.profiles = [...new Set([...config.capture.profiles, entry.name])]
              log.success(`${entry.displayName} profile enabled`)
            }
          }
          writeConfig(config)
        } else if (detected.length === 0) {
          log.info('No project profiles detected — run workscribe profile detect from your project directory')
        }
      } catch {
        log.info('Could not reach profile registry — run workscribe profile detect after connecting')
      }

      // ── Step 5: AI provider ───────────────────────────────────────────────────
      step(5, TOTAL_STEPS, 'Configuring AI provider')

      let providerConfigured = !!config.ai.provider

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

        if (!provider || provider === 'skip') {
          providerConfigured = false
          log.info('Skipped — run later: workscribe config set ai.provider <provider>')
        } else {
          config.ai.provider = provider

          if (provider === 'ollama') {
            log.plain(`\n  ${chalk.dim('Make sure Ollama is running: ollama serve')}`)
            log.plain(
              `  ${chalk.dim('Default model: llama3  (change with: workscribe config set ai.model <model>)')}\n`
            )
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

          log.plain('')
          log.info(`Validating ${chalk.cyan(provider)} connection…`)
          try {
            const testProvider = getProvider(config)
            await testProvider.validate()
            log.success('API key verified')
            writeConfig(config)
            providerConfigured = true
          } catch (error) {
            log.warn(`Validation failed: ${(error as Error).message}`)
            const { retry } = await prompts({
              type: 'confirm',
              name: 'retry',
              message: 'Save anyway and configure later?',
              initial: false,
            })
            if (retry) {
              writeConfig(config)
              providerConfigured = false
              log.info('Config saved — run workscribe config set ai.apiKey <key> to update')
            } else {
              log.info('API key not saved — run workscribe init again to configure')
              providerConfigured = false
            }
          }
        }
      }

      // ── Config file ───────────────────────────────────────────────────────────
      if (!fs.existsSync(CONFIG_PATH)) {
        writeConfig(config)
      }

      // ── What to do next ───────────────────────────────────────────────────────
      log.plain('')
      log.plain(chalk.bold('  Setup complete!'))
      log.plain('')

      if (shell) {
        log.plain(`  Activate capture now:`)
        if (shell.name === 'fish') {
          log.plain(`    Restart your terminal`)
          log.plain(`    ${chalk.dim(`or run: source ${shell.rcFile}`)}`)
        } else {
          log.plain(`    ${chalk.cyan(`source ${shell.rcFile}`)}`)
          log.plain(`  Or restart your terminal.`)
        }
        log.plain('')
      }

      if (providerConfigured) {
        log.plain(`  Then run a few commands and generate your first summary:`)
        log.plain(`    ${chalk.cyan('workscribe summary')}`)
        log.plain('')
        log.plain(`  Check capture is working:`)
        log.plain(`    ${chalk.cyan('workscribe status')}`)
      } else {
        log.plain(`  Before generating summaries, configure an AI provider:`)
        log.plain(`    ${chalk.cyan('workscribe config set ai.provider anthropic')}`)
        log.plain(`    ${chalk.cyan('workscribe config set ai.apiKey <your-key>')}`)
        log.plain('')
        log.plain(`  Then run:`)
        log.plain(`    ${chalk.cyan('workscribe summary')}`)
      }

      log.plain('')
    })
}
