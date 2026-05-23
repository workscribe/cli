import { Command } from 'commander'
import chalk from 'chalk'
import { readConfig, writeConfig, getConfigValue, setConfigValue } from '../config'
import { log } from '../utils/logger'

export function registerConfig(program: Command): void {
  const configCmd = program
    .command('config')
    .description('View or update Chronicle configuration')
    .action(() => {
      const config = readConfig()
      log.plain('')
      log.plain(chalk.bold('  Chronicle Config'))
      log.plain('')
      printConfig(config, '  ')
      log.plain('')
    })

  configCmd
    .command('set <key> <value>')
    .description('Set a config value (e.g. chronicle config set ai.provider anthropic)')
    .action((key: string, value: string) => {
      const config = readConfig()
      const updated = setConfigValue(config, key, value)
      writeConfig(updated)
      log.success(`Set ${chalk.cyan(key)} = ${chalk.yellow(value)}`)
    })

  configCmd
    .command('get <key>')
    .description('Get a config value')
    .action((key: string) => {
      const config = readConfig()
      const value = getConfigValue(config, key)
      if (value === undefined) {
        log.warn(`Key not found: ${key}`)
      } else {
        log.plain(String(value))
      }
    })
}

function printConfig(obj: unknown, indent: string): void {
  if (typeof obj !== 'object' || obj === null) return
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      log.plain(`${indent}${chalk.bold(key)}:`)
      printConfig(value, indent + '  ')
    } else {
      const display = Array.isArray(value)
        ? `[${(value as unknown[]).join(', ')}]`
        : String(value) || chalk.dim('(not set)')
      log.plain(`${indent}${chalk.dim(key)}: ${chalk.yellow(display)}`)
    }
  }
}
