# Workscribe

[![npm version](https://img.shields.io/npm/v/@workscribe/cli)](https://www.npmjs.com/package/@workscribe/cli)
[![npm downloads](https://img.shields.io/npm/dw/@workscribe/cli)](https://www.npmjs.com/package/@workscribe/cli)
[![license](https://img.shields.io/npm/l/@workscribe/cli)](https://www.npmjs.com/package/@workscribe/cli)

> Your work, automatically documented.

[Workscribe](https://workscribe.co) is a CLI tool that passively captures your terminal activity and transforms it into readable daily work summaries — without you having to write anything.

```
$ workscribe summary

## api-service (main, feature/auth) — 2h 15m
On main:
- Committed: fix token expiry check
- Tests now passing
On feature/auth:
- Committed: add JWT validation middleware
- Added dependencies: bcrypt, jsonwebtoken
- Pushed to origin/feature/auth
With Claude Code (2 sessions) · 3 file saves in the editor

## infrastructure — 45m
- Note: staging was flaky after the compose upgrade
- Build passing
```

Want prose instead? Ask your coding agent to *"summarize my work today"* — see [Summaries](#summaries).

**[Full documentation →](https://workscribe.mintlify.site)** — commands, configuration, summaries, troubleshooting. This README covers getting started; everything else lives there and is kept current as the product changes.

## How it works

A shell hook captures every command you run. At the end of the day, `workscribe summary` groups your activity into work sessions and turns them into a summary with its offline template engine — no AI provider, no API key, nothing sent anywhere.

For AI-written prose, ask the coding agent you already use (Claude Code, Codex, GitHub Copilot or Cursor) to *"summarize my work today"*. The Workscribe agent skill reads your sessions and writes the summary — install it with `workscribe skill install`.

```
shell hook → capture → SQLite → session grouper → template engine → markdown
                                               ↘ agent skill (your coding agent) → prose summary
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

`workscribe init` installs the shell hook, offers to install a Claude Code session capture hook if Claude Code is detected, and offers to install the Workscribe skill into the coding agents it finds. Safe to re-run — updates outdated hooks and skips steps already complete.

## Also capturing in your editor?

The [Workscribe VS Code extension](https://marketplace.visualstudio.com/items?itemName=workscribe.workscribe) feeds file saves, debug sessions, and test/build runs into the same summary — activity pure terminal capture misses entirely. It also adds a status bar item that surfaces the last summary for a file you haven't touched in 24+ hours. Uses this CLI under the hood; no separate setup beyond installing it.

## Uninstalling

If the CLI is still installed:

```bash
workscribe uninstall        # removes shell hooks and the agent skill, optionally deletes local data
npm uninstall -g @workscribe/cli   # run after — npm doesn't run Workscribe's cleanup itself
```

If you've already removed the binary and still see `_workscribe_precmd` errors in your terminal, remove the hook block manually:

1. Open `~/.zshrc` (or `~/.bashrc`)
2. Delete everything between `# workscribe:hook:start` and `# workscribe:hook:end` (inclusive)
3. Run `source ~/.zshrc` or restart your terminal

## Summaries

`workscribe summary`, `week` and `export` use a built-in template engine: deterministic, instant and fully offline. There's nothing to configure.

For AI-written summaries, use the coding agent you already have. `workscribe skill install` adds the Workscribe skill to Claude Code, Codex, GitHub Copilot and Cursor; then ask the agent to *"summarize my work today"* (or type `/workscribe` in Claude Code). Summaries the agent writes are saved, so `workscribe summary` and the VS Code status bar show them too.

**[How summaries work →](https://workscribe.mintlify.site/summaries)** · **Upgrading from 1.x?** AI providers were removed in 2.0 — see the **[migration guide →](https://workscribe.mintlify.site/migrating-to-2)**

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
- `workscribe summary`, `week` and `export` never send your activity anywhere — the template engine runs entirely on your machine
- The agent skill is the one exception, and only when you ask your coding agent for a summary: the agent sends the session data it reads to its own model provider
- Separately, Workscribe sends an anonymous install ping (a random ID, CLI version, OS platform, Node version — no activity data, ever), disclosed during `workscribe init`. Opt out anytime: `workscribe config set telemetry.enabled false`

**[Full privacy & security details →](https://workscribe.mintlify.site/privacy)**

## Configuration

```bash
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
