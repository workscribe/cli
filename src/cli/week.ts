import { Command } from 'commander'
import { readConfig } from '../config'
import { runWeeklySummary, type WeeklySummaryOptions } from '../summary/weekly'
import { createSummaryWriter } from '../summary/writer'
import { printLegacyAiNotice } from './notices'
import { loadDayThreads, requireThreadData } from './thread-day'
import { fail } from './fail'
import type { WeekLayout } from '../ai/types'

const WEEK_LAYOUTS: readonly WeekLayout[] = ['project', 'day']

/** `--by`, which both `week` and `summary --week` take. */
export function addWeekLayoutOption(command: Command): Command {
  return command.option('--by <layout>', 'lay the week out by project then branch (default), or by day')
}

function parseWeekLayout(value: string | undefined): WeekLayout {
  if (value === undefined) return 'project'
  const layout = WEEK_LAYOUTS.find((candidate) => candidate === value)
  if (!layout) fail('--by must be project or day')
  return layout
}

/** `week` and `summary --week`: one handler, so both print the same thing for the same options. */
export async function runWeekCommand(options: Omit<WeeklySummaryOptions, 'by'> & { by?: string }): Promise<void> {
  const by = parseWeekLayout(options.by)
  const config = readConfig()
  printLegacyAiNotice(config)
  requireThreadData()
  try {
    await runWeeklySummary({
      options: { ...options, by },
      config,
      provider: createSummaryWriter(config),
      loadDay: loadDayThreads,
    })
  } catch (error) {
    fail((error as Error).message)
  }
}

export function registerWeek(program: Command): void {
  const weekCommand = program
    .command('week')
    .description('Summarize the current week (Mon–today) — the same as summary --week')
    .option('--fresh', 'accepted for 1.x scripts — the week is always rendered fresh')
    .option('--slack', 'post to Slack webhook from config')
    .option('--webhook <url>', 'post to a custom webhook URL')
  addWeekLayoutOption(weekCommand).action(runWeekCommand)
}
