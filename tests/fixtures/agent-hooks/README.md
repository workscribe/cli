# Agent capture matrix

What each coding agent really sends to a hook, measured from real runs. Only measured facts go here, each with its tool
version. A surface that hasn't been run says so and makes no claims about what it sends.

Last run: 2026-11-06, on macOS, with shell hook v2 and the zsh hook installed.

## Surfaces

| Agent and surface | Status | Fixtures |
|---|---|---|
| Claude Code: edits and session events | Measured on 2.1.319 | `claude-code/2.1.319/` |
| Antigravity CLI (`agy`) | Measured on 1.5.0 | `antigravity/1.5.0/` |
| Antigravity IDE and 2.0 | Not run: not installed | None |
| Copilot in VS Code | Measured on built-in `copilot-chat` 0.57.0, VS Code 1.129.0 | `copilot-vscode/0.57.0/` |
| Copilot CLI | Not run: not installed | None |
| Cursor | Not run: not installed | None |
| Codex | Not run: not installed | None |
| Gemini CLI | Not run: not installed | None |

## Antigravity CLI 1.5.0

| Question | Measured |
|---|---|
| Hook events seen | `SessionStart`, `PreInvocation`, `PostToolUse`, `PostInvocation`, `Stop`. `PreToolUse` wasn't registered, because answering it overrides the permission mode |
| Config location | `.agents/hooks.json` in the workspace and `~/.gemini/config/hooks.json` both fire |
| Hook's own working folder | The folder holding `hooks.json`, so it says nothing about where the agent is working |
| Command field | `toolCall.args.CommandLine`, on tool `run_command` |
| Working folder | `workspacePaths` only. There's no `cwd`, and `args.Cwd` never appeared: the agent reported that the tool's schema rejects it, then used `cd <folder> && pwd` |
| Session id | `conversationId`, the same across `--continue`. Also in the environment as `ANTIGRAVITY_CONVERSATION_ID` |
| Duration | No field |
| Exit code | No field |
| Failure signal: command | **None.** `exit 3`, `exit 4`, `exit 5` and a rejected `git commit` all send `error: ""` |
| Failure signal: other tools | `error` holds a message when the tool call itself fails, such as editing a missing file |
| Edit tools | `edit_file` (`Path`, `Target`, `Replacement`), including a multi-line change in one call, and `write_file` (`Path`, `Content`, `Overwrite`) |
| New file | `write_file` sent `Overwrite: true` when replacing a file and left it out when creating one (one run of each). `edit_file` never creates one |
| Deleted file | No tool seen. `rm` arrives as a command |
| Reads | `read_file` also fires `PostToolUse`, so the matcher must list the tools wanted |
| User text and content to never store | `lastUserInput` on every event, plus `Content`, `Target` and `Replacement` on edits |
| Long commands | `PostToolUse` fires around when the command finishes, even when backgrounded (`command-background-exit-5`). A command still running when the session ends never fires it. `WaitMsBeforeAsync` is chosen per call. A `Stop` can arrive first with `fullyIdle: false`, so `Stop` doesn't mean the work is finished |
| Hook cost | Hooks block the agent: a 6 s sleep added about 7.5 s to the run |
| Hook timeout | With `timeout: 3` on a 12 s hook, no recording was written and the turn still succeeded. The default 30 s wasn't tested |
| Hook output | Empty output, and non-JSON output with exit 2, didn't break a turn |

### Overlap with other capture paths

- **Shell hook: none.** On hook v2, a marker command run by `agy` left no row, in an interactive session or in `-p` mode.
  In the same runs the shell hook recorded both launches, so it was working. `agy`'s terminal tool runs a non-interactive
  zsh (`$-` is `569X`, with no `i`), and `_workscribe_preexec` isn't loaded there. This restates the "0 events" finding in
  `docs/event-capture-and-ai-agent-review.md` for `agy` 1.5.0; the IDE and 2.0 are untested.
- **The launch itself** is recorded as the person's own command, with no source, and includes the whole `-p` prompt.
- **VS Code saves: none seen.** Two `edit_file` calls on a file open in a VS Code window, with the Workscribe extension
  running, left no save row. The extension recorded a real save from another window minutes earlier, but no save was
  tried by hand in that same window.

## Copilot in VS Code (`copilot-chat` 0.57.0)

