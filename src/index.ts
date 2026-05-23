import { Command } from 'commander'
import { registerCapture } from './cli/capture'
import { registerInit } from './cli/init'
import { registerStatus } from './cli/status'
import { registerEvents } from './cli/events'
import { registerSessions } from './cli/sessions'
import { registerSummary } from './cli/summary'
import { registerExport } from './cli/export'
import { registerConfig } from './cli/config'

const program = new Command()

program
  .name('chronicle')
  .description('Automatic developer work journal')
  .version('0.1.0')

registerCapture(program)
registerInit(program)
registerStatus(program)
registerEvents(program)
registerSessions(program)
registerSummary(program)
registerExport(program)
registerConfig(program)

program.parse()
