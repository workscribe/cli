---
title: Commands
description: Full reference for all Workscribe CLI commands.
---

# Commands

## workscribe init

Set up Workscribe and install or update shell hooks.

```bash
workscribe init
```

Safe to re-run at any time — installs missing hooks, updates outdated ones, and skips everything already up to date.

**What it does:**
- Creates `~/.workscribe/` with owner-only permissions
- Initialises the SQLite database
- Installs or updates the shell hook in `~/.zshrc` or `~/.bashrc`
- Installs shell completions, and rewrites the completion script on every run, so deleting the data folder doesn't break them. If your rc file has completions from Workscribe 2.0.0 or earlier, which print an error once the script is gone, offers to update them — defaults to yes
- Detects installed AI coding tools (Claude Code, Aider, etc.) and offers to install a session capture hook for each — opt-in, defaults to no. If a hook is already there but outdated (from an older version, or pinned to a Node.js version that's since been removed), offers to update it instead — defaults to yes, since you opted in before
- Detects coding agents (Claude Code, Codex, GitHub Copilot, Cursor) and offers to install the [Workscribe agent skill](#agent-skill) for each — defaults to yes, and only asks when the skill is missing or outdated
- If your config still has AI provider settings from Workscribe 1.x (including an API key), offers to remove them — 2.0 doesn't use them

**Shell hook updates:**

When a new version of Workscribe ships with an updated hook, re-running `workscribe init` detects the change and prompts you to update. Your rc file is backed up before any modification — the same goes for the completions block and `~/.claude/settings.json`.

---

## workscribe summary

Generate a work summary for today or a specific date with Workscribe's offline template engine. A session your coding agent already summarized with the [agent skill](#agent-skill) shows that summary instead. See [Summaries](/summaries).

```bash
workscribe summary
workscribe summary --date 2026-05-20
workscribe summary --week
workscribe summary --fresh
workscribe summary --slack
workscribe summary --webhook <url>
```

| Option | Description |
|---|---|
| `--date <YYYY-MM-DD>` | Summarise a specific date instead of today |
| `--week` | Summarise Mon–today for the current week |
| `--fresh` | Ignore saved summaries and render the template for every session |
| `--verbose` | Show all captured events, including those left out of the summary |
| `--slack` | Post the summary to your configured Slack webhook |
| `--webhook <url>` | Post the summary to a custom webhook URL |

**Slack setup:**

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name your app, select your workspace, and click **Create App**
3. In the left sidebar under **Features**, click **Incoming Webhooks**
4. Toggle **Activate Incoming Webhooks** to On
5. Click **Add New Webhook to Workspace**, choose a channel, and click **Allow**
6. Copy the webhook URL and configure workscribe:

```bash
workscribe config set integrations.slackWebhook https://hooks.slack.com/services/...
```

Works on all Slack plans including free. No admin role required — any workspace member can create an app.

Then run `workscribe summary --slack` to post. The summary is automatically formatted for Slack — headings are bolded and bullets are converted to `•`. Your OS username is prepended to the message so recipients know who sent it in shared channels.

**Output format:**

```
## api (main, feat/auth) — 2h 15m
- Note: blocked on staging credentials
On main:
- Committed: fix: token refresh race
- Tests now passing
On feat/auth:
- Committed: feat: add auth middleware
- Added dependencies: bcrypt
- Pushed to origin/feat/auth
With an AI coding assistant (126 commands) · 3 file saves in the editor
```

Each session gets its own heading, always generated from your captured data: the project, every branch the session touched (in the order you worked on them), and the duration. When a session spans several branches, its work is grouped under a plain `On <branch>:` line for each, so you can see what happened where. Commits come from what Workscribe captured and from `git log` in the session's repo (your commits only, looked up within 3 seconds per run). The last line sums up how you worked: commands your coding agent ran, and files saved in the editor.

**Saved summaries:**
- A summary the agent skill saved for a session is shown instead of the template
- Summaries an AI provider wrote in Workscribe 1.x are still shown for their sessions
- Template summaries are rendered fresh every time and never stored
- Use `--fresh` to render the template for every session, ignoring saved summaries for that run

---

## workscribe week

Generate a weekly digest covering Monday through today with the offline template engine (up to 5 bullets per day). Digests are rendered fresh every time.

```bash
workscribe week
workscribe week --fresh
workscribe week --slack
workscribe week --webhook <url>
```

| Option | Description |
|---|---|
| `--fresh` | Accepted for 1.x scripts — digests are always rendered fresh |
| `--slack` | Post the digest to your configured Slack webhook |
| `--webhook <url>` | Post the digest to a custom webhook URL |

The natural pre-standup ritual for Monday morning or end-of-week reporting. Output is markdown grouped by day, with up to 5 bullets per day, each prefixed with the project it happened in.

**Slack:**

Configure your webhook first:

```bash
workscribe config set integrations.slackWebhook https://hooks.slack.com/services/...
```

Then run `workscribe week --slack` to post. See [workscribe summary](#workscribe-summary) for full Slack setup instructions.

---

## workscribe sessions

List detected work sessions for a date.

```bash
workscribe sessions
workscribe sessions --date 2026-05-20
workscribe sessions --json | jq .
```

| Option | Description |
|---|---|
| `--date <YYYY-MM-DD>` | Show sessions for a specific date |
| `--json` | Print the [JSON output contract](#json-output-contract) — sessions with their events, notes and commits |

Sessions are computed by grouping events with idle gaps greater than `session.idleTimeout` (default 30 minutes) and splitting across different repositories.

### workscribe sessions summary set

Save a summary for one session. This is how the [Workscribe agent skill](#agent-skill) saves what it wrote; you can use it from scripts too. The summary text is read from stdin.

```bash
workscribe sessions summary set --key 'api|2026-10-25T09:00:00.000Z' <<'EOF'
## api (feature/auth) — 1h 30m
- Fixed the token refresh race in the auth middleware (a1b2c3d)
EOF
```

| Option | Description |
|---|---|
| `--key <key>` | The session's `key` from `workscribe sessions --json` (required) |

- The text must be non-empty and at most 8 KB. Secrets are redacted before it's stored, using the same rules as captured commands (including `redact.extra`).
- Saving again for the same session replaces the earlier summary.
- If the key no longer matches a session (new activity can regroup a day), run `workscribe sessions --json` again and use the new key.
- A saved summary is what `workscribe summary`, `workscribe context` and the VS Code status bar show for that session. `workscribe summary --fresh` renders the template for that run only; the saved summary stays until the skill (or this command) saves a new one. Saved summaries are per session, so weekly digests (`summary --week`, `week`) don't use them.

### Agent skill

Workscribe ships an Agent Skill (the open `SKILL.md` format several coding agents support) so the coding agent you already use can write your summaries. It isn't a command you type: inside the agent, ask in plain language — *"summarize my work today"*, *"write my standup"*, *"what did I do this week?"* — or, in Claude Code, type `/workscribe`. The agent reads `workscribe sessions --json`, writes one summary per session and saves it with `workscribe sessions summary set`.

`workscribe init` offers to install the skill for each coding agent it finds. To install or update it later, run [`workscribe skill install`](#workscribe-skill), then restart any agent that's already open.

Without a coding agent nothing changes — `workscribe summary` keeps working with its offline template engine. Running the skill sends your session data to the agent's model provider; see [Privacy](/privacy).

---

## workscribe skill

Install, check and remove the [Workscribe agent skill](#agent-skill) in your coding agents.

```bash
workscribe skill install                      # every detected agent
workscribe skill install --agent claude-code  # just one (or several: --agent codex cursor)
workscribe skill status
workscribe skill uninstall
```

| Option | Description |
|---|---|
| `--agent <ids...>` | Limit to these agents: `claude-code`, `codex`, `copilot`, `cursor` (`install` and `uninstall`) |
| `--force` | Replace a `workscribe` skill folder that Workscribe didn't install (`install` only) |

**Where the skill goes** — each agent's personal skills folder:

| Agent | Folder | Detected by |
|---|---|---|
| Claude Code | `~/.claude/skills/workscribe` | `~/.claude` or the `claude` command |
| Codex | `~/.agents/skills/workscribe` | `~/.codex` or the `codex` command |
| GitHub Copilot | `~/.agents/skills/workscribe` | `~/.copilot`, the `copilot` command, or the Copilot Chat VS Code extension |
| Cursor | `~/.cursor/skills/workscribe` | `~/.cursor`, or the `cursor` / `cursor-agent` command |

Codex and GitHub Copilot read the same folder, so they share one copy.

**How it behaves:**
- `install` is safe to re-run: an up-to-date copy is left alone and an older one is replaced. The new copy is put in place in one step, so an interrupted install never leaves a half-written skill.
- Each copy Workscribe installs has a `.workscribe-skill.json` marker recording its version. A `workscribe` folder without that marker is yours, so `install` skips it (unless `--force`) and `uninstall` never touches it.
- `status` lists every supported agent as not detected, not installed, installed, outdated, or "a different workscribe skill is there", with the command that fixes it.
- Installed skills aren't updated automatically when you upgrade the CLI — `workscribe status` flags an outdated copy, and `workscribe skill install` (or `workscribe init`) refreshes it.

**Whose activity gets captured:** the skill works the same in every agent — it summarizes whatever Workscribe captured — but how much of the agent's own work is captured differs:
- **Claude Code**: its commands are captured through the Claude Code session hook (`workscribe init` offers it), with each command's exit code — so summaries can say whether the tests and builds it ran passed. A hook installed by an earlier version doesn't capture failed commands at all; `workscribe init` offers to update it.
- **GitHub Copilot and Cursor**: their agents run commands in the VS Code or Cursor integrated terminal, so the shell hook most likely captures them.
- **Codex**: it runs commands in its own process, so only launching `codex` is recorded.

**Which repo a command counts towards:** the one it worked in. `git -C ../web commit` and `git --work-tree=…` credit the commit to `web`, not the folder the command was typed in. A `cd` counts too, because the shell (or Claude Code) reports the folder it ended up in — with one exception: Claude Code resets a `cd` that leaves its project, so `cd ../web && git commit` run by Claude Code from outside `web`'s project is still credited to the project's folder. Commit messages are read from `-m`, `-am`, `--message=`, `-F <file>` and the `-m "$(cat <<'EOF' …)"` form coding agents use; package names from npm, pnpm, yarn and bun installs, including `--filter` and `yarn workspace` forms.

---

## workscribe events

List raw captured events for a date.

```bash
workscribe events
workscribe events --date 2026-05-20
workscribe events --limit 20
workscribe events --json
```

| Option | Description |
|---|---|
| `--date <YYYY-MM-DD>` | Show events for a specific date |
| `--limit <n>` | Limit the number of events shown |
| `--json` | Print the [JSON output contract](#json-output-contract) — structured events, no raw commands |

Events are colour-coded by category:

| Category | Colour | Examples |
|---|---|---|
| `code_commit`, `code_push`, `code_merge` | green | `git commit`, `git push` |
| `code_pull`, `branch_switch`, `code_stash` | blue | `git pull`, `git checkout` |
| `test_run` | magenta | `npm test`, `npx vitest`, `pytest` |
| `build` | cyan | `npm run build`, `npx tsc`, `cargo build` |
| `dependency_install`, `dependency_remove`, `file_ops` | yellow | `npm install`, `rm`, `mkdir` |
| `lint_run` | yellow | `npx eslint`, `npx prettier` |
| `server_run` | cyan | `npm run dev`, `yarn start` |
| `infrastructure` | red | `kubectl`, `docker`, `terraform` |
| `script_run` | white | `npx husky`, `bash deploy.sh` |
| `ai_session` | bold magenta | Claude Code, Cursor, Copilot |
| `code_search`, `code_read` | dim | `grep`, `cat`, `find` |
| `environment`, `git_other`, `other` | gray | `export`, `git status` |

---

## workscribe note

Attach a free-text annotation to the current session.

```bash
workscribe note "Fixed race condition in auth middleware"
workscribe note "Blocked by infra outage — picked up again after lunch"
```

The note is stored as an event in the database, timestamped now, and associated with the current git repo and branch. It groups into whatever session covers its timestamp when sessions are rebuilt.

**Where notes appear:**

- `workscribe sessions` — displayed indented under the matching session
- `workscribe summary` and `workscribe week` — shown first in the session's bullets, so the summary explains the why behind the work
- `workscribe sessions --json` — included for the agent skill, which uses them the same way

**Removing a note:**

Notes are events. Use `workscribe undo` to remove the most recently added note.

---

## workscribe undo

Remove the last N captured events.

```bash
workscribe undo
workscribe undo -n 5
workscribe undo --dry-run
workscribe undo -n 3 --dry-run
```

| Option | Description |
|---|---|
| `-n, --count <number>` | Number of events to remove (default: 1) |
| `--dry-run` | Preview what would be deleted without deleting |

**Notes:**
- Removes events from the database only — does not modify any exported markdown files
- Automatically invalidates sessions for affected dates so they rebuild on next access
- Running undo twice is safe — the second call removes the next N events

---

## workscribe clear

Delete all captured events for a date.

```bash
workscribe clear
workscribe clear --date 2026-05-20
workscribe clear --dry-run
workscribe clear --yes
```

| Option | Description |
|---|---|
| `--date <YYYY-MM-DD>` | Date to clear (default: today) |
| `--dry-run` | Preview what would be deleted without deleting |
| `--yes` | Skip the confirmation prompt |

**Notes:**
- Shows a category summary before asking for confirmation
- Automatically invalidates cached sessions for the date
- Use `--dry-run` to see what would be removed before committing

---

## workscribe export

Generate a summary and save it as a markdown file.

```bash
workscribe export
workscribe export --date 2026-05-20
workscribe export --output ~/Desktop/standup.md
workscribe export --fresh
```

| Option | Description |
|---|---|
| `--date <YYYY-MM-DD>` | Export a specific date |
| `--output <path>` | Custom output path (default: `~/.workscribe/exports/workscribe-<date>.md`) |
| `--fresh` | Ignore saved summaries and write the template's summary for every session |

The file holds the same day `workscribe summary` shows: a summary the agent skill saved for a session is used, and the template tells the rest, each session under its own `## ` heading. It's always markdown, whatever `summary.format` is set to. Notes about the summary (which sessions came from saved summaries, events left out) are printed to the terminal, not written to the file.

---

## JSON output contract

`workscribe sessions --json` and `workscribe events --json` print a versioned, machine-readable view of your activity — what coding-agent skills and other tools read instead of scraping the text output. Each prints one line of compact JSON (pipe it through `jq` to read it).

**Stability:** every document carries `schemaVersion` (currently `1`). Within a version, fields may be **added** but are never renamed, removed or retyped — those changes bump `schemaVersion`. Ignore fields you don't recognise.

```ts
// workscribe sessions --json
{ schemaVersion: 1, date: string, sessions: Session[] }

Session = {
  key: string              // stable session id: "<repo>|<startedAt>"
  project: string | null   // repo name, projects display name, or ~/path for work outside git
  repoName: string | null
  repoPath: string | null  // git toplevel; null outside a git repo
  cwd: string | null       // directory most commands ran in
  branch: string | null    // the latest branch the session was on
  branches: string[]       // every branch the session touched, in the order first seen
  startedAt: string        // ISO 8601
  endedAt: string
  durationMinutes: number
  eventCount: number       // all captured events, before filtering
  notes: string[]          // workscribe note texts
  commits: Commit[]
  events: Event[]
}

Commit = {
  hash: string | null
  subject: string
  committedAt: string | null  // ISO 8601; null for commits an AI-tool session recorded
  source: "git" | "captured"
}

// workscribe events --json
{ schemaVersion: 1, date: string, total: number, events: Event[] }

Event = {
  capturedAt: string
  category: string                 // testing, building, shipping, dependencies, ai_session, other, …
  metadata: Record<string, unknown> // structured fields the normaliser extracted (tool, packages, message, …)
  hint?: string                    // only on unclassified ("other") events: redacted, ≤120-char command prefix
  exitCode: number | null          // null for commands captured through AI-tool hooks
  durationMs: number | null
  source: string | null            // shell, claude-code, vscode, …
}
```

**What's included:**

- Events follow the same exclusions as summaries: `exploring` and `linting` are left out unless listed in `summary.includeCategories`. Notes appear in `notes`, never in `events`. In `events --json`, `total` counts events after filtering and `--limit` caps the list.
- Full command strings, event working directories and IDE file paths are never included. See [Privacy](/privacy) for what the structured fields can contain.

**Commits** combine two sources, git commits first (oldest first), then captured-only ones:

- `git` — commits found with `git log` in the session's repo from two minutes before its start (covering commit hooks) to a minute after its end, limited to commits *committed* by your `user.email` when one is configured (so cherry-picks you made count). Matched on committer date, so a commit rebased or amended later may fall outside the window, and only commits reachable from `HEAD` are seen; after a rebase leaves commit dates out of order, `git log` can stop early and miss a few. Two commits with the same subject are both listed. Because of the grace period, a commit right at the boundary between two nearby sessions in the same repo can appear in both.
- `committedAt` — for a `git` commit, its committer date from git; for a `captured` one, when Workscribe recorded the `git commit` finishing. An AI-tool session records which commits reached `HEAD` but not when, so those are `null`.
- `captured` — commit messages Workscribe recorded itself (`git commit -m`, AI-tool sessions) that git didn't return, with `hash: null`. A `git commit` that failed (rejected by a hook, nothing staged) is not listed, and neither is a subject that recent history shows was committed only by someone else (an AI session records every commit that reaches `HEAD`, including ones it pulled in).

If git isn't installed, the session isn't in a repo, or git times out, `commits` falls back to the captured ones — the command never fails because of git.

---

## workscribe context

Surface the last session for the current repo — at the moment you need it, not at end of day.

```bash
workscribe context
workscribe context --file src/auth.ts
workscribe context --file src/auth.ts --json
```

| Option | Description |
|---|---|
| `--file <path>` | Show the last session that touched this file (requires IDE integration) |
| `--json` | Output structured JSON instead of formatted text — `null` when no session is found |

**Without `--file`:** shows the most recent session for the current git repo — date, duration, branch, event count, and the session's summary — one the agent skill saved, one an AI provider wrote in 1.x, or else the template. The repo is named exactly as capture names it: a `projects.<path>` override for the current folder wins, and otherwise `git.qualifyRepoName` decides between `owner/repo` and bare `repo`. Sessions stored under the other form, from before you changed that setting, are found too when they ran inside this repo's folder.

**With `--file`:** narrows to the most recent session that included a `code_edit` event (a save in your editor) for that path. This is what powers the [VS Code extension](https://marketplace.visualstudio.com/items?itemName=workscribe.workscribe)'s status bar "last worked on" indicator — surfacing "3 days ago" when you switch to a file you haven't touched recently. Neovim and other editor integrations aren't built yet.

It finds today's work too, without running `workscribe summary` first: if the day the file was last saved hasn't been grouped into sessions yet, `context --file` groups it. It answers within a couple of seconds even when another Workscribe command is busy with the database, or git is slow — at worst with slightly older sessions, or without the file's commits.

**If no summary exists** for the session, the default text output includes the command to generate one:

```
  No summary — run: workscribe summary 2026-08-25
```

**`--json` output shape**, intended for IDE integrations that need to render this themselves rather than parse formatted text:

```json
{
  "repoName": "acme/api",
  "date": "2026-08-20",
  "startedAt": "2026-08-20T10:00:00.000Z",
  "endedAt": "2026-08-20T12:14:00.000Z",
  "timeAgo": "3 days ago",
  "durationMinutes": 134,
  "branch": "feature/auth",
  "eventCount": 42,
  "summary": "Implemented authentication middleware.", // or null if no summary has been generated yet
  "file": {                                  // with --file only; null if the session has no saves of the file
    "path": "/Users/me/api/src/auth.ts",
    "relativePath": "src/auth.ts",           // relative to the repo root, or just the file name
    "firstSavedAt": "2026-08-20T10:05:00.000Z",
    "lastSavedAt": "2026-08-20T11:40:00.000Z",
    "saveCount": 6,                          // saves recorded: one per file per 30 seconds at most
    "branch": "feature/auth",
    "commits": [{ "hash": "a1b2c3d", "subject": "add auth middleware", "committedAt": "2026-10-25T09:20:00+01:00" }], // your commits in the session that changed it
    "editedAlongside": { "files": ["src/routes.ts"], "total": 1 }         // up to 5 other files saved in the session
  }
}
```

Prints the bare JSON value `null` (not an object) when no matching session exists.

---

## workscribe status

Show capture status and event counts.

```bash
workscribe status
```

**Output includes:**
- Whether capture is active or paused
- Number of events captured today and total
- Last captured event
- How summaries are made (the offline template, plus the agent skill)
- A notice if your config still has AI provider settings from Workscribe 1.x, with how to remove them
- A "Data" line: whether your stored data is up to date, has upgrades pending, or an upgrade failed — with rows a data upgrade couldn't resolve and the latest backup, when there are any
- An "Agent skill" line for each detected coding agent: installed (with version), outdated, or not installed — with the command to fix it
- Pending security alerts count (if any)

---

## workscribe upgrade

Bring the data you've already captured up to date after updating Workscribe.

```bash
workscribe upgrade
```

Some updates change how stored activity is organised. Workscribe does that work in small steps: a little at a time before `status`, `summary`, `week`, `export` and `events` (at most about 2 seconds each time), never while capturing and never for `context` or `sessions`, which editors and coding agents call. `workscribe upgrade` does all of it in one go and prints what it checked.

- **A backup comes first.** Before the first change after an update, Workscribe copies your database to `~/.workscribe/backups/` (once per version; the newest 3 are kept). If the backup can't be made, nothing is changed.
- **Interrupted is fine.** Each step is saved as it finishes; the next run carries on where the last one stopped.
- **Nothing is deleted.** Rows an upgrade can't sort out are kept as they are and listed, and `workscribe status` shows how many.

Exits with 1 if an upgrade failed or its check didn't pass, so it can run in a script. With nothing to do, it says your data is up to date.

---

## workscribe alerts

Show and manage security alerts raised when Workscribe detects a possible credential in an AI tool prompt.

```bash
workscribe alerts          # list all pending alerts
workscribe alerts clear    # dismiss all pending alerts
```

When credentials are detected in a prompt sent to an AI tool (e.g. Claude Code), Workscribe:
1. Stores the alert in the local database.
2. Writes a signal file to `~/.workscribe/alerts.pending`.
3. Displays a one-line warning before your next shell prompt.
4. Injects a `systemMessage` into Claude's context for that turn.

The `clear` subcommand marks all alerts as dismissed and removes the signal file.

---

## workscribe pause / resume

Pause and resume capture.

```bash
workscribe pause
workscribe resume
```

When paused, the shell hook still fires but events are silently discarded. Useful when sharing your screen or running sensitive commands you don't want journaled.

---

## workscribe uninstall

Remove everything `workscribe init` added — shell hooks, shell completions, the Claude Code session hook and the agent skill — and optionally delete all Workscribe data. Run it **before** `npm uninstall -g @workscribe/cli`: npm 7 and later don't run package cleanup scripts, so removing the package alone leaves these behind (see [Troubleshooting](/troubleshooting#errors-after-removing-workscribe-without-workscribe-uninstall) if that already happened).

```bash
workscribe uninstall
workscribe uninstall --hooks-only
```

| Option | Description |
|---|---|
| `--hooks-only` | Remove shell hooks, completions and the Claude Code hook only — keep the agent skill and skip the data deletion prompt |

**What it does:**
- Detects and removes the Workscribe hook block from `~/.zshrc`, `~/.bashrc`, and `~/.bash_profile`
- Removes the shell completions block from those files, and the fish completion file
- Removes the Claude Code session hook from `~/.claude/settings.json`, leaving your other hooks and settings untouched (each edited file is backed up first)
- Removes the agent skill Workscribe installed (never a `workscribe` skill you added yourself)
- Prompts whether to delete `~/.workscribe/` (database, config, exports, backups) — defaults to **no**
- Prints the command to remove the CLI itself (`npm uninstall -g @workscribe/cli`)

**After running:**

The hook is removed from your rc file but remains active in your current shell session. Either restart your terminal or run:

```bash
source ~/.zshrc   # or ~/.bashrc
```

**If you've already removed the package** and see errors in new terminals or in Claude Code, see [Errors after removing Workscribe without `workscribe uninstall`](/troubleshooting#errors-after-removing-workscribe-without-workscribe-uninstall).

---

## workscribe _capture (IDE integration)

Internal command called by shell hooks and IDE plugins. Not intended for direct use.

IDE integrations call this to record a file-save or debug event without going through the shell:

```bash
workscribe _capture --type code_edit --file src/auth.ts --source vscode --cwd /path/to/repo
workscribe _capture --type debug_start --source neovim --cwd /path/to/repo
workscribe _capture --type task_run --source vscode --cwd /path/to/repo
```

| Option | Description |
|---|---|
| `--cmd <command>` | Shell command (shell hook only) |
| `--cwd <path>` | Working directory (required) |
| `--type <type>` | Event type — skips normalization. One of: `code_edit`, `debug_start`, `debug_end`, `task_run` |
| `--source <source>` | Event source identifier (e.g. `vscode`, `neovim`, `jupyter`) |
| `--file <path>` | File path for `code_edit` events |
| `--exit <code>` | Exit code (shell hook only) |
| `--duration <ms>` | Duration in milliseconds (shell hook only) |

**Deduplication:** `code_edit` events for the same file within 30 seconds are dropped. This absorbs rapid auto-saves without creating duplicate records.

---

## workscribe config

View and update configuration.

```bash
workscribe config
workscribe config set <key> <value>
workscribe config get <key>
```

**Examples:**

```bash
workscribe config set session.idleTimeout 20
workscribe config set redact.extra "MY_SECRET_PATTERN"
workscribe config set integrations.slackWebhook https://hooks.slack.com/services/...
workscribe config set projects./Users/me/sandbox/myrepo actual-repo-name
```

**Sensitive value masking:**

`workscribe config get` and `workscribe config` mask tokens, webhook URLs and keys (including an API key left over from 1.x) — showing only the first four characters and the total length:

```
http******** (68 chars)
```

This confirms a value is set without exposing it in your terminal history.

See [Configuration](/docs/configuration) for the full config reference.
