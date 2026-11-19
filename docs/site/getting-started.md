---
title: Getting Started
description: Install Workscribe and start capturing your work in under two minutes.
---

# Getting Started

## Requirements

| Dependency | Version |
|---|---|
| Node.js | **22 or later** |
| Shell | zsh, bash or fish |
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
1. Create your data folder (`~/.workscribe/` or the XDG folders — see [Where your data lives](/troubleshooting#where-your-data-lives)) and initialise the local database
2. Detect your shell (zsh, bash or fish) and install the capture hook
3. If the shell hook is outdated, prompt you to update it
4. If it finds AI coding tools such as Claude Code or Antigravity, offer to install a session capture hook for each
5. Offer to install the Workscribe skill into the coding agents it finds (Claude Code, Codex, GitHub Copilot, Cursor)

There's no AI provider or API key to set up — summaries work offline out of the box.

Safe to re-run at any time — updates outdated hooks and skips steps already complete.

After init, activate the hook without restarting your terminal:

```bash
source ~/.zshrc   # or ~/.bashrc
```

## Verify it's working

```bash
workscribe status
```

You should see `Capture active`. Run a few commands, then check:

```bash
workscribe events
```

Events should appear within seconds of running commands.

## Generate your first summary

```bash
workscribe summary
```

Workscribe groups your captured events into sessions and builds a summary of each with its offline template engine — commits, test and build results, dependencies, notes and more. Nothing leaves your machine.

For a prose summary, ask your coding agent to *"summarize my work today"* — the Workscribe skill reads your sessions, writes the summary and saves it, so `workscribe summary` shows it too. See [Summaries](/summaries).

---

## What gets captured

Every command you run in the terminal is intercepted by the shell hook, filtered, redacted, and stored locally. Workscribe **never** stores:

- File contents, or the text of any edit
- Passwords, tokens, or API keys (stripped before writing to disk)
- Commands you've added to the ignore list

It does record the path of each file you save in your editor or a coding agent edits, with how many lines changed, so it can tell which work touched which file.

See [Privacy & Security](/privacy) for full details.
