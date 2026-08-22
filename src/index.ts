import { Command } from 'commander'
import { assertNodeVersion } from './utils/node-version'

assertNodeVersion(process.versions.node)
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
import { registerCompletions } from './cli/completions'
import { checkForUpdate } from './utils/update-check'

checkForUpdate()

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

program.parse()
