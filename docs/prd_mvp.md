# Chronicle — MVP Product Requirements Document

**Version:** 1.1  
**Date:** 2026-05-23  
**Status:** Draft  
**Scope:** MVP (Local-only, single user)

---

## 1. Overview

Chronicle is a CLI tool that passively captures developer terminal activity and transforms it into readable daily work summaries — without the developer needing to write anything manually.

The MVP is local-only, single-user, and produces markdown reports. No cloud, no dashboard, no team features.

---

## 2. Problem Being Solved

Developers do real work that never gets documented:
- Debugging sessions with no commit
- Environment setup and dependency resolution
- Infrastructure investigation
- Test failures and fixes

The MVP solves this for a single developer by capturing everything they do in the terminal and summarizing it automatically at the end of the day.

---

## 3. MVP Goals

- Capture terminal commands passively with zero workflow disruption
- Normalize raw commands into typed, meaningful events
- Group events into work sessions automatically
- Generate a readable daily summary using AI
- Output clean markdown the developer can copy into a standup or journal

---

## 4. Out of Scope for MVP

- Browser or IDE tracking
- Cloud sync or remote storage
- Team features or shared dashboards
- Slack / Notion / Jira integrations
- Web UI or dashboard
- Windows support (Phase 2)
- Fish shell support (Phase 2)

---

## 5. Target User

A solo developer or freelancer who:
- Works primarily in the terminal (zsh or bash)
- Wants automatic standup notes or client updates
- Is comfortable installing a CLI tool and sourcing a shell script

---

## 6. User Stories

### Core

| ID | As a developer, I want to... | So that... |
|---|---|---|
| US-01 | Install Chronicle in under 5 minutes | I can start capturing immediately |
| US-02 | Have my terminal commands captured automatically | I don't have to do anything manually |
| US-03 | Get a summary of what I did today | I can paste it into a standup without writing it myself |
| US-04 | See summaries broken down by project/repo | I can separate client work easily |
| US-05 | Get a summary of any past day | I can fill in a timesheet or write a retrospective |
| US-09 | Choose which AI provider powers my summaries | I'm not locked into one service or forced to pay for one I don't use |

### Secondary

| ID | As a developer, I want to... | So that... |
|---|---|---|
| US-06 | See what sessions Chronicle detected | I can verify it understood my work correctly |
| US-07 | Exclude sensitive commands from capture | I can trust Chronicle isn't logging credentials |
| US-08 | Export a summary as a markdown file | I can save or share it |
| US-10 | Use a local AI model with no API key | I can use Chronicle fully offline and for free |

---

## 7. Functional Requirements

### 7.1 Installation

- `FR-01` — Chronicle installs via a single npm global install command
- `FR-02` — `chronicle init` adds the shell hook to `~/.zshrc` or `~/.bashrc` automatically
- `FR-03` — The hook is non-blocking and adds no perceptible latency to the terminal
- `FR-04` — `chronicle init` creates `~/.chronicle/` directory with SQLite database

### 7.2 Event Capture

- `FR-05` — Every command executed in the terminal is captured with: command string, working directory, exit code, timestamp, duration
- `FR-06` — Capture works across all terminal windows and tmux panes in the same shell session
- `FR-07` — The following commands are automatically filtered (not captured): `cd`, `ls`, `ll`, `la`, `ls -la`, `pwd`, `clear`, `exit`, `history`, `man`, empty commands, and exact duplicate of the immediately preceding command
- `FR-08` — Commands containing sensitive patterns are redacted before storage (see §7.6)
- `FR-08b` — Duplicate events (same command, same cwd, within 5 seconds) are deduplicated at ingest — only one is stored

### 7.3 Event Normalization

- `FR-09` — Raw commands are normalized into typed events with a category and metadata
- `FR-10` — The normalizer classifies at minimum the following categories:

| Category | Examples |
|---|---|
| `dependency_install` | npm install, pip install, cargo add, brew install |
| `dependency_remove` | npm uninstall, pip uninstall |
| `code_commit` | git commit |
| `code_push` | git push |
| `code_pull` | git pull, git fetch |
| `branch_switch` | git checkout, git switch |
| `test_run` | npm test, pytest, go test, jest, rspec |
| `build` | npm run build, make, cargo build, docker build |
| `server_run` | npm run dev, npm start, python manage.py runserver |
| `infrastructure` | ssh, kubectl, helm, terraform, docker run |
| `script_run` | bash script.sh, node script.js, python script.py |
| `environment` | export, source, .env file operations |
| `other` | anything not matched above |

