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
- If Claude Code is detected, offers to install a session capture hook in `~/.claude/settings.json`
- Prompts you to choose an AI provider and enter your API key

**Shell hook updates:**

When a new version of Workscribe ships with an updated hook, re-running `workscribe init` detects the change and prompts you to update. Your rc file is backed up before any modification.

---

## workscribe summary

Generate an AI work summary for today or a specific date.

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
| `--fresh` | Bypass cache and regenerate the summary |
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
## project-name (branch) — 2h 15m
- Implemented auth middleware and JWT validation
- Resolved failing test suite
- Committed fixes and pushed to remote
```

Each session gets its own heading. The heading is always generated from your captured data — project name, branch, and duration — not from the AI.

**Caching:**
- Daily summaries are cached per session in the database
- Cached summaries are preserved when new events arrive — only new or unsummarised sessions call the AI
- Weekly summaries are cached in `~/.workscribe/weekly-cache/<YYYY-WW>.md`
- Use `--fresh` to force regeneration of all sessions for the day

---

## workscribe sessions

List detected work sessions for a date.

```bash
workscribe sessions
workscribe sessions --date 2026-05-20
```

| Option | Description |
|---|---|
| `--date <YYYY-MM-DD>` | Show sessions for a specific date |

Sessions are computed by grouping events with idle gaps greater than `session.idleTimeout` (default 30 minutes) and splitting across different repositories.

---

## workscribe events

List raw captured events for a date.

```bash
workscribe events
workscribe events --date 2026-05-20
workscribe events --limit 20
```

| Option | Description |
|---|---|
| `--date <YYYY-MM-DD>` | Show events for a specific date |
| `--limit <n>` | Limit the number of events shown |

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
```

| Option | Description |
|---|---|
| `--date <YYYY-MM-DD>` | Export a specific date |
| `--output <path>` | Custom output path (default: `~/.workscribe/exports/workscribe-<date>.md`) |

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
- Configured AI provider and model

---

## workscribe pause / resume

Pause and resume capture.

```bash
workscribe pause
workscribe resume
```

When paused, the shell hook still fires but events are silently discarded. Useful when sharing your screen or running sensitive commands you don't want journaled.

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
workscribe config set ai.provider anthropic
workscribe config set ai.apiKey sk-...
workscribe config set ai.model claude-haiku-4-5-20251001
workscribe config set session.idleTimeout 20
workscribe config set redact.extra "MY_SECRET_PATTERN"
workscribe config set integrations.slackWebhook https://hooks.slack.com/services/...
workscribe config set projects./Users/me/sandbox/myrepo actual-repo-name
```

**Sensitive value masking:**

`workscribe config get` and `workscribe config` mask API keys, tokens, and webhook URLs — showing only the first four characters and the total length:

```
sk-a******** (51 chars)
```

This confirms a value is set without exposing it in your terminal history.

See [Configuration](/docs/configuration) for the full config reference.