| Question | Measured |
|---|---|
| Hook events seen | `sessionStart`, `userPromptSubmitted`, `PostToolUse`, `agentStop`. All payloads use the snake_case form. `PostToolUse` fired only from the PascalCase key: a `postToolUse` entry in the same file never fired. `postToolUseFailure`, `PostToolUseFailure` and `sessionEnd` were registered and never fired |
| Config location | `.github/hooks/*.json` in the workspace. `~/.copilot/hooks/` wasn't tested |
| Hook's own working folder | The workspace folder |
| Command field | `tool_input.command`, on tool `run_in_terminal` |
| Working folder | `cwd`, which is **the workspace folder, not where the shell is.** After `cd sub && true`, the terminal stayed in `sub` and `rm delete-me.txt` failed there, while the hook still sent the workspace folder |
| Session id | `session_id`, the same across all five prompts of one chat. VS Code's records show one chat session and one `session.start`, so **a second chat is unmeasured** |
| Harness | **Not confirmed.** Session Target was set to Copilot, but VS Code's chat record names `github.copilot.editsAgent`, and the docs give PascalCase names to the older Local harness. The other harness may behave differently |
| Duration | No field |
| Exit code | No field |
| Failure signal: command | **None as a field.** `tool_response` is raw terminal text. An exit code showed only because the user's shell prompt theme prints one, so it can't be relied on |
| Failure signal: edits | **None.** A failed edit of a missing file sent `PostToolUse` with `tool_response: ""`, the same as a successful edit |
| Edit tools | `replace_string_in_file` (`filePath`, `oldString`, `newString`), `multi_replace_string_in_file` (`replacements[]`), `create_file` (`filePath`, `content`) |
| New file | Yes: the tool is `create_file`. Asked to overwrite a file, the agent used `replace_string_in_file` |
| Deleted file | No tool seen. `rm` arrives as a command |
| Reads | `read_file` also fires `PostToolUse`, as does `kill_terminal` |
| User text and content to never store | `prompt` on `userPromptSubmitted`, `tool_response`, `explanation`, `goal`, plus `content`, `oldString` and `newString` on edits |
| Long commands | `PostToolUse` fires when the tool hands off to the background, not when the command ends (`command-moved-to-background`), so a backgrounded command's outcome never arrives. Typing "stop" in the chat made the agent call `kill_terminal`; the chat's stop button wasn't tested |
| Telling it from Copilot CLI | Candidates, not yet compared with the CLI: the `VSCODE_*` environment variables, tool names such as `run_in_terminal`, and `__vscode-` in `tool_use_id` |

### Overlap with other capture paths

- **Shell hook: yes, for every finished terminal command.** `run_in_terminal` uses an interactive terminal, so hook v2 stores
  a row with **no source, the real exit code and the shell's real folder.** That's the only place the exit code exists.
  - The shell row arrives first, by 5–8 s, so it falls outside `isDuplicate`'s 5 s window.
  - The stored command starts with a space (` rm delete-me.txt`).
  - `cd sub && true` left no row. `sleep 60`, killed while running, left none either.
- **VS Code saves: yes.** Each of the first three agent edits (`app.txt`, `multi.txt`, `created.txt`) stored a `vscode`
  `code_edit` row within about 0.15 s of its `PostToolUse`. A second edit of `created.txt` left no row at that moment. Rows
  for `app.txt` and `created.txt` appeared together about two minutes later, with no agent edit and no save by hand at the
  time, so the cause is unknown. The merge can't assume a save follows its edit at once.
- **Worth knowing:** a pending Workscribe alert is printed by the shell hook into the terminal, so it reached the agent in
  `tool_response` on every command.

## Claude Code 2.1.319: edits and session events

Bash payloads are in `tests/fixtures/claude-code-hooks/` (2.1.311, WOR-127). This run, with `claude -p
--setting-sources project` so only the scratch project's recorder hooks fired, covers the rest (WOR-136).

| Question | Measured |
|---|---|
| Edit tools | `Edit` (including `replace_all`), `Write` and `NotebookEdit`. **No `MultiEdit`**: asked for one, the agent reported it wasn't available and used two `Edit` calls |
| Line counts | `Edit` and `Write` send `tool_response.structuredPatch`, unified-diff hunks whose `+`/`-` lines give exact counts, a replace-all included. A `Write` of a new file sends `type: "create"` and an empty patch, so its lines come from `content`. `NotebookEdit` sends the cell's `old_source` and `new_source`, and no patch |
| Text to never store | `old_string`, `new_string`, `content`, `originalFile`, the patch's lines, and the notebook's `original_file`/`updated_file` |
| Failed edit | An `Edit` whose text wasn't found fired neither `PostToolUse` nor `PostToolUseFailure` |
| `Stop` | `last_assistant_message`, the turn's final reply, plus `stop_hook_active`, `background_tasks` and `session_crons` |
| `PostCompact` | `trigger` (`manual` for `/compact`) and `compact_summary`, about 3,000 characters with `<analysis>` and `<summary>` blocks. Recorded by resuming the session with `claude -p --resume <id> "/compact"` |
| `SessionEnd` | `reason`: `other` for both `-p` runs. An async `SessionEnd` hook that slept 2 s before recording still wrote its recording, about 2 s after the synchronous one, so it ran to the end. Interactive exits weren't tried |
| Session id | `session_id`, the same on edits, `Stop`, `PostCompact` and `SessionEnd`, and kept by `--resume` |

## Antigravity integration (WOR-161)

Built on the measurements above: `src/capture/hooks/antigravity.ts` installs one `PostToolUse` group per tool
(`run_command`, `edit_file`, `write_file`, each matched by exact name, since the hook doc's `a\|b` alternation example is
ambiguous) under a hook named `workscribe` in `~/.gemini/config/hooks.json`, with `timeout: 10`.

- **No recaps.** `Stop` carries `lastUserInput`, `terminationReason`, `fullyIdle` and a `transcriptPath`, but no reply
  text, and there is no `SessionEnd`. Reading the transcript file was decided against (WOR-161).