- `FR-11` — Unrecognized commands are stored as category `other` and not discarded
- `FR-12` — Git context (repo name, branch) is extracted and attached to every event

### 7.4 Session Detection

- `FR-13` — Events are grouped into sessions automatically
- `FR-14` — A new session begins when there is a gap of 30 minutes or more between commands (configurable)
- `FR-15` — A session is also split when the working repository changes mid-session (creates a sub-session per repo)
- `FR-16` — Each session has: start time, end time, duration, primary repo, event count, list of events
- `FR-17` — Sessions spanning midnight are split at midnight and attributed to their respective days

### 7.5 AI Summarization

- `FR-18` — `chronicle summary` generates a summary for today using the configured AI provider
- `FR-18b` — If no AI provider is configured, Chronicle prints a clear error with the exact command to fix it: `chronicle config set ai.provider <provider>`
- `FR-19` — The AI receives structured event objects — not raw command strings
- `FR-20` — Summaries are grouped by repository/project
- `FR-21` — Each project section contains 3–6 bullet points describing what was accomplished
- `FR-22` — The output tone is professional, past-tense, action-oriented (suitable for a standup or client update)
- `FR-23` — A generated summary is cached locally so repeat calls don't re-invoke the API
- `FR-24` — `--fresh` flag bypasses cache and regenerates

### 7.5a AI Provider Configuration

Chronicle treats the AI layer as a pluggable adapter. The provider is selected via `ai.provider` in config.

**Supported providers in MVP:**

| Provider | `ai.provider` value | Requires | Notes |
|---|---|---|---|
| Anthropic (Claude) | `anthropic` | `ai.apiKey` | Haiku default, fast + cheap |
| OpenAI | `openai` | `ai.apiKey` | GPT-4o-mini default |
| Ollama (local) | `ollama` | Ollama running locally | Free, offline, no key needed |
| OpenAI-compatible | `openai-compatible` | `ai.apiKey` + `ai.baseUrl` | Groq, Together, Mistral, etc. |

- `FR-29` — Each provider adapter implements a common interface: `summarize(payload: SessionPayload): Promise<string>`
- `FR-30` — Switching providers requires only a config change — no code changes
- `FR-31` — For `ollama`, Chronicle uses `http://localhost:11434` by default; model defaults to `llama3`
- `FR-32` — For `openai-compatible`, `ai.baseUrl` must be set; Chronicle sends standard OpenAI `/v1/chat/completions` requests
- `FR-33` — If the provider call fails, Chronicle prints the error reason and the provider name — never a generic failure

### 7.6 Security & Redaction

- `FR-25` — Before any event is written to SQLite, the command string is scanned for sensitive patterns
- `FR-26` — The following patterns are redacted (replaced with `[REDACTED]`):
  - Strings matching `AKIA[0-9A-Z]{16}` (AWS access keys)
  - Strings matching `ghp_[a-zA-Z0-9]{36}` (GitHub tokens)
  - JWT tokens (three base64 segments separated by dots)
  - Arguments to `-p`, `--password`, `-token`, `--secret`, `--key` flags
  - Values after `export VAR=` where VAR contains: TOKEN, SECRET, KEY, PASSWORD, PASS, AUTH
- `FR-27` — `chronicle config set redact.extra "PATTERN"` adds custom redaction patterns
- `FR-28` — No data is ever sent to any remote server except the configured AI provider API for summarization. If `ollama` is configured, all data stays on-device.

### 7.7 CLI Commands

| Command | Description |
|---|---|
| `chronicle init` | Install shell hooks and create local database |
| `chronicle summary` | Generate and print today's summary |
| `chronicle summary --date 2026-05-20` | Summary for a specific date |
| `chronicle summary --week` | Summary for the current week |
| `chronicle sessions` | List detected sessions for today |
| `chronicle sessions --date 2026-05-20` | Sessions for a specific date |
| `chronicle events` | List raw captured events for today |
| `chronicle export` | Export today's summary as a markdown file |
| `chronicle export --date 2026-05-20` | Export a specific day |
| `chronicle config` | View current configuration |
| `chronicle config set KEY VALUE` | Set a config value |
| `chronicle status` | Show if capture is active, event count, last captured command |

### 7.8 Configuration

Chronicle stores config in `~/.chronicle/config.json`. Configurable values:

| Key | Default | Description |
|---|---|---|
| `session.idleTimeout` | `30` | Minutes of inactivity before new session |
| `ai.provider` | `""` | AI provider: `anthropic`, `openai`, `ollama`, `openai-compatible` |
| `ai.apiKey` | `""` | API key for the configured provider (not needed for `ollama`) |
| `ai.model` | `""` | Model override — defaults per provider if unset (see §7.5a) |
| `ai.baseUrl` | `""` | Base URL for `openai-compatible` providers (e.g. `https://api.groq.com/openai/v1`) |
| `redact.extra` | `[]` | Additional regex patterns to redact |
| `capture.ignore` | `["cd","ls","ll","la","pwd","clear"]` | Commands to ignore |
| `summary.format` | `"markdown"` | Output format: `markdown` or `json` |

**Default models per provider (used when `ai.model` is unset):**

| Provider | Default model |
|---|---|
| `anthropic` | `claude-haiku-4-5-20251001` |
| `openai` | `gpt-4o-mini` |
| `ollama` | `llama3` |
| `openai-compatible` | must be set explicitly via `ai.model` |

---

## 8. Data Models

### events table

```sql
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at TEXT NOT NULL,          -- ISO 8601 timestamp
  command     TEXT NOT NULL,          -- redacted command string
  cwd         TEXT NOT NULL,          -- working directory
  exit_code   INTEGER,
  duration_ms INTEGER,
  repo_name   TEXT,                   -- extracted from git, nullable
  branch      TEXT,                   -- current git branch, nullable
  category    TEXT NOT NULL,          -- normalized category
  metadata    TEXT                    -- JSON blob of extracted metadata
);
```

### sessions table

```sql
CREATE TABLE sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  date        TEXT NOT NULL,          -- YYYY-MM-DD
  started_at  TEXT NOT NULL,
  ended_at    TEXT NOT NULL,
  repo_name   TEXT,
  event_count INTEGER NOT NULL,
  summary     TEXT                    -- cached AI summary, nullable
);
```

### session_events table

```sql
CREATE TABLE session_events (
  session_id  INTEGER NOT NULL REFERENCES sessions(id),
  event_id    INTEGER NOT NULL REFERENCES events(id),
  PRIMARY KEY (session_id, event_id)
);
```

---

## 9. AI Summarization Spec

> The summarization spec is provider-agnostic. All providers receive the same structured payload and are expected to return the same output format. Provider adapters handle the translation to each API's request format.

### Input to AI

The AI receives a structured JSON payload — never raw command strings:

```json
{
  "date": "2026-05-23",
  "project": "api-service",
  "branch": "feature/auth",
  "sessions": [
    {
      "startTime": "10:00",
      "endTime": "11:30",
      "durationMinutes": 90,
      "events": [
        { "category": "branch_switch", "branch": "feature/auth" },
        { "category": "dependency_install", "tool": "npm", "packages": ["bcrypt", "jsonwebtoken"] },
        { "category": "test_run", "tool": "jest", "exitCode": 1 },
        { "category": "test_run", "tool": "jest", "exitCode": 0 },
        { "category": "code_commit", "message": "fix: auth token validation" }
      ]
    }
  ]
}
```

### System Prompt

```
You are a technical writer generating a work summary for a software developer.

Rules:
- Write in past tense, professional tone
- Describe what was ACCOMPLISHED, not what commands were run
- Never write "ran npm install" — write "added authentication dependencies"
- Never list commands literally
- Each bullet point should describe a meaningful unit of work
- Group related events into single bullet points
- If tests failed then passed, describe it as "resolved failing tests" not two separate events
- Return 3–6 bullet points per project section
- Do not pad or add filler sentences
- Output only the bullet points, no headers, no preamble
```

### Output Format

```markdown
## api-service (feature/auth) — 1h 30m

- Switched focus to the authentication feature branch
- Added JWT and bcrypt dependencies for token-based authentication
- Resolved failing test suite for auth token validation
- Committed authentication fixes
```

---

## 10. Shell Hook Spec

### Zsh

Added to `~/.zshrc` by `chronicle init`:

