---
title: Privacy & Security
description: How Workscribe handles your data and what never leaves your machine.
---

# Privacy & Security

## What stays local

Everything you capture. All captured data is stored in `~/.workscribe/` on your machine. Nothing is written to any remote server except a small anonymous install ping (on by default, see below) and — only if you configure a cloud AI provider — the summary payload described below. With no AI configured, summaries are built offline by the template engine and nothing about your activity leaves your machine.

| Location | Contents |
|---|---|
| `~/.workscribe/workscribe.db` | SQLite database — events, sessions, cached summaries |
| `~/.workscribe/config.json` | Configuration including API keys |
| `~/.workscribe/exports/` | Markdown files from `workscribe export` |
| `~/.workscribe/weekly-cache/` | Cached weekly summaries |

Both the database and config file are written with `0600` permissions (owner read/write only).

---

## Anonymous install telemetry

Workscribe sends a small anonymous ping on startup, at most once every 24 hours per install — on by default.

**Sent:**
- A randomly generated install ID — not tied to your identity, your repos, or any account
- CLI version
- OS platform
- Node.js version

**Never sent:** commands, events, sessions, or summaries — nothing from the "What gets redacted" or "What is sent to your AI provider" sections below.

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

## What is sent to your AI provider

Only if `summary.engine` is `provider` (a cloud AI provider is configured), and only when you run `workscribe summary`, `week` or `export`. The default `template` engine and `ollama` send nothing off your machine. Only structured event categories are sent — never raw commands.

**Sent:**
```
Project: api-service
Branch: feature/auth
Duration: 2h 15m
Events:
  - 3x code_commit
  - 2x test_run [failed]
  - test_run
  - dependency_install {"tool":"npm","packages":["bcrypt"]}
  - lint_run {"tool":"eslint"}
  - file_ops {"tool":"mkdir"}
```

The following categories are captured locally but **excluded from the AI payload** — they are investigative or shell noise with no meaningful summary value:
- `environment` — `export`, `source`
- `code_search` — `grep`, `find`, `rg`, `npx eslint` searches
- `code_read` — `cat`, `head`, `tail`
- `server_run` — `npm run dev`, `yarn start`
- `git_other` — `git status`, `git log`, `git diff`

**Also sent, for unclassified commands only:** a `hint` — the first 120 characters of the command after redaction — so the model can describe work that doesn't match a known pattern (e.g. `make deploy`, `terraform apply`).

**Structured fields can echo command arguments:** the normaliser extracts fields such as `ssh` targets, the package run by `npx`, package names (which can be local paths or URLs) and Docker image names. These are redacted like everything else, but they are values you typed.

**Aider prompts:** when an Aider session ends, Workscribe stores your last prompt from Aider's history file in that event's metadata while `capture.includeAiderPrompt` is on (the default), and it is sent with the other structured fields. Turn it off to stop capturing it: `workscribe config set capture.includeAiderPrompt false`.

**Never sent:**
- Full command strings
- File paths or file contents
- Credentials or tokens
- Hostnames or IP addresses

---

## JSON output for coding agents

`workscribe sessions --json` and `workscribe events --json` expose the same structured data as the AI payload above — categories, structured fields, unclassified-command hints and commit subjects — plus, for each session, its repo path and the directory most commands ran in. They never include full commands, per-event working directories or IDE file paths. The output goes wherever you or your tools send it: when a coding-agent skill reads it, it is sent to that agent's model provider.

### The Workscribe agent skill

When you ask your coding agent to summarize your work with the Workscribe skill:

- **What leaves your machine:** the `sessions --json` output above, plus any files the agent chooses to read in your repos for context, go to the agent's model provider (as all of your conversation with that agent does).
- **What's stored locally:** the summary the agent writes is saved in `~/.workscribe/workscribe.db` (`session_summaries`), after the same secret redaction as captured commands. It's shown by `workscribe summary`, `workscribe context` and the VS Code status bar for that session.
- **What isn't recorded:** the skill's own `workscribe` commands are kept out of your captured activity.

If you need summaries that never leave your machine, don't use the skill — `workscribe summary` with the template engine or Ollama runs entirely locally.

---

## Using Ollama for full offline operation

With no AI configured, the default `template` engine already builds summaries entirely offline. If you want AI-written summaries with zero external data transmission, use Ollama:

```bash
workscribe config set summary.engine ollama
```

With the template engine or Ollama, `workscribe summary` never makes an external network request for your summary data. The anonymous install ping (see above) still runs unless you disable it — add `workscribe config set telemetry.enabled false` for fully offline operation.

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

This removes the database, config, exports, and cache. The shell hook in your `~/.zshrc` or `~/.bashrc` will still fire but write nothing (it will error silently). To remove the hook, delete the block between `# workscribe:hook:start` and `# workscribe:hook:end` in your shell rc file.
