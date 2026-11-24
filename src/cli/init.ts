import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import prompts from 'prompts'
import chalk from 'chalk'
import { CONFIG_PATH, PROFILES_DIR, REQUIRED_DIRS } from '../utils/paths'
import { readConfig, writeConfig, WorkscribeConfig } from '../config'
import { detectProfilesForDirectory } from '../profiles/loader'
import { installProfile, cacheManifest } from '../profiles/fetcher'
import { getDb } from '../db'
import { log } from '../utils/logger'
import { loadAIToolRegistry } from '../config/registry'
import { DEFAULT_RETENTION_DAYS } from '../config/retention'
import {
  detectShell,
  hasChronicleHook,
  removeChronicleHook,
  isHookInstalled,
  isHookOutdated,
  installHook,
  updateHook,
  isCompletionsInstalled,
  installCompletions,
  isCompletionsOutdated,
  updateCompletions,
  type ShellTarget,
  writeCompletionScript,
  resolveWorkscribeBinary,
  injectBinaryPath,
} from '../capture/shell-hook'
import { AI_HOOK_INTEGRATIONS } from '../capture/hooks'
import type { AIHookIntegration } from '../capture/hooks/types'
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

type Shell = ShellTarget

const TOTAL_STEPS = 5

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

/** 0.2.1, before the rename to Workscribe, wrote a `chronicle` hook that nothing removes and that errors at every prompt. */
async function offerChronicleCleanup(shell: Shell): Promise<void> {
  if (!hasChronicleHook(shell.rcFile)) return
  const { removeChronicle } = await prompts({
    type: 'confirm',
    name: 'removeChronicle',
    message: `An old Chronicle hook in ${shell.rcFile} errors at every prompt. Remove it?`,
    initial: true,
  })
  if (!removeChronicle) {
    log.info('Chronicle hook left in place')
    return
  }
  removeChronicleHook(shell.rcFile)
  log.success(`Removed the old Chronicle hook from ${shell.rcFile}`)
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

  await offerChronicleCleanup(shell)

  // Offer completions install — or repair: refresh the script, and guard an older unguarded rc block
  if (isCompletionsInstalled(shell)) {
    await refreshCompletions(shell, program)
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

async function refreshCompletions(shell: Shell, program: Command): Promise<void> {
  try {
    writeCompletionScript(shell, getPublicCommands(program))
  } catch (error) {
    log.warn(`Could not refresh shell completions: ${(error as Error).message}`)
  }
  if (!isCompletionsOutdated(shell)) {
    log.info('Shell completions already installed')
    return
  }
  const { updateShellCompletions } = await prompts({
    type: 'confirm',
    name: 'updateShellCompletions',
    message: `Shell completions in ${shell.rcFile} are outdated (they error in new terminals if Workscribe is removed). Update?`,
    initial: true,
  })
  if (!updateShellCompletions) {
    log.info('Shell completions update skipped')
    return
  }
  updateCompletions(shell)
  log.success(`Shell completions updated in ${shell.rcFile}`)
}

/** Installs a tool's hook and says what happened — never "installed" over a settings file it had to leave alone. */
function reportInstall(integration: AIHookIntegration, doneWord: 'installed' | 'updated'): void {
  if (integration.install() === 'unreadable') {
    log.warn(
      `Couldn't read ${integration.settingsPath}, so the ${integration.displayName} session hook was left alone. Fix the file's JSON, then run workscribe init again`
    )
    return
  }
  log.success(`${integration.displayName} session hook ${doneWord}`)
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
    } else if (integration.isHookOutdated?.()) {
      // You opted in when you first installed it, so updating it defaults to yes
      const { updateAiHook } = await prompts({
        type: 'confirm',
        name: 'updateAiHook',
        message: `${integration.displayName} session hook is outdated. Update?`,
        initial: true,
      })
      if (updateAiHook) {
        reportInstall(integration, 'updated')
      } else {
        log.info(`${integration.displayName} hook update skipped — re-run workscribe init to update later`)
      }
    } else {
      const { install } = await prompts({
        type: 'confirm',
        name: 'install',
        message: `${integration.displayName} detected. Install session capture hook?`,
        initial: false,
      })
      if (install) {
        reportInstall(integration, 'installed')
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

  printRetentionNote()
  log.plain('')
}

/** Tells people, before anything is captured, that old data is removed, when, and how to keep it (WOR-179). */
function printRetentionNote(): void {
  const days = readConfig().retention?.days ?? DEFAULT_RETENTION_DAYS
  log.plain('')
  log.plain(`  Your data stays on this machine. Captured events are removed after ${chalk.cyan(String(days))} days;`)
  log.plain(`  your summaries stay. ${chalk.dim('See: workscribe retention')}`)
  log.plain(`  To keep everything instead: ${chalk.cyan('workscribe config set retention.keepForever true')}`)
}

export function registerInit(program: Command): void {
  program
    .command('init')
    .description('Set up Workscribe and install or update shell hooks')
    .action(async () => {
      log.plain(chalk.bold('\n  Workscribe — Developer Work Journal\n'))

      runDataDirectoriesStep()
      const config = await initDatabaseAndConfig()
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