```zsh
# Chronicle — developer work journal
_chronicle_preexec() {
  _chronicle_cmd_start=$EPOCHREALTIME
  _chronicle_cmd="$1"
}

_chronicle_precmd() {
  local exit_code=$?
  if [[ -n "$_chronicle_cmd" ]]; then
    local duration_ms=$(( (EPOCHREALTIME - _chronicle_cmd_start) * 1000 ))
    chronicle _capture \
      --cmd "$_chronicle_cmd" \
      --cwd "$PWD" \
      --exit "$exit_code" \
      --duration "$duration_ms" \
      2>/dev/null &!
    _chronicle_cmd=""
  fi
}

autoload -Uz add-zsh-hook
add-zsh-hook preexec _chronicle_preexec
add-zsh-hook precmd _chronicle_precmd
```

### Bash

Added to `~/.bashrc`:

```bash
# Chronicle — developer work journal
_chronicle_preexec() {
  _chronicle_cmd_start=$(date +%s%3N)
  _chronicle_last_cmd="$BASH_COMMAND"
}

_chronicle_precmd() {
  local exit_code=$?
  if [[ -n "$_chronicle_last_cmd" ]]; then
    local now=$(date +%s%3N)
    local duration=$(( now - _chronicle_cmd_start ))
    chronicle _capture \
      --cmd "$_chronicle_last_cmd" \
      --cwd "$PWD" \
      --exit "$exit_code" \
      --duration "$duration" \
      2>/dev/null &
    _chronicle_last_cmd=""
  fi
}

trap '_chronicle_preexec' DEBUG
PROMPT_COMMAND="_chronicle_precmd;${PROMPT_COMMAND}"
```

**Key constraint:** The hook must run `chronicle _capture` in the background (`&!` / `&`) to never block the terminal prompt.

---

## 11. Installation Flow

```
npm install -g @workscribe/cli

chronicle init
→ Detects shell (zsh/bash)
→ Appends hook to ~/.zshrc or ~/.bashrc (backs up existing file first)
→ Creates ~/.chronicle/ directory
→ Creates ~/.chronicle/chronicle.db (SQLite)
→ Creates ~/.chronicle/config.json with defaults
→ Asks: "Which AI provider do you want to use?"
    [1] Anthropic (Claude) — requires API key
    [2] OpenAI              — requires API key
    [3] Ollama (local)      — free, runs on your machine
    [4] Other (OpenAI-compatible) — requires base URL + API key
    [5] Skip — configure later with: chronicle config set ai.provider <name>
→ If key required: prompts for API key, stores in config
→ Prints: "Capture active. Restart your terminal or run: source ~/.zshrc"
```

---

## 12. Non-Functional Requirements

- `NFR-01` — Shell hook adds < 50ms to terminal prompt in all cases (runs async)
- `NFR-02` — SQLite database must not exceed 100MB for 1 year of typical usage
- `NFR-03` — `chronicle summary` must complete in under 15 seconds (including API call)
- `NFR-04` — All local data stored in `~/.chronicle/` — nothing written elsewhere
- `NFR-05` — Works on macOS (zsh default) and Linux (bash/zsh)
- `NFR-06` — Node.js >= 18 required

---

## 13. Success Criteria for MVP

| Metric | Target |
|---|---|
| Install time | Under 5 minutes from zero |
| Hook latency | Zero perceptible impact on terminal |
| Summary quality | Developer can use output in a standup without editing |
| Redaction | No credentials appear in the database |
| Crash tolerance | Hook failure does not affect the terminal session |

---

## 14. MVP Milestone Plan

| Milestone | Deliverable |
|---|---|
| M1 — Capture | Shell hooks installed, events written to SQLite |
| M2 — Normalize | Event classification working for top 15 command patterns + deduplication |
| M3 — Sessions | Automatic session grouping by idle time and repo |
| M4 — Summarize | `chronicle summary` working with at least one provider (Anthropic or Ollama) |
| M5 — Providers | All four provider adapters implemented and switchable via config |
| M6 — Polish | `chronicle init` wizard, full config system, redaction, error handling |

---

## 15. Open Questions

1. Should Chronicle capture commands run via `make` or shell scripts (child processes), or only direct terminal input?
2. ~~What should happen when the API key is missing?~~ **Resolved:** Print a clear error with the exact fix command. If using `ollama`, no key is needed.
3. ~~Should `chronicle init` back up the existing `.zshrc`?~~ **Resolved:** Yes — always back up before modifying.
4. Is there value in a `chronicle undo` command to remove the last N captured events (e.g. after an accidental password entry)?
5. For `ollama`, should Chronicle verify the model is pulled before trying to summarize, and offer to pull it automatically?
6. Should provider-specific errors (rate limits, quota exceeded) suggest switching to `ollama` as a fallback?