- **Not yet run on a real `agy` through the installed file.** The parser is tested against every fixture above, and the
  installer against a temp file; whether `agy` fires the three exact-name groups and accepts `timeout: 10` has not been
  confirmed on a real run, nor whether Antigravity IDE and 2.0 read `~/.gemini/config/hooks.json`.

## Summary for later tickets

**No failure signal in the payload (WOR-159):** Antigravity CLI for commands; Copilot in VS Code for commands and edits,
though its shell rows hold the real exit code. Surfaces not run are unknown: Antigravity IDE and 2.0, Copilot CLI, Cursor,
Codex, Gemini CLI.

**Overlaps to merge (WOR-160):**
- Copilot in VS Code's terminal commands with the shell hook. The shell row arrives first, and the merge must keep its exit
  code and folder and handle the leading space.
- Copilot in VS Code's edits with VS Code saves, including a save that comes later than the edit.
- None for Antigravity CLI. Surfaces not run are unknown, as above.

## Surfaces not run

Each still needs every scenario under [Repeating a run](#repeating-a-run), plus whether its shell tool triggers the shell
hook and whether its edits trigger a VS Code save.

| Surface | Hook docs | Also to settle |
|---|---|---|
| Antigravity IDE and 2.0 | https://antigravity.google/docs/hooks/ | Whether the IDE's terminal is interactive, unlike the CLI's |
| Copilot CLI | https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-hooks-reference | Whether it can be told apart from Copilot in VS Code: both docs name `~/.copilot/hooks/`, and no payload field names the host. Owner: WOR-162 |
| Cursor | https://cursor.com/docs/hooks, https://cursor.com/docs/reference/third-party-hooks | **Open:** whether it runs the imported `~/.claude/settings.json` hook. To settle it, run a marker command in Cursor, then check for a `claude-code` row and record the payload. Owners: WOR-140, WOR-160 |
| Codex | https://learn.chatgpt.com/docs/hooks | |
| Gemini CLI | https://geminicli.com/docs/hooks/reference/ | Its docs say: "Unpaid tier and Google One users: Gemini CLI was replaced by Antigravity CLI on June 18th, 2026." |

## Repeating a run

The recorder (`scripts/agent-capture/record-hook.js`) stands in for `workscribe _hook`, so a run adds nothing to the
database by itself.

1. Make a throwaway git repo with a rejecting `pre-commit` hook, a `sub` folder, and files to edit and delete.
2. Point the agent's workspace-level hooks at the recorder, passing the event name:
   ```sh
   WORKSCRIBE_CAPTURE_DIR=<scratch folder> <path to node> scripts/agent-capture/record-hook.js PostToolUse
   ```
3. Run the scenarios:
   - Commands: success, `sh -c 'exit 3'`, a rejected `git commit`, `cd sub && true`, a heredoc, a slow command, a
     backgrounded command, an interrupted command
   - Edits: edit a file, several changes in one call, create a file, overwrite a file, a failing edit, delete a file
   - Sessions: a second conversation, and continuing one
4. Use the least permission that runs them. For `agy -p`, `--mode auto` wasn't available on the account used, so a
   session-only `--settings` file listed the exact commands. Avoid words like "hook test" in prompts: one run made the
   agent go off and read the hook docs.
5. Check for overlaps from a real interactive terminal, with a unique marker command per mode. Keep the launch rows: they
   prove the shell hook was working. Quit the agent first, because the launch row only appears at the next prompt.
6. Read the real database from a temporary copy of `workscribe.db` and its `-wal` and `-shm` files, then delete the copy.
   `sqlite3 -readonly` failed here with "unable to open database file", and `immutable=1` can miss recent rows. A coding
   agent's own commands also add rows if its hook is installed, so look at each new row's source, not just the count.
7. Turn recordings into fixtures, then read each one before committing:
   ```sh
   node scripts/agent-capture/sanitize-fixture.js <recording.json> <scratch folder> <source>/<version>/<scenario>.json
   ```

## Adding an agent's integration

1. Add its `hook` value to `src/config/ai-tools.json` (the value is the `--source` its events are stored under).
2. Write `src/capture/hooks/<agent>.ts`: an `AIHookIntegration` with `parse(raw, event)` returning one `HookEvent`
   (`src/capture/hooks/event.ts`) or null, `install` / `uninstall` / `checkHealth` over its settings file (use
   `config-file.ts` and `hook-command.ts`: unparseable files are left alone, existing ones backed up, hooks recognised
   with `isWorkscribeHook`), and `settingsPath` for messages.
3. Register it in `src/capture/hooks/index.ts`. `_hook`, `init`, `status` and `uninstall` pick it up from there.
4. Pin its payloads as fixtures here, and test `parse` over them.
5. Give a command an outcome from what the payload really says: an exit code, `{ kind: 'failed' }` (stored as `-1`)
   when it only says the command failed, otherwise `{ kind: 'unknown' }`. If the payload has no failure signal for
   commands, set `checksCommits: true` so a `git commit` is compared with `HEAD`.
