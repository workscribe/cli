# Landing Page Plan — workscribe.co

## Overview

Single-page marketing site for Workscribe. Target audience: individual developers and small engineering teams. Tone: direct, low-hype, tool-confident. No animations for animations' sake. Every section earns its place.

The page should feel like it was made by a developer who has taste — not a SaaS template.

---

## Sections

### 1. Navigation

**Layout:** Fixed top bar, minimal.

| Element | Content |
|---|---|
| Logo | `workscribe` wordmark (monospace or geometric sans) |
| Links | How it works · Commands · Providers |
| CTA | `npm install -g @workscribe/cli` (copyable) or `Get started →` |

---

### 2. Hero

**Layout:** Full-width, vertically centred. Terminal demo on the right or below headline on mobile.

**Headline (draft options):**
- `Your work, automatically documented.`
- `Your terminal remembers. Now your standups do too.`
- `Capture what you build. Without thinking about it.`

**Subheadline:**
> Workscribe runs quietly in the background, turns your terminal activity into structured work sessions, and lets an AI write your daily summary. You just code.

**Primary CTA:**
> `npm install -g @workscribe/cli`  ← copyable code block

**Secondary CTA:**
> `See how it works ↓`

**Supporting detail (small text):**
> Node.js 22+ · macOS · Linux · Works with Anthropic, OpenAI, Ollama and more

**Terminal demo:**
Animated or static terminal block showing:
```
$ workscribe summary

## chronicle (main) — 3h 10m
- Implemented weekly summary prompt and provider methods
- Fixed project name resolution via git remote origin
- Added Slack webhook integration to summary command
```

---

### 3. How It Works

**Layout:** Three-step horizontal flow with icons, or numbered vertical list on mobile.

**Section headline:** `Three steps. Then it just runs.`

| Step | Headline | Body |
|---|---|---|
| 1 | Install & init | `npm install -g @workscribe/cli && workscribe init` — picks your AI provider and installs the shell hook |
| 2 | Work normally | Every command you run is silently captured, redacted, and stored locally in `~/.workscribe/` |
| 3 | Get your summary | Run `workscribe summary` at any time. Sessions are grouped, summarised by AI, and printed as markdown |

---

### 4. Feature Highlights

**Layout:** Two-column grid (icon + text). 4–6 tiles.

| Feature | Headline | Body |
|---|---|---|
| Privacy-first | Your data stays local | Nothing leaves your machine except structured event categories sent to your AI provider on demand |
| Credential-safe | Secrets never hit disk | Tokens, API keys, and passwords are redacted before any event is written |
| Provider-agnostic | Use any AI | Anthropic, OpenAI, Ollama (fully offline), or any OpenAI-compatible endpoint |
| Undo anything | Made a mistake? | `workscribe undo` removes the last captured event. `--dry-run` shows you what would be deleted first |
| Weekly view | Week in review | `workscribe summary --week` produces a theme-based summary across all sessions since Monday |
| Standup-ready | Post to Slack | `workscribe summary --slack` sends your summary straight to a configured webhook |

---

### 5. Terminal Showcase

**Layout:** Full-width dark panel. Static or tabbed terminal blocks.

**Section headline:** `Everything in your terminal.`

Show two or three tabbed examples:

**Tab 1 — Daily summary:**
```
$ workscribe summary

## api-service (feature/auth) — 2h 15m
- Set up authentication feature branch and installed JWT dependencies
- Resolved failing test suite for token validation logic
- Committed authentication middleware fixes

## infrastructure — 45m
- Restarted staging environment and verified deployment stability
- Investigated and resolved Docker networking issue in compose setup
```

**Tab 2 — Weekly summary:**
```
$ workscribe summary --week

## Week of 25 May — 11h 30m across 3 projects
**chronicle** (Mon–Wed): Built pre-IDE integration features — undo command,
weekly summaries, and Slack webhook support.
**api-service** (Thu): Auth middleware cleanup and dependency updates.
**infra** (Fri): Staging environment debugging and deploy verification.
```

**Tab 3 — Undo:**
```
$ workscribe undo --dry-run -n 3

Events to remove (3):
  2026-05-27T14:22:01Z  other  cd /tmp
  2026-05-27T14:21:55Z  other  echo $PATH
  2026-05-27T14:21:40Z  other  env

Dry run — nothing deleted.
```

---

### 6. AI Providers

**Layout:** Small icon grid or simple table.

**Section headline:** `Bring your own AI.`

**Body:**
> Workscribe works with the providers you already use — or keeps everything offline with Ollama.

| Provider | Notes |
|---|---|
| Anthropic (Claude) | Default model: claude-haiku-4-5 |
| OpenAI | Default model: gpt-4o-mini |
| Ollama | Fully local, no API key needed |
| OpenAI-compatible | Groq, Together, Mistral, and others |

**Config example:**
```bash
workscribe config set ai.provider anthropic
workscribe config set ai.apiKey sk-...
```

---

### 7. Install CTA

**Layout:** Centred, dark background panel.

**Headline:** `Start capturing in two minutes.`

**Body:**
> Node.js 22+, macOS or Linux.

```bash
npm install -g @workscribe/cli
workscribe init
```

**Supporting links:** GitHub · Docs · Changelog

---

### 8. Footer

| Column | Content |
|---|---|
| Product | Commands · Config · Privacy |
| Resources | GitHub · Changelog · npm |
| Legal | MIT License · Privacy Policy |
| Tagline | `workscribe.co — your work, automatically documented.` |

---

## Open Questions

- Does the site need a docs section or does it link out to GitHub README for now?
- Is there a waitlist / email capture needed before public npm release?
- Video demo vs static terminal blocks — video is higher impact but more production effort
