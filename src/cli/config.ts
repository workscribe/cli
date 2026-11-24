import { Command } from 'commander'
import chalk from 'chalk'
import { readConfig, writeConfig, getConfigValue, setConfigValue } from '../config'
import { REMOVED_AI_SETTING_MESSAGE, isRemovedAiSetting } from '../summary/legacy-ai'
import { REMOVED_TELEMETRY_SETTING_MESSAGE, isRemovedTelemetrySetting } from '../config/removed-settings'
import { log } from '../utils/logger'
import { getDb } from '../db'
import { requestTicketRelink } from '../db/jobs/ticket-refs'
import { ticketPatternProblem } from '../capture/tickets'
import { clearAgentMessages } from '../db/agent-sessions'
import { applyRetentionSetting, isRetentionKey, RETENTION_KEEP_FOREVER_KEY } from '../config/retention'
import { setKeepForeverMirror, setLimitsSnapshot } from '../db/retention-state'

const TICKET_PATTERN_KEY = 'tickets.pattern'
const AGENT_MESSAGES_KEY = 'capture.agentMessages'

/**
 * Sets the ticket pattern: the database first — the pattern the history is linked with, and a restart of the
 * `ticket-refs` job — so a locked database refuses before config.json changes. Stored as the string it is: going
 * through setConfigValue would turn a pattern like `123` into a number.
 */
function setTicketPattern(pattern: string): void {
  const problem = ticketPatternProblem(pattern)
  if (problem) {
    log.error(`That ticket pattern can't be used: ${problem}.`)
    process.exit(1)
  }
  requestTicketRelink(getDb(), pattern)
  const config = readConfig()
  writeConfig({ ...config, tickets: { ...config.tickets, pattern } })
  log.success(`Set ${chalk.cyan(TICKET_PATTERN_KEY)} = ${chalk.yellow(pattern)}`)
  log.plain(
    chalk.dim(
      '  New captures use it now; your history is re-linked the next time a data command runs (or: workscribe upgrade).'
    )
  )
}

/**
 * Sets one `retention.*` value, strictly: nothing is coerced, so `retention.days ""` or `retention.keepForever yes` is
 * refused instead of becoming 0 or a string. Keeping everything is also written to the database, ahead of config.json,
 * so a config file that is later damaged or deleted still can't lead to removal (WOR-179).
 */
function setRetentionSetting(key: string, value: string): void {
  const config = readConfig()
  const result = applyRetentionSetting(config.retention, key, value)
  if (!result.ok) {
    log.error(result.message)
    process.exit(1)
  }
  if (key === RETENTION_KEEP_FOREVER_KEY) setKeepForeverMirror(getDb(), result.retention.keepForever)
  else setLimitsSnapshot(getDb(), result.retention)
  writeConfig({ ...config, retention: result.retention })
  log.success(`Set ${chalk.cyan(key)} = ${chalk.yellow(value)}`)
}

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
    .description('Set a config value (e.g. workscribe config set session.idleTimeout 45)')
    .action((key: string, value: string) => {
      // Checked before reading or writing, so a refused key never touches config.json
      if (isRemovedAiSetting(key)) {
        log.error(REMOVED_AI_SETTING_MESSAGE)
        process.exit(1)
      }
      if (isRemovedTelemetrySetting(key)) {
        log.error(REMOVED_TELEMETRY_SETTING_MESSAGE)
        process.exit(1)
      }
      if (key === TICKET_PATTERN_KEY) {
        setTicketPattern(value)
        return
      }
      if (isRetentionKey(key)) {
        setRetentionSetting(key, value)
        return
      }
      const config = readConfig()
      const updated = setConfigValue(config, key, value)
      // Turning the agent's words off forgets the ones kept. The database first, so a locked one leaves the setting on
      if (key === AGENT_MESSAGES_KEY && updated.capture.agentMessages === false) clearAgentMessages(getDb())
      writeConfig(updated)
      const isSensitive =
        key.toLowerCase().includes('key') || key.toLowerCase().includes('secret') || key.toLowerCase().includes('token')
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
