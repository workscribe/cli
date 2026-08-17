import { Command } from 'commander'
import { insertEvent } from '../db'
import { getGitContext } from '../capture/git'
import { log } from '../utils/logger'

export function registerNote(program: Command): void {
  program
    .command('note <text>')
    .description('Attach a free-text annotation to the current session')
    .action((text: string) => {
      const { repoName, branch } = getGitContext(process.cwd())
      insertEvent({
        captured_at: new Date().toISOString(),
        command: 'workscribe note',
        cwd: process.cwd(),
        exit_code: null,
        duration_ms: null,
        repo_name: repoName,
        branch,
        category: 'note',
        metadata: JSON.stringify({ text }),
      })
      log.success(`Note saved${repoName ? ` to ${repoName}` : ''}`)
    })
}
