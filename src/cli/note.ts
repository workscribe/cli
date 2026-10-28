import { Command } from 'commander'
import { insertEvent } from '../db'
import { getRepoContext } from '../capture/git'
import { readConfig } from '../config'
import { currentDirectory } from '../utils/working-directory'
import { log } from '../utils/logger'

export function registerNote(program: Command): void {
  program
    .command('note <text>')
    .description('Attach a free-text annotation to the current session')
    .action((text: string) => {
      // As you reached it, like the shell hook's `$PWD`, so a `projects.<path>` override and `context` match it
      const directory = currentDirectory()
      const { repoName, branch } = getRepoContext(directory, readConfig())
      insertEvent({
        captured_at: new Date().toISOString(),
        command: 'workscribe note',
        cwd: directory,
        exit_code: null,
        duration_ms: null,
        repo_name: repoName,
        branch,
        category: 'note',
        metadata: JSON.stringify({ text }),
        source: null,
        file_path: null,
      })
      log.success(`Note saved${repoName ? ` to ${repoName}` : ''}`)
    })
}
