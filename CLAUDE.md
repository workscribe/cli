# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # compile TypeScript → dist/ (runs postbuild to fix node:sqlite require)
npm test             # run full test suite (vitest)
npm run test:watch   # vitest in watch mode
npm run typecheck    # tsc without emitting
npm link             # make `workscribe` available on PATH during development
```

Run a single test file:
```bash
npx vitest run tests/redact.test.ts
```

Run tests matching a name:
```bash
npx vitest run -t "splits into two groups"
```

After editing source, rebuild and re-link before testing the CLI manually:
```bash
npm run build && workscribe status
```

## Architecture

Workscribe is a passive terminal activity capture tool. The data flows in one direction:

```
shell hook → workscribe _capture → capture pipeline → SQLite
                                                         ↓
workscribe summary → session detector → template engine → markdown output
                                          (the agent skill writes AI prose and saves it via `sessions summary set`)
```

### Key design decisions

**`node:sqlite` instead of `better-sqlite3`** — uses Node 22+'s built-in synchronous SQLite. `tsup` strips the `node:` prefix when bundling CJS, so `postbuild` patches it back with a string replace. Do not change this without updating `package.json`'s `postbuild` script.

**Capture path is fully synchronous and must never throw** — `workscribe _capture` is called from the shell hook as a background process (`&!`). Errors are swallowed and optionally written to `~/.workscribe/debug.log` when `WORKSCRIBE_DEBUG=1` is set.

**No AI providers since 2.0** — Workscribe makes no AI API calls of its own. `summary`, `week` and `export` get their writer from `createSummaryWriter` (`src/summary/writer.ts`), which always returns the offline `TemplateProvider` (`src/ai/engines/template/`, implementing the `AIProvider` interface in `src/ai/types.ts`). AI-written prose comes from the agent skill (`skills/workscribe/`), which saves through `sessions summary set`. Template summaries are rendered live and never stored; `session_summaries` holds skill summaries plus `provider`/`ollama`/`legacy` rows from 1.x, which are still shown (see `src/summary/store.ts`). 1.x `ai.*` and `summary.engine` settings are read only to print a once-per-run notice on stderr, refuse `config set`, offer cleanup in `init` and redact keys (`src/summary/legacy-ai.ts`).

**Sessions are computed on demand, not during capture** — `workscribe _capture` only writes to the `events` table. Session grouping runs when `workscribe sessions` or `workscribe summary` is called, caches results in the `sessions` table, and invalidates when the event count changes.

**Pure functions are extracted for testability** — DB-touching code and pure logic are kept separate:
- `src/capture/filter.ts` — `shouldFilter` and `isDuplicate` (pure, no DB)
- `src/sessions/grouper.ts` — `splitByIdleGap`, `splitByRepo`, `minutesBetween` (pure, no DB)
- `src/db/types.ts` — `EventRow` / `SessionRow` interfaces with no `node:sqlite` import (safe to import in tests)

Tests import from these pure modules directly. Never import from `src/db/index.ts` in tests — it triggers the `node:sqlite` import on load.

### Module map

| Path | Responsibility |
|---|---|
| `src/index.ts` | CLI entry point — registers all commands with commander |
| `src/cli/` | One file per command (`init`, `capture`, `summary`, `sessions`, `events`, `export`, `config`, `status`) |
| `src/capture/` | `index.ts` orchestrates capture; `filter.ts` noise/dedup; `redact.ts` credential scrubbing; `git.ts` repo context |
| `src/normalize/patterns.ts` | Ordered rule array — first match wins. Add new categories here |
| `src/sessions/` | `detector.ts` orchestrates DB read/write; `grouper.ts` contains pure grouping logic |
| `src/summary/` | Shared by `summary`/`week`/`export`/`context`: `payload.ts` builds payloads from sessions and names non-git sessions by directory (pure); `heading.ts` the `## project (branch) — duration` line; `store.ts` session keys and which stored summary to serve (pure); `weekly.ts` the weekly flow (rendered fresh, no cache); `writer.ts` what writes summaries (the template); `legacy-ai.ts` detection, notice and cleanup of 1.x AI settings (pure); `webhook.ts` posts finished summaries; `exclusions.ts` default-excluded categories (dependency-free); `contract/` the versioned `--json` contract (types, `SCHEMA_VERSION`, pure builders — key sets are pinned by tests); `git-commits.ts` `git log`/`rev-parse` lookups via `execFileSync`; `write-back.ts` limits and messages for `sessions summary set` (pure; the command, `src/cli/session-summary.ts`, reads stdin via `src/utils/stdin.ts`). No barrel — import by module path |
| `skills/workscribe/` | The portable Agent Skill (`SKILL.md` + `references/`) shipped in the npm package. It reads `sessions --json` and saves via `sessions summary set`; it must only run commands that start with `workscribe` (see `src/capture/workscribe-command.ts`, which keeps them out of capture, built on the quote-aware helpers in `src/capture/shell-syntax.ts`) |
| `src/skills/` | Installs the agent skill into coding agents: `agents.ts` the agent → skills-folder registry (Codex and Copilot share `~/.agents/skills`); `detect.ts` detection with injected I/O; `state.ts`/`report.ts` install states and messages (pure); `installer.ts` the marker-guarded, move-aside install and uninstall; `package-path.ts` finds the packaged `skills/workscribe/`. Used by `src/cli/skill.ts`, `init`, `status` and `uninstall` |
| `src/ai/` | `types.ts` payload types and the `AIProvider` writer interface; `engine.ts` the `StoredEngine` names of stored summaries; `engines/template/` the offline template engine (pure). The name is historical — there are no AI providers since 2.0 |
| `src/config/index.ts` | Read/write `~/.workscribe/config.json`; `setConfigValue` coerces strings to number/boolean |
| `src/db/index.ts` | SQLite connection singleton, migrations, typed query functions |
| `shell/` | Static hook scripts appended to `~/.zshrc` / `~/.bashrc` by `workscribe init` |

