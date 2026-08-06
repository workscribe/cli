---
title: Configuration
description: Full reference for all Workscribe configuration options.
---

# Configuration

Config is stored at `~/.workscribe/config.json` with owner-only permissions (`0600`).

Use `workscribe config set <key> <value>` to update any value. Nested keys use dot notation.

---

## AI

| Key | Type | Default | Description |
|---|---|---|---|
| `ai.provider` | string | `""` | AI provider to use: `anthropic`, `openai`, `ollama`, `openai-compatible` |
| `ai.apiKey` | string | `""` | API key for the selected provider |
| `ai.model` | string | `""` | Model override (uses provider default if empty) |
| `ai.baseUrl` | string | `""` | Base URL for `openai-compatible` providers |

**Provider defaults:**

| Provider | Default model |
|---|---|
| `anthropic` | `claude-haiku-4-5-20251001` |
| `openai` | `gpt-4o-mini` |
| `ollama` | `llama3` |
| `openai-compatible` | — (set `ai.model` manually) |

```bash
workscribe config set ai.provider anthropic
workscribe config set ai.apiKey sk-ant-...
workscribe config set ai.model claude-sonnet-4-6
```

---

## Session

| Key | Type | Default | Description |
|---|---|---|---|
| `session.idleTimeout` | number | `30` | Minutes of inactivity before a new session starts |

```bash
workscribe config set session.idleTimeout 20
```

---

## Capture

| Key | Type | Default | Description |
|---|---|---|---|
| `capture.ignore` | string[] | `["cd", "ls", "pwd", …]` | Commands to ignore — matched against the base command |

The default ignore list: `cd`, `ls`, `ll`, `la`, `ls -la`, `ls -l`, `ls -a`, `pwd`, `clear`, `exit`, `history`, `man`.

```bash
# Add a command to the ignore list
workscribe config set capture.ignore '["cd","ls","htop","top"]'
```

---

## Redact

| Key | Type | Default | Description |
|---|---|---|---|
| `redact.extra` | string[] | `[]` | Additional regex patterns to redact from captured commands |

Workscribe automatically redacts common secret patterns (tokens, API keys, passwords, JWTs). Use `redact.extra` to add custom patterns.

```bash
workscribe config set redact.extra '["MY_INTERNAL_TOKEN"]'
```

---

## Summary

| Key | Type | Default | Description |
|---|---|---|---|
| `summary.format` | `"markdown"` \| `"json"` | `"markdown"` | Output format for daily summaries |

In `json` mode, `workscribe summary` outputs structured data instead of markdown:

```json
{
  "date": "2026-05-28",
  "sessions": [
    {
      "project": "api-service",
      "branch": "feature/auth",
      "durationMinutes": 135,
      "bullets": [
        "Added authentication dependencies (bcrypt, JWT)",
        "Resolved failing auth tests",
        "Committed and pushed authentication fixes"
      ]
    }
  ]
}
```

Weekly summaries (`--week`) always output markdown regardless of this setting.

```bash
workscribe config set summary.format json
```

---

## Projects

Override the display name for a repository whose local folder name differs from the actual project name.

| Key | Type | Description |
|---|---|---|
| `projects.<absolute-path>` | string | Display name to use for this path |

```bash
workscribe config set projects./Users/me/sandbox/chronicle workscribe
```

**Priority order for project name resolution:**
1. Config override (this setting)
2. `git remote get-url origin` — extracts repo name from the remote URL
3. `package.json` `name` field (strips `@scope/` prefix)
4. Folder name (fallback)

---

## Integrations

| Key | Type | Description |
|---|---|---|
| `integrations.slackWebhook` | string | Slack Incoming Webhook URL — used with `workscribe summary --slack` |
| `integrations.webhook` | string | Generic webhook URL — POST `{ text: "..." }` |

```bash
workscribe config set integrations.slackWebhook https://hooks.slack.com/services/...
workscribe summary --slack
```

Webhook URLs are masked in both `workscribe config` and `workscribe config get` output — showing only the first four characters and total length. This confirms a value is set without exposing it in terminal history.

### Getting a Slack Incoming Webhook URL

Incoming Webhooks are available on all Slack plans, including the free tier. You need to be a **workspace member** — no admin role required to create an app and install it to a channel you have access to.

1. Go to **[api.slack.com/apps](https://api.slack.com/apps)** and click **Create New App**
2. Select **From scratch**, name your app (e.g. "Workscribe"), and choose your workspace
3. In the left sidebar under **Features**, click **Incoming Webhooks**
4. Toggle **Activate Incoming Webhooks** to **On**
5. Click **Add New Webhook to Workspace**
6. Select the channel or DM where summaries should be posted, then click **Allow**
7. Copy the webhook URL — it starts with `https://hooks.slack.com/services/`

Then set it in workscribe:

```bash
workscribe config set integrations.slackWebhook https://hooks.slack.com/services/T.../B.../xxx
```

> **Security note:** The webhook URL is the only credential — anyone with it can post to your channel. Workscribe automatically redacts it from captured commands so it never appears in your event log.

---

## Full example config

```json
{
  "ai": {
    "provider": "anthropic",
    "apiKey": "sk-ant-...",
    "model": "claude-haiku-4-5-20251001",
    "baseUrl": ""
  },
  "session": {
    "idleTimeout": 30
  },
  "capture": {
    "ignore": ["cd", "ls", "ll", "la", "pwd", "clear", "exit", "history", "man"]
  },
  "redact": {
    "extra": []
  },
  "summary": {
    "format": "markdown"
  },
  "projects": {
    "/Users/me/sandbox/chronicle": "workscribe"
  },
  "integrations": {
    "slackWebhook": "https://hooks.slack.com/services/..."
  }
}
```
