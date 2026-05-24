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
workscribe summary → session detector → AI provider → markdown output
```

### Key design decisions

**`node:sqlite` instead of `better-sqlite3`** — uses Node 22+'s built-in synchronous SQLite. `tsup` strips the `node:` prefix when bundling CJS, so `postbuild` patches it back with a string replace. Do not change this without updating `package.json`'s `postbuild` script.

**Capture path is fully synchronous and must never throw** — `workscribe _capture` is called from the shell hook as a background process (`&!`). Errors are swallowed and optionally written to `~/.workscribe/debug.log` when `WORKSCRIBE_DEBUG=1` is set.

**AI layer is provider-agnostic** — all providers implement the `AIProvider` interface in `src/ai/types.ts` with a single `summarize(payload: DaySummaryPayload)` method. The router in `src/ai/router.ts` selects the provider from config. Adding a new provider means adding a file in `src/ai/providers/` and a case in the router switch.

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
| `src/ai/` | `types.ts` interfaces; `prompt.ts` system prompt + payload serializer; `router.ts` provider selection; `providers/` one file per provider |
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
- `debug.log` — errors when `WORKSCRIBE_DEBUG=1`
