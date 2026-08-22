import { Command } from 'commander'
import fs from 'fs'
import os from 'os'
import path from 'path'
import chalk from 'chalk'
import { WORKSCRIBE_DIR, DEBUG_LOG_PATH, CONFIG_PATH } from '../utils/paths'
import { readConfig } from '../config'
import { log } from '../utils/logger'

declare const __WORKSCRIBE_VERSION__: string

const GITHUB_ISSUES_URL = 'https://github.com/workscribe/workscribe/issues/new'
const DEBUG_LOG_TAIL_LINES = 100

function tailFile(filePath: string, lines: number): string {
  if (!fs.existsSync(filePath)) return '(no debug log found — set WORKSCRIBE_DEBUG=1 to enable)'
  const content = fs.readFileSync(filePath, 'utf-8')
  const allLines = content.split('\n')
  return allLines.slice(-lines).join('\n')
}

function redactConfig(): string {
  try {
    const config = readConfig()
    if (config.ai.apiKey) config.ai.apiKey = '<redacted>'
    if (config.integrations?.slackWebhook) config.integrations.slackWebhook = '<redacted>'
    if (config.integrations?.webhook) config.integrations.webhook = '<redacted>'
    return JSON.stringify(config, null, 2)
  } catch {
    return '(could not read config)'
  }
}

export function registerBugReport(program: Command): void {
  program
    .command('bug-report')
    .description('Generate a diagnostic report for filing a bug')
    .action(() => {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const reportPath = path.join(WORKSCRIBE_DIR, `bug-report-${timestamp}.txt`)

      const systemInfo = [
        `Workscribe version : ${__WORKSCRIBE_VERSION__}`,
        `Node.js version    : ${process.version}`,
        `Platform           : ${process.platform}`,
        `Architecture       : ${process.arch}`,
        `OS release         : ${os.release()}`,
        `Config path        : ${CONFIG_PATH}`,
        `Data directory     : ${WORKSCRIBE_DIR}`,
      ].join('\n')

      const report = [
        '=== Workscribe Bug Report ===',
        `Generated: ${new Date().toISOString()}`,
        '',
        '--- System ---',
        systemInfo,
        '',
        '--- Config (secrets redacted) ---',
        redactConfig(),
        '',
        `--- Debug log (last ${DEBUG_LOG_TAIL_LINES} lines) ---`,
        tailFile(DEBUG_LOG_PATH, DEBUG_LOG_TAIL_LINES),
      ].join('\n')

      try {
        if (!fs.existsSync(WORKSCRIBE_DIR)) {
          fs.mkdirSync(WORKSCRIBE_DIR, { recursive: true, mode: 0o700 })
        }
        fs.writeFileSync(reportPath, report, { mode: 0o600 })
      } catch (error) {
        log.error(`Could not write report: ${(error as Error).message}`)
        process.exit(1)
      }

      const params = new URLSearchParams({
        title: `Bug report — workscribe ${__WORKSCRIBE_VERSION__}`,
        body: `<!-- Attach ${path.basename(reportPath)} or paste the relevant sections below -->\n\n**Describe the issue:**\n\n**Steps to reproduce:**\n\n**Expected behaviour:**`,
      })

      log.success(`Report written to: ${chalk.cyan(reportPath)}`)
      log.plain('')
      log.plain(`  Open a GitHub issue:`)
      log.plain(`    ${chalk.cyan(`${GITHUB_ISSUES_URL}?${params}`)}`)
      log.plain('')
      log.plain(chalk.dim(`  Attach the report or paste the relevant sections into the issue.`))
      log.plain('')
    })
}
