import { Command } from 'commander'
import chalk from 'chalk'
import { readConfig, writeConfig, getConfigValue, setConfigValue } from '../config'
import { log } from '../utils/logger'

export function registerConfig(program: Command): void {
  const configCmd = program
    .command('config')
    .description('View or update Workscribe configuration')
    .action(() => {
      const config = readConfig()
      log.plain('')
      log.plain(chalk.bold('  Workscribe Config'))
      log.plain('')
      printConfig(config, '  ')
      log.plain('')
    })

  configCmd
    .command('set <key> <value>')
    .description('Set a config value (e.g. workscribe config set ai.provider anthropic)')
    .action((key: string, value: string) => {
      const config = readConfig()
      const updated = setConfigValue(config, key, value)
      writeConfig(updated)
      const isSensitive =
        key === 'ai.apiKey' ||
        key.toLowerCase().includes('key') ||
        key.toLowerCase().includes('secret') ||
        key.toLowerCase().includes('token')
      const displayValue = isSensitive ? '[set]' : chalk.yellow(value)
      log.success(`Set ${chalk.cyan(key)} = ${displayValue}`)
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
        const lastSegment = key.split('.').pop() ?? ''
        if (SENSITIVE_KEYS.has(lastSegment) && typeof value === 'string' && value.length > 0) {
          log.plain(`${value.slice(0, 4)}${'*'.repeat(8)} (${value.length} chars)`)
        } else {
          log.plain(String(value))
        }
      }
    })
}

const SENSITIVE_KEYS = new Set([
  'apiKey',
  'api_key',
  'secret',
  'token',
  'password',
  'passwd',
  'webhook',
  'slackWebhook',
])

function maskValue(key: string, value: unknown): string {
  if (SENSITIVE_KEYS.has(key) && typeof value === 'string' && value.length > 0) {
    return chalk.dim(`${value.slice(0, 4)}${'*'.repeat(8)} (${value.length} chars)`)
  }
  if (Array.isArray(value)) return `[${(value as unknown[]).join(', ')}]`
  return String(value) || chalk.dim('(not set)')
}

function printConfig(obj: unknown, indent: string): void {
  if (typeof obj !== 'object' || obj === null) return
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      log.plain(`${indent}${chalk.bold(key)}:`)
      printConfig(value, indent + '  ')
    } else {
      log.plain(`${indent}${chalk.dim(key)}: ${chalk.yellow(maskValue(key, value))}`)
    }
  }
}
