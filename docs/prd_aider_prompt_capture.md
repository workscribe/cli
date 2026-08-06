# Workscribe — Aider Prompt Capture

**Version:** 1.0
**Date:** 2026-05-28
**Status:** Planned
**Scope:** Phase — Aider History File Integration

---

## 1. Overview

Aider writes a local chat history file (`.aider.chat.history.md`) in the working directory after every session. Workscribe can read the last user prompt from this file and store it as metadata on the `ai_session` event, giving the AI summarizer enough context to produce a meaningful bullet instead of "Aider session".

This is deferred from v1.4.0 due to privacy considerations that need careful handling before shipping.

---

## 2. What Would Be Captured

From `.aider.chat.history.md`, Workscribe reads the last user prompt — the natural language instruction sent to Aider:

> "refactor the payment service to extract the billing logic into a separate module and add tests"

Stored as `metadata.prompt` (truncated to 200 chars) on the `ai_session` event:

```json
{
  "tool": "aider",
  "commits": ["refactor: extract billing logic", "test: add billing module tests"],
  "prompt": "refactor the payment service to extract the billing logic into a separate module and add tests"
}
```

The summary AI uses this to produce:

```
- Refactored payment service via Aider — extracted billing module and added test coverage
```

---

## 3. Privacy Considerations

Unlike git commit messages (intentionally public and formatted), prompts are private developer intent. Risks:

| Risk | Example | Mitigatable? |
|---|---|---|
| Business context | "update the [internal codename] integration" | No — subjective |
| Accidental secrets | "set the password to abc123 in the config" | Partial — redact.ts catches patterns |
| PII | "fix the bug for customer john@example.com" | Partial — no PII patterns in redact.ts |
| Internal system names | "connect to the [internal DB name] cluster" | No |

`redact.ts` was designed for credential patterns in shell commands — it is not sufficient on its own for natural language prompts.

---

## 4. Design Decisions

### 4.1 Opt-in by default

```json
// ~/.workscribe/config.json
{
  "capture": {
    "aiPrompts": false
  }
}
```

Default `false`. Users explicitly enable with:

```bash
workscribe config set capture.aiPrompts true
```

### 4.2 `workscribe init` disclosure

When Aider is detected during `workscribe init`, display a note:

```
  Aider detected.
  Workscribe can read your last Aider prompt to improve summaries.
  Prompts may contain sensitive context — disabled by default.
  Enable with: workscribe config set capture.aiPrompts true
```

Do not prompt with a yes/no — this requires deliberate opt-in.

### 4.3 Best-effort redaction

Run the prompt through `redact.ts` before storing. Document clearly in config reference and privacy docs that `redact.ts` catches credential patterns but not general sensitive language.

### 4.4 Truncation

Truncate to 200 chars before storing. Keeps metadata small and reduces exposure surface.

---

## 5. Implementation

### 5.1 New file: `src/capture/aider.ts`

```ts
import fs from 'fs'
import path from 'path'

export function readLastAiderPrompt(cwd: string): string | null {
  try {
    const histPath = path.join(cwd, '.aider.chat.history.md')
    const content = fs.readFileSync(histPath, 'utf-8')
    const match = content.match(/^#### .+\n+([\s\S]+?)(?=\n####|$)/m)
    return match ? match[1].trim().slice(0, 200) : null
  } catch {
    return null
  }
}
```

### 5.2 Update `src/capture/index.ts`

After normalizing to `ai_session`, if `tool === 'aider'` and `config.capture.aiPrompts === true`:
1. Call `readLastAiderPrompt(cwd)`
2. Run result through `redact(prompt)`
3. Store as `metadata.prompt`

### 5.3 Update `src/config/index.ts`

Add `aiPrompts: boolean` to `capture` config block. Default `false`.

### 5.4 Update `src/capture/hooks/index.ts`

Add Aider detection to `workscribe init` — display the disclosure note when `aider` is on PATH. No install step (no hook to install for Aider).

---

## 6. Files Changed

| File | Change |
|---|---|
| `src/capture/aider.ts` | New — `readLastAiderPrompt` |
| `src/capture/index.ts` | Call aider capture when `aiPrompts === true` |
| `src/config/index.ts` | Add `capture.aiPrompts: false` default |
| `src/cli/init.ts` | Show disclosure when Aider detected |
| `docs/site/configuration.md` | Document `capture.aiPrompts` |
| `docs/site/privacy.md` | Document prompt capture limitations |
| `tests/aider.test.ts` | Unit tests for `readLastAiderPrompt` |

---

## 7. Open Questions

1. Should truncation happen before or after redaction? (Before — limits redact work)
2. Should the prompt be included in weekly summaries, or daily only?
3. If a user disables `capture.aiPrompts` after enabling it, should existing stored prompts be purged?
