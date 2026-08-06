---
title: AI Providers
description: Configure Workscribe to work with Anthropic, OpenAI, Ollama, or any OpenAI-compatible endpoint.
---

# AI Providers

Workscribe sends structured event data to your AI provider only when you explicitly run `workscribe summary`. It never sends raw commands, file contents, or file paths — only event categories and metadata.

---

## Anthropic (Claude)

```bash
workscribe config set ai.provider anthropic
workscribe config set ai.apiKey sk-ant-...
```

| Setting | Value |
|---|---|
| Default model | `claude-haiku-4-5-20251001` |
| API key required | Yes |

Override the model:

```bash
workscribe config set ai.model claude-sonnet-4-6
```

Get an API key at [console.anthropic.com](https://console.anthropic.com).

---

## OpenAI

```bash
workscribe config set ai.provider openai
workscribe config set ai.apiKey sk-...
```

| Setting | Value |
|---|---|
| Default model | `gpt-4o-mini` |
| API key required | Yes |

Override the model:

```bash
workscribe config set ai.model gpt-4o
```

Get an API key at [platform.openai.com](https://platform.openai.com).

---

## Ollama (local)

Run AI summaries entirely on your machine — no API key, no external calls, fully offline.

```bash
workscribe config set ai.provider ollama
```

| Setting | Value |
|---|---|
| Default model | `llama3` |
| API key required | No |
| Base URL | `http://localhost:11434` |

**Requirements:**
1. Install Ollama: [ollama.com](https://ollama.com)
2. Pull a model: `ollama pull llama3`
3. Start Ollama: `ollama serve`

Override the model:

```bash
workscribe config set ai.model mistral
```

---

## OpenAI-compatible

Works with any endpoint that implements the OpenAI chat completions API — Groq, Together AI, Mistral, and others.

```bash
workscribe config set ai.provider openai-compatible
workscribe config set ai.apiKey <your-key>
workscribe config set ai.baseUrl https://api.groq.com/openai/v1
workscribe config set ai.model llama-3.1-70b-versatile
```

| Setting | Value |
|---|---|
| Default model | None — set `ai.model` manually |
| API key required | Depends on provider |
| Base URL required | Yes |

---

## Switching providers

Switch at any time — existing summaries are cached in the database and unaffected:

```bash
workscribe config set ai.provider ollama
```

---

## Troubleshooting

**"AI provider not configured"**
Run `workscribe config set ai.provider <provider>` and ensure an API key is set if required.

**Ollama: connection refused**
Make sure Ollama is running: `ollama serve`

**Anthropic / OpenAI: 401 Unauthorized**
Check your API key: `workscribe config get ai.apiKey`

**Summary quality is poor on local models**
Try a larger model: `workscribe config set ai.model llama3:70b`. Local models with fewer than 7B parameters may produce inconsistent output.
