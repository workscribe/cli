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
| Node.js | **22 or later** | Uses the built-in `node:sqlite` module introduced in Node 22.5 |
| Shell | zsh or bash | Hook is appended to `~/.zshrc` or `~/.bashrc` by `workscribe init` |
| OS | macOS or Linux | Windows is not supported — the shell hook requires zsh or bash. WSL2 works. |

> Check your version: `node --version`

## Install

```bash
<package-manager> install -g @workscribe/cli
workscribe init
source ~/.zshrc   # or restart your terminal
```

> Use the global install flag for your package manager — e.g. `npm install -g`, `yarn global add`, `pnpm add -g`, or `bun add -g`.

`workscribe init` walks you through choosing an AI provider, installs the shell hook, and offers to install a Claude Code session capture hook if Claude Code is detected. Safe to re-run — updates outdated hooks and skips steps already complete.

## Uninstalling

If the CLI is still installed:

```bash
workscribe uninstall        # removes shell hooks, optionally deletes ~/.workscribe/
npm uninstall -g @workscribe/cli
```

If you've already removed the binary and still see `_workscribe_precmd` errors in your terminal, remove the hook block manually:

1. Open `~/.zshrc` (or `~/.bashrc`)
2. Delete everything between `# workscribe:hook:start` and `# workscribe:hook:end` (inclusive)
3. Run `source ~/.zshrc` or restart your terminal

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
| `workscribe init` | Set up Workscribe, install shell hooks, configure AI provider |
| `workscribe uninstall` | Remove shell hooks and optionally delete all local data |
| `workscribe summary` | Generate today's work summary |
| `workscribe summary --date 2026-05-20` | Summary for a specific date |
| `workscribe summary --week` | Summary for the current week |
| `workscribe summary --fresh` | Bypass cache and regenerate |
| `workscribe summary --slack` | Post summary to configured Slack channel |
| `workscribe summary --webhook <url>` | Post summary to a custom webhook URL |
| `workscribe sessions` | List detected work sessions for today |
| `workscribe sessions --date 2026-05-20` | Sessions for a specific date |
| `workscribe events` | List captured events for today |
| `workscribe events --date 2026-05-20` | Events for a specific date |
| `workscribe events --limit 20` | Show only the most recent N events |
| `workscribe export` | Save today's summary as a markdown file |
| `workscribe export --date 2026-05-20` | Export summary for a specific date |
| `workscribe export --output <path>` | Write to a custom file path |
| `workscribe status` | Check capture is active and show event counts |
| `workscribe undo` | Remove the last captured event |
| `workscribe undo -n 5` | Remove the last 5 captured events |
| `workscribe undo --dry-run` | Preview what would be removed without deleting |
| `workscribe clear` | Delete all captured events for today |
| `workscribe clear --date 2026-05-20` | Delete all events for a specific date |
| `workscribe clear --dry-run` | Preview what would be cleared without deleting |
| `workscribe clear --yes` | Skip the confirmation prompt |
| `workscribe pause` | Pause capture temporarily |
| `workscribe resume` | Resume capture after a pause |
| `workscribe config` | View current configuration |
| `workscribe config get KEY` | Print a single config value |
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
workscribe config set summary.format json          # output summary as JSON instead of markdown
workscribe config set capture.ignore "mycommand"   # suppress a command from being captured

# Override the display name for a local clone whose folder name differs from the repo
workscribe config set projects./Users/me/sandbox/myrepo actual-repo-name

# Post summaries to Slack or a custom webhook
workscribe config set integrations.slackWebhook https://hooks.slack.com/services/...
workscribe config set integrations.webhook https://custom.endpoint/hook   # persistent default webhook
workscribe summary --slack
workscribe summary --webhook https://custom.endpoint/hook                 # one-off override
```

| Config key | Default | Description |
|---|---|---|
| `ai.provider` | — | AI provider: `anthropic`, `openai`, `ollama`, `openai-compatible` |
| `ai.apiKey` | — | API key for the configured provider |
| `ai.model` | provider default | Model name override |
| `ai.baseUrl` | — | Base URL for `openai-compatible` providers |
| `session.idleTimeout` | `30` | Minutes of inactivity before a new session starts |
| `capture.ignore` | common shell builtins | Commands to exclude from capture |
| `capture.aiTools` | `true` | Set to `false` to disable all AI session capture |
| `redact.extra` | `[]` | Additional regex patterns to redact from captured commands |
| `summary.format` | `markdown` | Output format: `markdown` or `json` |
| `integrations.slackWebhook` | — | Slack incoming webhook URL |
| `integrations.webhook` | — | Default webhook URL for `--webhook` |
| `projects.<path>` | — | Display name override for a repo by absolute path |

## Slack integration

Post your daily or weekly summary directly to a Slack channel:

```bash
workscribe summary --slack
workscribe summary --week --slack
```

**Setup:**

1. Go to [api.slack.com/apps](https://api.slack.com/apps) → **Create New App** → **From scratch**
2. Name your app, select your workspace, and click **Create App**
3. In the left sidebar under **Features**, click **Incoming Webhooks**
4. Toggle **Activate Incoming Webhooks** to On
5. Click **Add New Webhook to Workspace**, choose a channel, and click **Allow**
6. Copy the webhook URL and run:

```bash
workscribe config set integrations.slackWebhook https://hooks.slack.com/services/...
```

Works on all Slack plans including free. No admin role required.

Summaries posted to Slack are automatically formatted — headings are bolded, bullets converted to `•`, and your OS username is prepended so recipients know who sent it in shared channels. Custom `--webhook` URLs receive the raw markdown output unchanged.

Config is stored at `~/.workscribe/config.json`.

## Debug mode

If capture isn't working, set `WORKSCRIBE_DEBUG=1` to write errors to `~/.workscribe/debug.log`:

```bash
WORKSCRIBE_DEBUG=1 workscribe status
```

## License

MIT