### Adding a new command category

Add a rule to the `RULES` array in `src/normalize/patterns.ts`. Rules are evaluated in order — more specific patterns go before generic ones (e.g. `npm run build` before `npm run <anything>`). Add corresponding test cases in `tests/normalize.test.ts`.

### Data location

All runtime data lives in `~/.workscribe/`:
- `workscribe.db` — SQLite database (WAL mode, foreign keys on)
- `config.json` — user config
- `exports/` — markdown files from `workscribe export`
- `weekly-cache/` — left over from 1.x AI digests; 2.0 no longer reads or writes it
- `workscribe.db` → `session_summaries` — saved session summaries (`skill`, plus 1.x `provider`/`ollama`/`legacy`) keyed by `repo|started_at` (migration 005)
- `debug.log` — errors when `WORKSCRIBE_DEBUG=1`

## Git workflow

All work is tracked in Linear (project: Workscribe, identifier prefix `WOR`).

**Branch naming:**
```
<type>/WOR-<N>-short-description
```
Examples: `fix/WOR-6-midnight-session-split`, `feat/WOR-9-weekly-digest`, `test/WOR-7-cli-coverage`

**PR description must include** `Closes WOR-<N>` so Linear marks the issue Done on merge.

**Commit style:** Do not add `Co-Authored-By` trailers. Commit messages are linted (`commitlint`, Conventional Commits) via a Husky `commit-msg` hook. When the current branch has a ticket number (`<type>/<TICKET>-...`), a `prepare-commit-msg` hook auto-appends a `Closes <TICKET>` footer to the commit message — no manual step needed. Branches without a ticket number are exempt from this check.

## Naming conventions

**No single-letter or abbreviated names anywhere** — this applies to function parameters, lambda arguments, loop variables, destructuring aliases, and catch clauses. Use the full descriptive name.

```typescript
// Wrong
sessions.map((s) => s.repoName)
excludedCounts.entries().map(([cat, n]) => ...)
} catch (e) {

// Correct
sessions.map((session) => session.repoName)
excludedCounts.entries().map(([category, count]) => ...)
} catch (error) {
```

## Documentation

Documentation source lives in `docs/site/` in this repo and is published automatically to `workscribe.co/docs` via Mintlify on every push to `main`. The `mint.json` in that directory controls navigation and branding.

**When to update docs:**

| Change type | Doc file to update |
|---|---|
| New command added | `docs/site/commands.md` |
| Command option added or changed | `docs/site/commands.md` |
| New config key | `docs/site/configuration.md` |
| Summary behaviour or the agent skill | `docs/site/summaries.md` |
| Privacy or data handling change | `docs/site/privacy.md` |
| New error or common failure mode | `docs/site/troubleshooting.md` |

When a PR adds or changes a command, update the relevant doc file in the same commit. Docs deploy automatically — no manual sync step required.

**Adding a new doc page:**
1. Create the `.md` file in `docs/site/`
2. Add it to the `navigation` array in `docs/site/mint.json`

**Logo assets** go in `docs/site/logo/` (gitignored — add via Mintlify dashboard or manually).
