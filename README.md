# Chronicle

> Your work, automatically documented.

Chronicle is a CLI tool that passively captures your terminal activity and transforms it into readable daily work summaries — without you having to write anything.

```
$ chronicle summary

## api-service (feature/auth) — 2h 15m

- Set up authentication feature branch and installed JWT dependencies
- Resolved failing test suite for token validation logic
- Committed authentication middleware fixes

## infrastructure — 45m

- Restarted staging environment and verified deployment stability
- Investigated and resolved Docker networking issue in compose setup
```

## How it works

A shell hook captures every command you run. At the end of the day, `chronicle summary` groups your activity into work sessions and sends structured event data (never raw commands) to your configured AI provider, which returns a standup-ready narrative.

```
shell hook → capture → SQLite → session grouper → AI provider → markdown
```

## Install

```bash
npm install -g @chronicle/cli
chronicle init
source ~/.zshrc   # or restart your terminal
```

`chronicle init` walks you through choosing an AI provider and installs the shell hook. From that point, capture is automatic.

**Requirements:** Node.js 22+, macOS or Linux (zsh or bash)

## AI providers

Chronicle works with any of these — switch at any time via config:

| Provider | Config value | Requires |
|---|---|---|
| Anthropic (Claude) | `anthropic` | API key |
| OpenAI | `openai` | API key |
| Ollama (local) | `ollama` | Ollama running locally — free, offline |
| OpenAI-compatible | `openai-compatible` | API key + base URL (Groq, Together, Mistral…) |

```bash
chronicle config set ai.provider ollama      # switch to local
chronicle config set ai.provider anthropic   # switch to Anthropic
chronicle config set ai.apiKey <your-key>
```

## Commands

| Command | Description |
|---|---|
| `chronicle summary` | Generate today's work summary |
| `chronicle summary --date 2026-05-20` | Summary for a specific date |
| `chronicle summary --week` | Summary for the current week |
| `chronicle sessions` | List detected work sessions |
| `chronicle events` | List captured events |
| `chronicle export` | Save today's summary as a markdown file |
| `chronicle status` | Check capture is active and show event counts |
| `chronicle config` | View current configuration |
| `chronicle config set KEY VALUE` | Update a config value |

## Privacy

- All captured data is stored locally in `~/.chronicle/`
- Credentials are redacted before any event is written to disk (tokens, API keys, passwords, JWTs)
- Nothing is sent to any remote server except your configured AI provider at summary time
- Use Ollama to keep everything fully on-device

## Configuration

```bash
chronicle config set session.idleTimeout 20       # minutes before a new session starts (default: 30)
chronicle config set ai.model gpt-4o              # override the default model for your provider
chronicle config set redact.extra "MY_PATTERN"    # add a custom redaction regex
```

Config is stored at `~/.chronicle/config.json`.

## Debug mode

If capture isn't working, set `CHRONICLE_DEBUG=1` to write errors to `~/.chronicle/debug.log`:

```bash
CHRONICLE_DEBUG=1 chronicle status
```

## License

MIT
