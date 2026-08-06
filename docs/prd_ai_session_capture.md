# Workscribe — AI Session Capture PRD

**Version:** 1.1
**Date:** 2026-05-28
**Status:** Draft
**Scope:** Phase — AI Terminal Tool Integration

---

## 1. Overview

Developers increasingly use AI coding assistants directly in the terminal — Claude Code, Aider, Gemini CLI, GitHub Copilot CLI, Cody, and others. These tools can run for minutes or hours, producing dozens of file edits and commits in a single session.

Workscribe currently captures the `claude` or `aider` invocation as a generic `other` event and picks up the resulting git commits — but it loses the most valuable context: what the developer asked the AI to do and what it produced.

This PRD covers two things:
1. A minimal change that gives AI tool sessions a distinct category and visibility in summaries (short term)
2. A deeper integration that captures task context from AI sessions using each tool's native hook/event system (medium term)

---

## 2. Problem Being Solved

A developer runs:

```bash
claude
> implement OAuth2 login flow with refresh tokens
```

The AI edits 12 files, runs tests, and commits. Workscribe's current capture:

```
other        claude
code_commit  {"message": "feat: add OAuth2 login"}
```

The summary reads: "Committed OAuth2 login feature." The 45-minute AI session — the task, the scope, the iterations — is invisible.

With AI session capture, the summary should read:
```
## api-service (feature/auth) — 1h 10m
- Implemented OAuth2 login flow with refresh tokens via Claude Code session
- Resolved token expiry edge case during session iterations
- Committed OAuth2 implementation across 12 files
```

---

## 3. Goals

- Give AI terminal tool sessions a distinct `ai_session` category — visible in events, sessions, and summaries
- Capture task context (what was asked) where the tool's hook system allows it
- Zero new infrastructure — same subprocess model as shell hook and IDE plugins
- Tool registry driven by a JSON file — adding a new AI tool requires no code changes
- Work with the tools developers already use: Claude Code, Aider, Gemini CLI, Copilot CLI, Cody, Amazon Q

---

## 4. Out of Scope

- AI tools that run inside an IDE (Cursor, Copilot in VS Code) — covered by the IDE integration PRD
- Capturing the AI's output or generated code content
- Capturing conversation history or intermediate AI responses
- Team-level AI usage aggregation

---

## 5. Target Users

Developers who:
- Use AI coding assistants in the terminal as a primary development workflow
- Run long AI sessions that currently appear as a single `other` event in Workscribe
- Want their AI-assisted work reflected accurately in daily summaries

---

## 6. AI Tool Registry

Rather than hardcoding tool names and patterns in application code, all known AI tools are defined in a single JSON registry file: `src/capture/ai-tools.json`.

**Adding a new tool requires only a new JSON entry — no code changes.**

### 6.1 Registry schema

Each entry in the registry has:

| Field | Type | Description |
|---|---|---|
| `tool` | string | Display name used in metadata and summaries |
| `pattern` | string | Regex string matched against the raw command |
| `hook` | string \| null | Hook integration identifier — drives `workscribe init` |
| `contextSource` | string \| null | How task context is retrieved after the session |

### 6.2 `contextSource` values

| Value | Meaning |
|---|---|
| `"hook"` | Tool fires a hook on session end — Workscribe listens via `--type ai_session_end` |
| `"history-file"` | Tool writes a local history file that Workscribe reads post-session |
| `null` | No context available — invocation and duration only |

### 6.3 Current registry

```json
[
  {
    "tool": "claude",
    "pattern": "^claude\\b",
    "hook": "claude-code",
    "contextSource": "hook"
  },
  {
    "tool": "aider",
    "pattern": "^aider\\b",
    "hook": null,
    "contextSource": "history-file"
  },
  {
    "tool": "gemini",
    "pattern": "^gemini\\b",
    "hook": null,
    "contextSource": null
  },
  {
    "tool": "gh copilot",
    "pattern": "^gh\\s+copilot\\b",
    "hook": null,
    "contextSource": null
  },
  {
    "tool": "cody",
    "pattern": "^cody\\b",
    "hook": null,
    "contextSource": null
  },
  {
    "tool": "amazon-q",
    "pattern": "^q\\s+(chat|dev)\\b",
    "hook": null,
    "contextSource": null
  },
  {
    "tool": "continue",
    "pattern": "^continue\\b",
    "hook": null,
    "contextSource": null
  },
  {
    "tool": "cursor",
    "pattern": "^cursor\\b",
    "hook": null,
    "contextSource": null
  }
]
```

### 6.4 How the registry drives normalize rules

Instead of a hardcoded regex, `src/normalize/patterns.ts` reads the registry and builds one rule per entry:

```ts
import AI_TOOLS from '../capture/ai-tools.json'

for (const entry of AI_TOOLS) {
  RULES.push(
    makeRule(new RegExp(entry.pattern), 'ai_session', () => ({ tool: entry.tool }))
  )
}
```

### 6.5 How the registry drives `workscribe init`

`workscribe init` reads entries where `hook !== null`, checks if the tool is installed, and offers to install the corresponding hook. No tool names are hardcoded in the init flow.

---

## 7. Architecture

### 7.1 Phase 1 — Category and duration (all tools, immediate)

Add the registry and a single normalize rule loop. Every known AI tool invocation is captured as `ai_session` with the tool name in metadata. Duration comes from the shell hook's timing — already captured.

**Files changed:**
- `src/capture/ai-tools.json` — new registry file
- `src/normalize/patterns.ts` — registry-driven rule replaces any hardcoded AI tool rules
- `src/cli/events.ts` — add `ai_session` colour
- `src/ai/prompt.ts` — add `ai_session` guidance
- `tests/normalize.test.ts` — test cases for each registry entry

### 7.2 Phase 2 — Task context via Claude Code hooks

Claude Code has a first-class hooks system. A `Stop` hook fires when a session ends and executes a shell command.

**Hook installed by `workscribe init`** (written to `~/.claude/settings.json`):

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          "workscribe _capture --type ai_session_end --source claude-code --cwd \"$PWD\""
        ]
      }
    ]
  }
}
```

The `Stop` hook fires after every Claude Code session. Workscribe records the session end, giving accurate duration independent of the shell hook timing.

**`workscribe init` behaviour:**
1. Checks registry for entries with `hook !== null`
2. For each: runs `which <tool>` to detect if installed
3. If found, prompts user to install the hook
4. Merges into `~/.claude/settings.json` — never overwrites existing hooks

### 7.3 Phase 3 — Task context via Aider history file

Aider writes `.aider.chat.history.md` in the working directory. Workscribe reads the last user prompt from this file and stores it as metadata (truncated to 200 chars).

```ts
// src/capture/aider.ts
export function readLastAiderPrompt(cwd: string): string | null {
  try {
    const histPath = path.join(cwd, '.aider.chat.history.md')
    const content = fs.readFileSync(histPath, 'utf-8')
    const match = content.match(/#### \/.+\n+([\s\S]+?)(?=\n####|$)/)
    return match ? match[1].trim().slice(0, 200) : null
  } catch {
    return null
  }
}
```

### 7.4 Future — Gemini CLI stream output

Gemini CLI supports `--output-format stream-json` which emits newline-delimited JSON events. This could be used to capture session context but requires the user to invoke Gemini differently. Deferred until Gemini CLI's hook/plugin system matures.

---

## 8. Data Model

No schema changes required for Phase 1.

For Phase 2–3, the existing `metadata` JSON column stores task context:

```json
{
  "tool": "claude",
  "prompt": "implement OAuth2 login flow with refresh tokens",
  "source": "claude-code-hook"
}
```

---

## 9. AI Prompt Update

Add to `src/ai/prompt.ts` system prompt:

> "`ai_session` events represent a developer working with an AI coding assistant. If a `prompt` is available in metadata, use it to describe what was being built. Group `ai_session` events with the commits that followed them into a single narrative bullet."

---

## 10. Implementation Phases

### Phase 1 — Registry + normalize rule (this PR)

- [ ] Create `src/capture/ai-tools.json` with all 8 tool entries
- [ ] Update `src/normalize/patterns.ts` to build rules from registry
- [ ] Add `ai_session` colour to `src/cli/events.ts`
- [ ] Add `ai_session` guidance to `src/ai/prompt.ts`
- [ ] Add test cases to `tests/normalize.test.ts`

### Phase 2 — Claude Code hook

- [ ] Add Claude Code detection and hook install to `workscribe init`
- [ ] Handle `--type ai_session_end --source claude-code` in capture
- [ ] Read `hook` entries from registry in init flow — no hardcoded tool names
- [ ] Tests for hook install (safe merge, no overwrite)

### Phase 3 — Aider history file

- [ ] Add `src/capture/aider.ts` — `readLastAiderPrompt`
- [ ] Call on `ai_session` capture when `contextSource === "history-file"`
- [ ] Store prompt in metadata, truncated to 200 chars
- [ ] Tests: correct extraction, graceful handling of missing file

---

## 11. Open Questions

1. Should `workscribe init` auto-install the Claude Code hook, or only on explicit opt-in?
2. Should the Aider prompt be included in the AI payload, or kept local-only (privacy consideration)?
3. Should there be a `workscribe config set capture.aiTools false` option to disable AI session capture entirely?
4. For tools with no hook system — is `ai_session` category with duration sufficient, or should we prompt for a manual task annotation post-session?
5. Should users be able to add custom entries to the registry via config, for internal AI tools not in the default list?
