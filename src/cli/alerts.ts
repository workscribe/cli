import { Command } from 'commander'
import chalk from 'chalk'
import { getPendingAlerts, clearAlerts, hasPendingAlerts } from '../db/alerts'
import { log } from '../utils/logger'

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function registerAlerts(program: Command): void {
  const alertsCmd = program
    .command('alerts')
    .description('Show and manage security alerts from AI session monitoring')
    .option('--check', 'Print warning if alerts are pending (used by shell hooks)')
    .action((opts: { check?: boolean }) => {
      if (opts.check) {
        if (hasPendingAlerts()) {
          log.plain(
            chalk.yellow('  [workscribe] Possible credentials detected in an AI session.') +
              chalk.dim('  Run workscribe alerts for details.')
          )
        }
        return
      }

      const alerts = getPendingAlerts()
      if (alerts.length === 0) {
        log.plain('')
        log.plain('  No pending security alerts.')
        log.plain('')
        return
      }

      log.plain('')
      log.plain(chalk.bold('  Security Alerts') + chalk.dim(`  (${alerts.length} pending)`))
      log.plain('')

      for (const alert of alerts) {
        log.plain(`  ${chalk.yellow('!')}  ${chalk.dim(formatTimestamp(alert.created_at))}  ${chalk.cyan(alert.tool)}`)
        log.plain(`     ${alert.context}`)
        if (alert.session_id) log.plain(`     ${chalk.dim('Session: ' + alert.session_id)}`)
        log.plain('')
      }

      log.plain(chalk.dim('  Run workscribe alerts clear  to dismiss all alerts'))
      log.plain('')
    })

  alertsCmd
    .command('clear')
    .description('Dismiss all pending security alerts')
    .action(() => {
      const count = clearAlerts()
      if (count === 0) {
        log.plain('  No pending alerts to clear.')
      } else {
        log.plain(`  ${count} alert${count === 1 ? '' : 's'} cleared.`)
      }
    })
}
