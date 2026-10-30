---
title: Privacy & Security
description: How Workscribe handles your data and what never leaves your machine.
---

# Privacy & Security

## What stays local

Everything you capture. All captured data is stored in `~/.workscribe/` on your machine. Nothing is sent to any remote server except a small anonymous install ping (on by default, see below). Summaries are built offline by the template engine; your activity leaves your machine only if you ask a coding agent to summarize it with the Workscribe skill (see below).

| Location | Contents |
|---|---|
| `~/.workscribe/workscribe.db` | SQLite database — events, sessions, cached summaries |
| `~/.workscribe/config.json` | Configuration including API keys |
| `~/.workscribe/exports/` | Markdown files from `workscribe export` |
| `~/.workscribe/weekly-cache/` | Cached weekly summaries |
| `~/.workscribe/backups/` | Copies of the database taken before a data upgrade — the newest 3 are kept |

Both the database and config file are written with `0600` permissions (owner read/write only). Backups hold the same data as the database, so they get the same protection: the folder is `0700` and each copy `0600`.

**What's recorded from a command, and what isn't:**
- **Claude Code commands:** Workscribe records the command, its folder, how long it took, and its exit code. For a failed command, Claude Code passes the command's output along with the exit code; Workscribe reads only the `Exit code N` line and stores nothing else from it.
- **Projects, branches and files:** to tell when events belong to the same project, Workscribe also stores each repo's `origin` remote (host, owner and repo, never credentials), its root folder and git folder, and the path of each saved file relative to its repo. These come from the same folders and names already recorded with each event. To link events captured before this was recorded, a one-time upgrade asks git about each folder in your history, once, and keeps the answer.
- **`git commit -F <file>`:** Workscribe reads the message file's first line (the subject) when the command is captured, redacted like the command itself. Only regular files are read, at most 4 KB, and the file's path isn't stored.

---

## Anonymous install telemetry

Workscribe sends a small anonymous ping on startup, at most once every 24 hours per install — on by default.

**Sent:**
- A randomly generated install ID — not tied to your identity, your repos, or any account
- CLI version
- OS platform
- Node.js version

**Never sent:** commands, events, sessions, or summaries — nothing from the "What gets redacted" or "When your activity leaves your machine" sections below.

Telemetry does not run for the background shell-hook process that captures each command (`_capture`/`_hook`) — only for commands you run directly, and never more than once in a 24-hour window.

**Opt out:**
```bash
workscribe config set telemetry.enabled false
```

---

## What gets redacted

Before any event is written to disk, Workscribe strips sensitive patterns from the raw command string:

**Automatically redacted:**
- Bearer tokens (`Bearer <token>`)
- Authorization headers
- API keys and secrets in common formats
- Passwords passed as flags (`--password`, `-p`)
- JWT tokens
- Private keys
- Slack incoming webhook URLs (`hooks.slack.com/services/...`)

**Add your own patterns:**

```bash
workscribe config set redact.extra '["MY_INTERNAL_SECRET"]'
```

Redaction is applied as a regex replace — matched values are replaced with `[REDACTED]` before the command touches the database.

---

## When your activity leaves your machine

**`workscribe summary`, `week` and `export` never send your activity anywhere.** Since 2.0 they use Workscribe's offline template engine, which runs entirely on your machine — there are no AI providers and no API keys.

Your activity leaves your machine only when **you ask your coding agent to summarize it with the Workscribe skill**. The agent then reads `workscribe sessions --json` (described below) and sends it to its own model provider, as it does with the rest of your conversation.

**What that JSON contains:** event categories, structured fields, commit subjects, and for each session its repo path and the directory most commands ran in.

**For unclassified commands only:** a `hint` — the first 120 characters of the command after redaction — so the agent can describe work that doesn't match a known pattern (e.g. `make deploy`, `terraform apply`).

**Structured fields can echo command arguments:** the normaliser extracts fields such as `ssh` targets, the package run by `npx`, package names (which can be local paths or URLs) and Docker image names. These are redacted like everything else, but they are values you typed.

**Aider prompts:** when an Aider session ends, Workscribe stores your last prompt from Aider's history file in that event's metadata while `capture.includeAiderPrompt` is on (the default), and it's included with the other structured fields. Turn it off to stop capturing it: `workscribe config set capture.includeAiderPrompt false`.

**Never included:**
- Full command strings
- Per-event working directories, IDE file paths or file contents
- Credentials or tokens (redacted before anything is stored)

---

## JSON output for coding agents

`workscribe sessions --json` and `workscribe events --json` expose the structured data described above — categories, structured fields, unclassified-command hints and commit subjects — plus, for each session, its repo path and the directory most commands ran in. They never include full commands, per-event working directories or IDE file paths. The output goes wherever you or your tools send it: when a coding-agent skill reads it, it is sent to that agent's model provider.

### The Workscribe agent skill

When you ask your coding agent to summarize your work with the Workscribe skill:

- **What leaves your machine:** the `sessions --json` output above, plus any files the agent chooses to read in your repos for context, go to the agent's model provider (as all of your conversation with that agent does).
- **What's stored locally:** the summary the agent writes is saved in `~/.workscribe/workscribe.db`, after the same secret redaction as captured commands. It's kept in two tables for now: `session_summaries`, and `summary`, which ties it to the events it describes so it survives regrouping. Both hold the same text, and the old table goes once nothing reads it. It's shown by `workscribe summary`, `workscribe context` and the VS Code status bar for that session.
- **What isn't recorded:** the skill's own `workscribe` commands are kept out of your captured activity.

If you need summaries that never leave your machine, don't use the skill — `workscribe summary` runs entirely locally.

---

## Fully offline operation

`workscribe summary`, `week` and `export` never make an external network request for your summary data. The anonymous install ping (see above) still runs unless you disable it — add `workscribe config set telemetry.enabled false` for fully offline operation, and don't use the agent skill.

Ollama was supported in 1.x for offline AI-written summaries; it was removed in 2.0 along with the cloud providers. See [Migrating to 2.0](/migrating-to-2).

---

## Pausing capture

To temporarily stop capturing — for example, when working with sensitive data or sharing your screen:

```bash
workscribe pause
# ... do sensitive work ...
workscribe resume
```

When paused, the shell hook still fires but all events are silently discarded before touching disk.

---

## Removing your data

Delete the entire data directory:

```bash
rm -rf ~/.workscribe
```

This removes the database, config, exports, backups, and cache. The shell hook in your `~/.zshrc` or `~/.bashrc` will still fire but write nothing (it will error silently). To remove the hook, delete the block between `# workscribe:hook:start` and `# workscribe:hook:end` in your shell rc file.
