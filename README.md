# Workscribe

> Your work, automatically documented.

Workscribe is a CLI tool that passively captures your terminal activity and transforms it into readable daily work summaries — without you having to write anything.

```
$ workscribe summary

## api-service (feature/auth) — 2h 15m
- Set up authentication feature branch and installed JWT dependencies
- Resolved failing test suite for token validation logic
- Committed authentication middleware fixes

## infrastructure — 45m
- Restarted staging environment and verified deployment stability
- Investigated and resolved Docker networking issue in compose setup
```

## How it works

A shell hook captures every command you run. At the end of the day, `workscribe summary` groups your activity into work sessions and sends structured event data (never raw commands) to your configured AI provider, which returns a standup-ready narrative.

```
shell hook → capture → SQLite → session grouper → AI provider → markdown
```

## Requirements

| Dependency | Version | Notes |
|---|---|---|
| Node.js | **22 or later** | Uses the built-in `node:sqlite` module — not available in Node 20 or earlier |
| Shell | zsh or bash | Hook is appended to `~/.zshrc` or `~/.bashrc` by `workscribe init` |
| OS | macOS or Linux | Windows is not supported — the shell hook requires zsh or bash. WSL2 works. |

> Check your version: `node --version`

## Install

```bash
npm install -g @workscribe/cli
workscribe init
source ~/.zshrc   # or restart your terminal
```

`workscribe init` walks you through choosing an AI provider, installs the shell hook, and offers to install a Claude Code session capture hook if Claude Code is detected. Safe to re-run — updates outdated hooks and skips steps already complete.

## AI providers

Workscribe works with any of these — switch at any time via config:

| Provider | Config value | Requires |
|---|---|---|
| Anthropic (Claude) | `anthropic` | API key |
| OpenAI | `openai` | API key |
| Ollama (local) | `ollama` | Ollama running locally — free, offline |
| OpenAI-compatible | `openai-compatible` | API key + base URL (Groq, Together, Mistral…) |

```bash
workscribe config set ai.provider ollama      # switch to local
workscribe config set ai.provider anthropic   # switch to Anthropic
workscribe config set ai.apiKey <your-key>
```

## Commands

| Command | Description |
|---|---|
| `workscribe summary` | Generate today's work summary |
| `workscribe summary --date 2026-05-20` | Summary for a specific date |
| `workscribe summary --week` | Summary for the current week |
| `workscribe sessions` | List detected work sessions |
| `workscribe events` | List captured events |
| `workscribe export` | Save today's summary as a markdown file |
| `workscribe status` | Check capture is active and show event counts |
| `workscribe undo` | Remove the last captured event |
| `workscribe undo -n 5` | Remove the last 5 captured events |
| `workscribe undo --dry-run` | Preview what would be removed without deleting |
| `workscribe clear` | Delete all captured events for today |
| `workscribe clear --date 2026-05-20` | Delete all events for a specific date |
| `workscribe clear --dry-run` | Preview what would be cleared without deleting |
| `workscribe pause` | Pause capture temporarily |
| `workscribe resume` | Resume capture after a pause |
| `workscribe config` | View current configuration |
| `workscribe config set KEY VALUE` | Update a config value |

## Privacy

- All captured data is stored locally in `~/.workscribe/` — nothing is written anywhere else
- Credentials are redacted before any event is written to disk (tokens, API keys, passwords, JWTs)
- Nothing is sent to any remote server except your configured AI provider, only when you run `workscribe summary`
- The AI provider receives structured event categories (e.g. `test_run`, `code_commit`) — never raw commands, file contents, or file paths
- Use Ollama to keep everything fully on-device with zero external data transmission

## Configuration

```bash
workscribe config set session.idleTimeout 20       # minutes before a new session starts (default: 30)
workscribe config set ai.model gpt-4o              # override the default model for your provider
workscribe config set redact.extra "MY_PATTERN"    # add a custom redaction regex

# Override the display name for a local clone whose folder name differs from the repo
workscribe config set projects./Users/me/sandbox/myrepo actual-repo-name

# Post summaries to Slack or a custom webhook
workscribe config set integrations.slackWebhook https://hooks.slack.com/services/...
workscribe summary --slack
workscribe summary --webhook https://custom.endpoint/hook
```

Config is stored at `~/.workscribe/config.json`.

## Debug mode

If capture isn't working, set `WORKSCRIBE_DEBUG=1` to write errors to `~/.workscribe/debug.log`:

```bash
WORKSCRIBE_DEBUG=1 workscribe status
```

## License

MIT
