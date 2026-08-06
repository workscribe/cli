---
title: Privacy & Security
description: How Workscribe handles your data and what never leaves your machine.
---

# Privacy & Security

## What stays local

Everything. All captured data is stored in `~/.workscribe/` on your machine. Nothing is written to any remote server except what you explicitly send to your AI provider when you run `workscribe summary`.

| Location | Contents |
|---|---|
| `~/.workscribe/workscribe.db` | SQLite database — events, sessions, cached summaries |
| `~/.workscribe/config.json` | Configuration including API keys |
| `~/.workscribe/exports/` | Markdown files from `workscribe export` |
| `~/.workscribe/weekly-cache/` | Cached weekly summaries |

Both the database and config file are written with `0600` permissions (owner read/write only).

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

Only when you run `workscribe summary`. Only structured event categories — never raw commands.

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

If you want zero external data transmission, use Ollama:

```bash
workscribe config set ai.provider ollama
```

With Ollama, `workscribe summary` never makes an external network request. Everything runs on your machine.

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
