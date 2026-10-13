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
import { registerUndo } from './cli/undo'
import { registerClear } from './cli/clear'
import { registerUninstall } from './cli/uninstall'
import { registerProfile } from './cli/profile'
import { registerNote } from './cli/note'
import { registerWeek } from './cli/week'
import { registerBugReport } from './cli/bug-report'
import { registerCompletions, shouldRunStartupChecks } from './cli/completions'
import { registerAlerts } from './cli/alerts'
import { registerContext } from './cli/context'
import { checkForUpdate, pingTelemetry } from './utils/update-check'
import { ensureTelemetryFallback } from './config'
import { log } from './utils/logger'

const invokedCommand = process.argv[2]
if (shouldRunStartupChecks(invokedCommand)) {
  checkForUpdate()
  // init handles its own telemetry disclosure via an interactive prompt —
  // the silent fallback is only for users who skip init entirely. Must run
  // before pingTelemetry() — otherwise a user's very first command would
  // generate the installId but the ping already read the old empty config
  // moments earlier, delaying the first ping to the next invocation.
  if (invokedCommand !== 'init') {
    ensureTelemetryFallback()
  }
  pingTelemetry()
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
