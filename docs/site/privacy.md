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

**Never sent:**
- Raw command strings
- File paths or file contents
- Credentials or tokens
- Hostnames or IP addresses

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
