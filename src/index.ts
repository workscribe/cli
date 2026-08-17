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

program.parse()
