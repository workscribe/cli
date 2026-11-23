import { Command } from 'commander'
import { registerCapture } from './cli/capture'
import { registerHook } from './cli/hook'

declare const __WORKSCRIBE_VERSION__: string
import { registerInit } from './cli/init'
import { registerStatus } from './cli/status'
import { registerEvents } from './cli/events'
import { registerSessions } from './cli/sessions'
import { registerSummary } from './cli/summary'
import { registerExport } from './cli/export'
import { registerConfig } from './cli/config'
import { registerPause } from './cli/pause'
import { registerExclude } from './cli/exclude'
import { registerUndo } from './cli/undo'
import { registerClear } from './cli/clear'
import { registerUninstall } from './cli/uninstall'
import { registerProfile } from './cli/profile'
import { registerNote } from './cli/note'
import { registerWeek } from './cli/week'
import { registerBugReport } from './cli/bug-report'
import { registerCompletions, shouldRunDataJobs, shouldRunStartupChecks } from './cli/completions'
import { registerUpgrade } from './cli/upgrade'
import { runDataJobsBeforeCommand } from './cli/data-jobs'
import { runRetentionBeforeCommand } from './cli/retention-run'
import { registerAlerts } from './cli/alerts'
import { registerContext } from './cli/context'
import { registerHistory } from './cli/history'
import { registerSkill } from './cli/skill'
import { checkForUpdate } from './utils/update-check'
import { log } from './utils/logger'

const invokedCommand = process.argv[2]
if (shouldRunStartupChecks(invokedCommand)) {
  checkForUpdate()
}

// Before a data command people typed: record the version and give pending data jobs a short budget (never in the
// background capture, the editor's `context` calls or the agent skill's `sessions` calls — see shouldRunDataJobs)
if (shouldRunDataJobs(process.argv.slice(2))) {
  runDataJobsBeforeCommand(invokedCommand, __WORKSCRIBE_VERSION__)
  // `upgrade` runs its own jobs, and then the removal (src/cli/upgrade.ts), so the removal never gets ahead of them
  if (invokedCommand !== 'upgrade') runRetentionBeforeCommand()
}

const program = new Command()

program.name('workscribe').description('Automatic developer work journal').version(__WORKSCRIBE_VERSION__)

registerCapture(program)
registerHook(program)
registerInit(program)
registerStatus(program)
registerEvents(program)
registerSessions(program)
registerSummary(program)
registerExport(program)
registerConfig(program)
registerPause(program)
registerExclude(program)
registerUndo(program)
registerClear(program)
registerUninstall(program)
registerProfile(program)
registerNote(program)
registerWeek(program)
registerBugReport(program)
registerCompletions(program)
registerAlerts(program)
registerContext(program)
registerHistory(program)
registerSkill(program)
registerUpgrade(program)

// parseAsync (not parse) so a throw from either a sync or an async action
// handler — e.g. getDb() failing to create its data directory — surfaces
// here as a rejection instead of either an uncaught-exception stack trace
// (sync actions) or an unhandled-rejection crash (async actions). _capture
// and _hook already catch everything internally and never throw this far,
// so this only ever engages for explicit user commands.
program.parseAsync().catch((error: unknown) => {
  log.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
