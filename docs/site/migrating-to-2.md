---
title: Migrating to 2.0
description: What changed in Workscribe 2.0 — AI providers removed, summaries offline by default, AI-written summaries through your coding agent.
---

# Migrating to 2.0

Workscribe 2.0 removes AI providers. It no longer calls Anthropic, OpenAI, Gemini, Groq, Ollama or any OpenAI-compatible endpoint, and it no longer needs an API key.

- `workscribe summary`, `week` and `export` use the offline [template engine](/summaries#the-template-engine).
- For AI-written summaries, ask the coding agent you already use. The [Workscribe skill](/summaries#ai-written-summaries-with-your-coding-agent) reads your sessions and writes the summary.

Capture, sessions, notes, Slack and webhooks, cron jobs and the VS Code extension all keep working unchanged.

---

## Step 1: Upgrade and run init

```bash
npm install -g @workscribe/cli
workscribe init
```

`init` asks to remove your old AI settings — `ai.provider`, `ai.apiKey`, `ai.model`, `ai.baseUrl` and `summary.engine` — from `~/.workscribe/config.json`. Answer **yes** to delete them, including the stored API key. It also offers to install the Workscribe skill into the coding agents it finds.

Until those settings are removed, `summary`, `week`, `export` and `status` print a one-line notice (on stderr, so JSON output and pipes aren't affected).

## Step 2: Choose how you want summaries

**Offline, no set-up:** keep running `workscribe summary`. You'll get outcome bullets — commits, tests and builds, dependencies, notes — instead of prose.

**AI-written:** ask your coding agent to *"summarize my work today"* (or type `/workscribe` in Claude Code). The summary is saved, so `workscribe summary`, `--slack` and the VS Code status bar show it.

---

## What happens to…

**Cloud provider users (Anthropic, OpenAI, Gemini, Groq, OpenAI-compatible):** summaries switch to the template. For prose, use the agent skill — your coding agent already has a model provider configured.

**Ollama users:** Ollama support is removed too. The template engine is fully offline, so summaries still never leave your machine. AI-written prose now comes only from the agent skill, which sends session data to the agent's model provider — there's no longer a fully offline way to get prose.

**Summaries you already have:** summaries written in 1.x are kept in your database and still shown for their sessions. `workscribe summary --fresh` shows the template version instead.

**Weekly digests:** always rendered fresh by the template. Old files in `~/.workscribe/weekly-cache/` aren't used any more; you can delete them.

**Slack, webhooks and cron:** unchanged. `workscribe summary --slack` and scheduled runs post the template summary, or the skill's saved summary for sessions your agent summarized.

**VS Code status bar:** unchanged. It shows a session's saved summary when there is one, otherwise the template.

**Profiles:** profile rules keep classifying your commands. Profile `aiContext` text is no longer used.

**`workscribe config set ai.…` or `summary.engine`:** refused with a message pointing to the agent skill.
