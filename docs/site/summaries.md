---
title: Summaries
description: How Workscribe turns your captured activity into summaries — offline by default, AI-written by your coding agent when you ask.
---

# Summaries

Workscribe gives you two ways to get a summary of your work. Neither needs an AI provider or an API key.

| | `workscribe summary` | Your coding agent + the Workscribe skill |
|---|---|---|
| Written by | Workscribe's template engine | The agent you already use — Claude Code, Codex, GitHub Copilot or Cursor |
| Style | Outcome bullets built from your activity | Prose written with the agent's model and your repos for context |
| Where it runs | Entirely on your machine | Your session data goes to the agent's model provider |
| Set-up | None | `workscribe skill install` |

---

## The template engine

`workscribe summary`, `workscribe week` and `workscribe export` use the template engine. It's deterministic and instant, and it never sends anything off your machine.

Each session reads as a short story of what you did:

- **Your notes** (`workscribe note`) come first.
- **Then the work on each branch**, in the order you worked on them. A session that touched several branches groups each one under a plain `On <branch>:` line; a session on one branch needs none, since the heading names it. Each branch leads with:
  1. its commits: the messages Workscribe captured, plus your commits from `git log` in the session's repo, each placed on the branch you were on when you made it. A `git commit` that failed (rejected by a hook, nothing staged) is never listed.
  2. how tests and builds turned out: "Tests now passing" when they went from failing to passing, "Tests failing" when the last run failed. It says what happened, not how many runs there were.
  3. dependencies added or removed, then releases and pushes
- **One closing line for how you worked:** "With an AI coding assistant (126 commands) · 3 file saves in the editor". The tool is never named, and saves need the VS Code extension.

A session has at most 7 work bullets, and every branch keeps at least its first.

```
## api (main, feat/auth) — 2h 15m
- Note: blocked on staging credentials
On main:
- Committed: fix: token refresh race
- Tests now passing
On feat/auth:
- Committed: feat: add auth middleware
- Added dependencies: bcrypt
With an AI coding assistant (126 commands) · 3 file saves in the editor
```

The session's branch is the latest one it was on, so the heading lists every branch but `workscribe context` and `sessions --json` name the one you finished on.

Looking commits up in git takes at most 3 seconds per `workscribe summary` run, for all your repos together. If git is missing or slow, the summary uses the commits Workscribe captured itself. `workscribe context` never asks git, so the VS Code extension always answers quickly.

Coding agents often run compound commands like `cd app && pnpm nx test shell 2>&1 | tail -40; npx tsc --noEmit`. Workscribe splits these into steps, sets aside shell glue (`cd`, `echo`, variable assignments, loop keywords) and classifies the command by its most telling step — here, the tests. The full command is still stored as it was run.

A session with nothing to tell but activity says so in one line, "Explored and ran commands", under its heading. Weekly digests list up to 5 bullets per day, taking the top bullet of every project before the second, so one busy repo can't fill the day.

Lint runs and exploratory commands (`cat`, `grep`, `ls`…) are left out by default. To include a category, add it to [`summary.includeCategories`](/configuration#summary):

```bash
workscribe config set summary.includeCategories '["linting"]'
```

`workscribe summary --verbose` shows every captured event, marking the ones left out. That's where to look for run counts, which the summary no longer shows.

---

## AI-written summaries with your coding agent

Install the Workscribe skill into your coding agents (`workscribe init` offers this too):

```bash
workscribe skill install
```

Then ask the agent in plain language — *"summarize my work today"*, *"write my standup"*, *"what did I do this week?"* — or type `/workscribe` in Claude Code. The agent reads `workscribe sessions --json`, looks at your repos for context, writes one summary per session and saves it.

A saved summary is what `workscribe summary`, `workscribe context` and the VS Code status bar show for that session from then on. To see the template version instead for one run:

```bash
workscribe summary --fresh
```

See [`workscribe skill`](/commands#workscribe-skill) for installing, checking and removing the skill, and [Privacy](/privacy#the-workscribe-agent-skill) for exactly what the agent sends.

---

## Summaries from Workscribe 1.x

Summaries an AI provider or Ollama wrote in 1.x are kept and still shown for their sessions. Workscribe 2.0 doesn't write new ones — see [Migrating to 2.0](/migrating-to-2).
