import { Command } from 'commander'
import fs from 'fs'
import path from 'path'
import chalk from 'chalk'
import { readConfig, writeConfig } from '../config'
import { PROFILES_DIR } from '../utils/paths'
import { getCachedProfiles, detectProfilesForDirectory } from '../profiles/loader'
import { installProfile, cacheManifest, readCachedManifest } from '../profiles/fetcher'
import { getOtherEventToolCounts } from '../db'
import { log } from '../utils/logger'

const MIN_SUGGEST_COUNT = 5

export function registerProfile(program: Command): void {
  const profile = program.command('profile').description('Manage stack profiles for better command tracking')

  // ─── list ─────────────────────────────────────────────────────────────────
  profile
    .command('list')
    .description('List available profiles from the registry')
    .action(async () => {
      const config = readConfig()
      const activeNames = new Set(config.capture.profiles)

      let manifest = readCachedManifest()
      let offline = false

      if (!manifest) {
        try {
          manifest = await cacheManifest()
        } catch {
          offline = true
          manifest = getCachedProfiles().map((p) => ({
            name: p.name,
            displayName: p.displayName,
            tags: [],
            description: '',
            keywords: [],
            detect: p.detect,
          }))
        }
      } else {
        // Refresh in background — best effort, don't block output
        cacheManifest().catch(() => undefined)
      }

      if (offline) {
        log.warn('Registry unreachable — showing installed profiles only')
      }

      if (manifest.length === 0) {
        log.plain('No profiles available. Check your connection and try again.')
        return
      }

      // Group by tag
      const grouped = new Map<string, typeof manifest>()
      for (const entry of manifest) {
        const tag = entry.tags[0] ?? 'other'
        if (!grouped.has(tag)) grouped.set(tag, [])
        grouped.get(tag)!.push(entry)
      }

      log.plain('')
      for (const [tag, entries] of grouped) {
        log.plain(chalk.bold(`  ${tag.charAt(0).toUpperCase() + tag.slice(1)} profiles`))
        log.plain(chalk.dim('  ' + '─'.repeat(60)))
        for (const entry of entries) {
          const badge = activeNames.has(entry.name) ? chalk.green(' [active]') : ''
          const installed = fs.existsSync(path.join(PROFILES_DIR, `${entry.name}.json`)) ? chalk.dim(' installed') : ''
          log.plain(`  ${chalk.cyan(entry.name.padEnd(18))} ${entry.displayName.padEnd(28)}${badge}${installed}`)
          if (entry.description) log.plain(`  ${chalk.dim(' '.repeat(18) + entry.description)}`)
        }
        log.plain('')
      }
    })

  // ─── add ──────────────────────────────────────────────────────────────────
  profile
    .command('add <names...>')
    .description('Install one or more profiles from the registry')
    .action(async (names: string[]) => {
      const config = readConfig()
      const activeNames = new Set(config.capture.profiles)

      for (const name of names) {
        if (activeNames.has(name)) {
          log.info(`Profile "${name}" is already active`)
          continue
        }
        try {
          log.plain(`Fetching ${chalk.cyan(name)}…`)
          await installProfile(name)
          activeNames.add(name)
          log.success(`Profile "${name}" installed`)
        } catch (err) {
          log.error(`Failed to install "${name}": ${(err as Error).message}`)
        }
      }

      config.capture.profiles = [...activeNames]
      writeConfig(config)
    })

  // ─── remove ───────────────────────────────────────────────────────────────
  profile
    .command('remove <names...>')
    .description('Uninstall one or more profiles')
    .action((names: string[]) => {
      const config = readConfig()
      const activeNames = new Set(config.capture.profiles)

      for (const name of names) {
        if (!activeNames.has(name)) {
          log.warn(`Profile "${name}" is not active`)
          continue
        }
        activeNames.delete(name)
        const cachePath = path.join(PROFILES_DIR, `${name}.json`)
        if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath)
        log.success(`Profile "${name}" removed`)
      }

      config.capture.profiles = [...activeNames]
      writeConfig(config)
    })

  // ─── update ───────────────────────────────────────────────────────────────
  profile
    .command('update [name]')
    .description('Re-fetch installed profiles from the registry')
    .action(async (name?: string) => {
      const config = readConfig()
      const toUpdate = name ? [name] : config.capture.profiles

      if (toUpdate.length === 0) {
        log.plain('No profiles installed. Run workscribe profile add <name> first.')
        return
      }

      for (const profileName of toUpdate) {
        try {
          log.plain(`Updating ${chalk.cyan(profileName)}…`)
          await installProfile(profileName)
          log.success(`${profileName} updated`)
        } catch (err) {
          log.error(`Failed to update "${profileName}": ${(err as Error).message}`)
        }
      }
    })

  // ─── detect ───────────────────────────────────────────────────────────────
  profile
    .command('detect')
    .description('Scan the current directory and suggest matching profiles')
    .action(() => {
      const cwd = process.cwd()
      const matches = detectProfilesForDirectory(cwd)

      if (matches.length === 0) {
        const cached = readCachedManifest()
        if (!cached) {
          log.plain('No manifest cached. Run workscribe profile list to fetch it first.')
        } else {
          log.plain(`No profiles detected for ${chalk.dim(cwd)}`)
          log.plain(chalk.dim('Run workscribe profile list to browse available profiles.'))
        }
        return
      }

      log.plain('')
      log.plain(chalk.bold('  Profiles detected for this directory:'))
      log.plain('')
      for (const entry of matches) {
        const files = entry.detect?.files?.join(', ') ?? ''
        log.plain(`  ${chalk.cyan(entry.name.padEnd(18))} ${entry.displayName}  ${chalk.dim('(' + files + ')')}`)
      }
      log.plain('')
      log.plain(`  Run: ${chalk.cyan('workscribe profile add ' + matches.map((e) => e.name).join(' '))}`)
      log.plain('')
    })

  // ─── suggest ──────────────────────────────────────────────────────────────
  profile
    .command('suggest')
    .description('Analyse recent unclassified commands and suggest profiles')
    .option('--days <n>', 'number of days to analyse', '30')
    .action((opts) => {
      const days = Math.max(1, parseInt(opts.days as string, 10) || 30)
      const toolCounts = getOtherEventToolCounts(days)

      if (toolCounts.length === 0) {
        log.plain('No unclassified commands found in the last ' + days + ' days.')
        return
      }

      const manifest = readCachedManifest()
      if (!manifest) {
        log.plain('No manifest cached. Run workscribe profile list first.')
        return
      }

      const config = readConfig()
      const activeNames = new Set(config.capture.profiles)

      // Match tool counts against manifest keywords
      const suggestions: { entry: (typeof manifest)[number]; count: number }[] = []
      for (const entry of manifest) {
        if (activeNames.has(entry.name)) continue
        const matchedCount = toolCounts
          .filter((toolCount) =>
            entry.keywords.some((keyword) => toolCount.tool.toLowerCase().includes(keyword.toLowerCase()))
          )
          .reduce((total, toolCount) => total + toolCount.count, 0)
        if (matchedCount >= MIN_SUGGEST_COUNT) {
          suggestions.push({ entry, count: matchedCount })
        }
      }

      suggestions.sort((a, b) => b.count - a.count)

      if (suggestions.length === 0) {
        const activeEntries = manifest.filter((entry) => activeNames.has(entry.name))
        const isToolCoveredByActiveProfile = (tool: string) =>
          activeEntries.some((entry) =>
            entry.keywords.some((keyword) => tool.toLowerCase().includes(keyword.toLowerCase()))
          )
        const uncoveredTools = toolCounts.filter((toolCount) => !isToolCoveredByActiveProfile(toolCount.tool))

        if (uncoveredTools.length === 0) {
          log.plain('')
          log.plain('Your active profiles cover all unclassified commands.')
          log.plain(chalk.dim('  Future captures will be classified correctly.'))
          log.plain('')
        } else {
          log.plain('')
          log.plain('No profile matches found for your unclassified commands.')
          log.plain('')
          log.plain(chalk.dim('  Top unclassified tools:'))
          for (const { tool, count } of uncoveredTools.slice(0, 5)) {
            log.plain(chalk.dim(`    ${tool.padEnd(24)} ${count} event${count === 1 ? '' : 's'}`))
          }
          log.plain('')
          log.plain(chalk.dim('  Run workscribe events --category other to review them.'))
          log.plain('')
        }
        return
      }

      log.plain('')
      log.plain(chalk.bold(`  Analysed last ${days} days of unclassified commands:`))
      log.plain('')
      for (const { entry, count } of suggestions) {
        log.plain(
          `  ${chalk.cyan(entry.name.padEnd(18))} ${String(count).padStart(4)} commands  →  ${entry.displayName}`
        )
      }
      log.plain('')
      log.plain(
        `  Run: ${chalk.cyan('workscribe profile add ' + suggestions.map((suggestion) => suggestion.entry.name).join(' '))}`
      )
      log.plain('')

      const allCoveredEntries = [
        ...manifest.filter((entry) => activeNames.has(entry.name)),
        ...suggestions.map((suggestion) => suggestion.entry),
      ]
      const isToolCoveredAfterInstall = (tool: string) =>
        allCoveredEntries.some((entry) =>
          entry.keywords.some((keyword) => tool.toLowerCase().includes(keyword.toLowerCase()))
        )
      const stillUncovered = toolCounts.filter((toolCount) => !isToolCoveredAfterInstall(toolCount.tool)).slice(0, 5)
      if (stillUncovered.length > 0) {
        log.plain(chalk.dim('  Still uncovered after installing:'))
        for (const { tool, count } of stillUncovered) {
          log.plain(chalk.dim(`    ${tool.padEnd(24)} ${count} event${count === 1 ? '' : 's'}`))
        }
        log.plain('')
      }
    })
}
