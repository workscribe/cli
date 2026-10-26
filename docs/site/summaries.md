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

For each session it lists, most important first (up to 7 bullets):

- your notes (`workscribe note`)
- commit messages
- test and build results — including "fixed after N failed runs"
- dependencies added or removed
- releases and pushes
- files edited in your IDE (when the VS Code extension is installed)

Sessions where nothing stands out get one line saying where the work happened. Weekly digests list up to 5 bullets per day, taking the top bullet of every project before the second, so one busy repo can't fill the day.

Lint runs and exploratory commands (`cat`, `grep`, `ls`…) are left out by default. To include a category, add it to [`summary.includeCategories`](/configuration#summary):

```bash
workscribe config set summary.includeCategories '["linting"]'
```

`workscribe summary --verbose` shows every captured event, marking the ones left out.

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
