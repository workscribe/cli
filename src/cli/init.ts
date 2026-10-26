import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import os from 'os'
import prompts from 'prompts'
import chalk from 'chalk'
import { CONFIG_PATH, PROFILES_DIR, REQUIRED_DIRS } from '../utils/paths'
import { readConfig, writeConfig, ensureInstallId, WorkscribeConfig } from '../config'
import { detectProfilesForDirectory } from '../profiles/loader'
import { installProfile, cacheManifest } from '../profiles/fetcher'
import { getDb } from '../db'
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
import { detectAgents } from '../skills/detect'
import { readInstallState } from '../skills/installer'
import { resolvePackagedSkillDir } from '../skills/package-path'
import { describeInstallOutcome, reasonOf } from '../skills/report'
import { groupBySkillsFolder, outcomeWithoutPrompt } from '../skills/state'
import { describeTarget, installIntoFolder, printMessage } from '../skills/actions'
import { offerLegacyAiCleanup } from './legacy-ai-cleanup'
import type { SkillsFolderGroup } from '../skills/types'

declare const __WORKSCRIBE_VERSION__: string

type Shell = { name: string; rcFile: string }

const TOTAL_STEPS = 5

function detectShell(): Shell | null {
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

// ── Step 1: Data directories ──────────────────────────────────────────────
function runDataDirectoriesStep(): void {
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
}

// ── Step 2: Database ──────────────────────────────────────────────────────
async function initDatabaseAndConfig(): Promise<WorkscribeConfig> {
  step(2, TOTAL_STEPS, 'Initialising database')
  const config = readConfig()
  getDb()
  log.success('Database ready')
  return offerLegacyAiCleanup(config)
}

// ── Telemetry (part of setup, no separate step) ────────────────────────────
async function runTelemetryStep(config: WorkscribeConfig): Promise<void> {
  log.plain('')
  log.plain(chalk.dim('  Workscribe can send anonymous install stats: a random install ID,'))
  log.plain(chalk.dim('  CLI version, OS platform, and Node.js version. No command, event, or'))
  log.plain(chalk.dim('  summary data is ever sent. Opt out anytime:'))
  log.plain(chalk.dim('  workscribe config set telemetry.enabled false'))
  log.plain('')
  const { telemetryEnabled } = await prompts({
    type: 'confirm',
    name: 'telemetryEnabled',
    message: 'Send anonymous install stats?',
    initial: true,
  })
  config.telemetry.enabled = telemetryEnabled
  config.telemetry.installId = ensureInstallId(config)
}

// ── Step 3: Shell hook + completions ──────────────────────────────────────
async function runShellHookStep(program: Command): Promise<Shell | null> {
  step(3, TOTAL_STEPS, 'Installing shell hook')

  const shell = detectShell()
  if (!shell) {
    log.warn('Could not detect shell. Supported: zsh, bash, fish')
    log.plain(
      `  Manually add the hook from: ${chalk.cyan('shell/hook.zsh')}, ${chalk.cyan('shell/hook.bash')}, or ${chalk.cyan('shell/hook.fish')}`
    )
    return null
  }

  const hookFile = path.join(__dirname, '..', 'shell', `hook.${shell.name}`)
  if (!fs.existsSync(hookFile)) {
    log.warn(`Hook template not found at ${hookFile}`)
    return shell
  }

  const hookContent = fs.readFileSync(hookFile, 'utf-8')
  const binaryPath = resolveWorkscribeBinary()
  const hookWithPath = binaryPath ? injectBinaryPath(hookContent, binaryPath, process.execPath) : hookContent

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

  return shell
}

// ── Step 4: AI tools ──────────────────────────────────────────────────────
async function runAIToolsStep(): Promise<void> {
  step(4, TOTAL_STEPS, 'Detecting AI coding tools')

  const installedTools = loadAIToolRegistry().filter(
    (entry) => entry.hook !== null && AI_HOOK_INTEGRATIONS[entry.hook!]?.isInstalled()
  )

  if (installedTools.length === 0) {
    log.info('No AI coding tools detected — re-run workscribe init after installing one')
    return
  }

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

// ── Step 5: Agent skill ───────────────────────────────────────────────────
async function offerSkillInstall(group: SkillsFolderGroup, sourceDir: string): Promise<void> {
  const target = describeTarget(group)
  const state = readInstallState(target.skillsFolder, __WORKSCRIBE_VERSION__)
  const knownOutcome = outcomeWithoutPrompt(state)
  if (knownOutcome) {
    printMessage(describeInstallOutcome({ ...target, outcome: knownOutcome, version: __WORKSCRIBE_VERSION__ }))
    return
  }

  const { installSkill: shouldInstall } = await prompts({
    type: 'confirm',
    name: 'installSkill',
    message: `${state.kind === 'outdated' ? 'Update' : 'Install'} the Workscribe skill for ${target.agents}? Lets ${target.agents} summarize your work when you ask`,
    initial: true,
  })
  if (!shouldInstall) {
    log.info(`Skill skipped for ${target.agents} — run workscribe skill install any time`)
    return
  }
  printMessage(installIntoFolder({ target, sourceDir }))
}

async function runAgentSkillStep(): Promise<void> {
  step(5, TOTAL_STEPS, 'Installing the Workscribe agent skill')

  const agents = detectAgents()
  if (agents.length === 0) {
    log.info('No coding agents detected — run workscribe skill install after installing one')
    return
  }

  let sourceDir: string
  try {
    sourceDir = resolvePackagedSkillDir()
  } catch (error) {
    log.warn(reasonOf(error)) // setup can carry on; the skill is optional
    return
  }
  for (const group of groupBySkillsFolder(agents)) {
    await offerSkillInstall(group, sourceDir)
  }
}

// Profile detection (part of environment scan, no separate step)
async function runProfileDetectionStep(config: WorkscribeConfig): Promise<void> {
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
}

// ── What to do next ───────────────────────────────────────────────────────
function printNextSteps(shell: Shell | null): void {
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

  log.plain(`  Then run a few commands and generate your first summary:`)
  log.plain(`    ${chalk.cyan('workscribe summary')}`)
  log.plain('')
  log.plain(`  For AI-written summaries, ask your coding agent to "summarize my work today"`)
  log.plain(`  ${chalk.dim('(needs the Workscribe skill: workscribe skill install)')}`)
  log.plain('')
  log.plain(`  Check capture is working:`)
  log.plain(`    ${chalk.cyan('workscribe status')}`)

  log.plain('')
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Set up Workscribe and install or update shell hooks')
    .action(async () => {
      log.plain(chalk.bold('\n  Workscribe — Developer Work Journal\n'))

      runDataDirectoriesStep()
      const config = await initDatabaseAndConfig()
      await runTelemetryStep(config)
      const shell = await runShellHookStep(program)
      await runAIToolsStep()
      await runAgentSkillStep()
      await runProfileDetectionStep(config)

      if (!fs.existsSync(CONFIG_PATH)) {
        writeConfig(config)
      }

      printNextSteps(shell)
    })
}
