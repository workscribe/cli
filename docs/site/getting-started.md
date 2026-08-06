---
title: Getting Started
description: Install Workscribe and start capturing your work in under two minutes.
---

# Getting Started

## Requirements

| Dependency | Version |
|---|---|
| Node.js | **22 or later** |
| Shell | zsh or bash |
| OS | macOS or Linux (Windows not supported — WSL2 works) |

Check your Node version:

```bash
node --version
```

## Install

```bash
<package-manager> install -g @workscribe/cli
```

> Use the global install flag for your package manager — e.g. `npm install -g`, `yarn global add`, `pnpm add -g`, or `bun add -g`.

## Initialise

```bash
workscribe init
```

`init` will:
1. Create `~/.workscribe/` and initialise the local database
2. Detect your shell (zsh or bash) and install the capture hook
3. If the shell hook is outdated, prompt you to update it
4. If Claude Code is detected, offer to install a session capture hook
5. Walk you through choosing an AI provider

Safe to re-run at any time — updates outdated hooks and skips steps already complete.

After init, activate the hook without restarting your terminal:

```bash
source ~/.zshrc   # or ~/.bashrc
```

## Verify it's working

```bash
workscribe status
```

You should see `Capture active` and your configured AI provider. Run a few commands, then check:

```bash
workscribe events
```

Events should appear within seconds of running commands.

## Generate your first summary

```bash
workscribe summary
```

Workscribe groups your captured events into sessions and sends them to your AI provider, which returns a standup-ready narrative.

---

## What gets captured

Every command you run in the terminal is intercepted by the shell hook, filtered, redacted, and stored locally. Workscribe **never** stores:

- Raw file contents
- File paths
- Passwords, tokens, or API keys (stripped before writing to disk)
- Commands you've added to the ignore list

See [Privacy & Security](/docs/privacy) for full details.
