# Workscribe

> Your work, automatically documented.

[Workscribe](https://workscribe.co) is a CLI tool that passively captures your terminal activity and transforms it into readable daily work summaries — without you having to write anything.

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

**[Full documentation →](https://workscribe.mintlify.site)** — commands, configuration, AI providers, troubleshooting. This README covers getting started; everything else lives there and is kept current as the product changes.

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

## Also capturing in your editor?

The [Workscribe VS Code extension](https://marketplace.visualstudio.com/items?itemName=workscribe.workscribe) feeds file saves, debug sessions, and test/build runs into the same summary — activity pure terminal capture misses entirely. It also adds a status bar item that surfaces the last summary for a file you haven't touched in 24+ hours. Uses this CLI under the hood; no separate setup beyond installing it.

## Uninstalling

If the CLI is still installed:

```bash
workscribe uninstall        # removes shell hooks, optionally deletes local data
npm uninstall -g @workscribe/cli
```

If you've already removed the binary and still see `_workscribe_precmd` errors in your terminal, remove the hook block manually:

1. Open `~/.zshrc` (or `~/.bashrc`)
2. Delete everything between `# workscribe:hook:start` and `# workscribe:hook:end` (inclusive)
3. Run `source ~/.zshrc` or restart your terminal

## AI providers

Anthropic, OpenAI, Gemini, Groq, Ollama (fully offline), or any OpenAI-compatible endpoint.

```bash
workscribe config set ai.provider anthropic
workscribe config set ai.apiKey <your-key>
```

**[Provider setup, defaults, and model overrides →](https://workscribe.mintlify.site/providers)**

## Commands

A few of the most common:

| Command | Description |
|---|---|
| `workscribe summary` | Generate today's work summary |
| `workscribe week` | Generate this week's digest |
| `workscribe status` | Check capture is active and show event counts |
| `workscribe config` | View or update configuration |

**[Full command reference →](https://workscribe.mintlify.site/commands)** — every command and every flag.

## Privacy

- All captured activity data is stored locally on your machine — nothing is written anywhere else
- Credentials are redacted before any event is written to disk (tokens, API keys, passwords, JWTs)
- Your captured activity (commands, sessions) is never sent anywhere except your configured AI provider, and only when you run `workscribe summary`
- Use Ollama to keep that data fully on-device with zero external transmission
- Separately, Workscribe sends an anonymous install ping (a random ID, CLI version, OS platform, Node version — no activity data, ever), disclosed during `workscribe init`. Opt out anytime: `workscribe config set telemetry.enabled false`

**[Full privacy & security details →](https://workscribe.mintlify.site/privacy)**

## Configuration

```bash
workscribe config set ai.provider anthropic
workscribe config set session.idleTimeout 20
workscribe config set integrations.slackWebhook https://hooks.slack.com/services/...
workscribe summary --slack
```

**[Full configuration reference →](https://workscribe.mintlify.site/configuration)** — every key, Slack setup, webhooks, and more.

## Debug mode

If capture isn't working, set `WORKSCRIBE_DEBUG=1` to write errors to `~/.workscribe/debug.log`:

```bash
WORKSCRIBE_DEBUG=1 workscribe status
```

**[Troubleshooting →](https://workscribe.mintlify.site/troubleshooting)**

## License

MIT
