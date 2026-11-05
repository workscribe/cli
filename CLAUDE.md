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
workscribe summary → work blocks & threads → template engine → markdown output
                                          (the agent skill writes AI prose and saves it via `sessions summary set`)
```

### Key design decisions

**`node:sqlite` instead of `better-sqlite3`** — uses Node 22+'s built-in synchronous SQLite. `tsup` strips the `node:` prefix when bundling CJS, so `postbuild` patches it back with a string replace. Do not change this without updating `package.json`'s `postbuild` script.

**Capture path is fully synchronous and must never throw** — `workscribe _capture` is called from the shell hook as a background process (`&!`). Errors are swallowed and optionally written to `~/.workscribe/debug.log` when `WORKSCRIBE_DEBUG=1` is set.

**No AI providers since 2.0** — Workscribe makes no AI API calls of its own. `summary`, `week` and `export` get their writer from `createSummaryWriter` (`src/summary/writer.ts`), which always returns the offline `TemplateProvider` (`src/ai/engines/template/`, implementing the `AIProvider` interface in `src/ai/types.ts`). AI-written prose comes from the agent skill (`skills/workscribe/`), which saves through `sessions summary set` into the anchored `summary` table only. Template summaries are rendered live and never stored; `summary`, `export` and `context` show saved ones from the `summary` table — skill summaries, plus `provider`/`ollama`/`legacy` rows from 1.x that the `summary-anchors` job mapped there (see `src/summary/store.ts`). 1.x `ai.*` and `summary.engine` settings are read only to print a once-per-run notice on stderr, refuse `config set`, offer cleanup in `init` and redact keys (`src/summary/legacy-ai.ts`).

**Work blocks and threads are computed on demand, not during capture** — `workscribe _capture` only writes to the `events` table. A day's blocks and threads (`src/sessions/threads.ts`) are built when a command reads it — `sessions`, `summary`, `export`, the week, `context` — stored in `work_block`/`thread`/`thread_event`/`activity_slot`, and rebuilt when the day's stamp changes. A day is rebuilt in one `BEGIN IMMEDIATE` transaction that rechecks first (`ensureDayThreads`, `src/db/transaction.ts`), so processes building the same day at once can't duplicate it. The old linear sessions are gone: no code reads them, and the `drop-old-sessions` data job drops their tables.

**Pure functions are extracted for testability** — DB-touching code and pure logic are kept separate:
- `src/capture/filter.ts` — `shouldFilter` and `isDuplicate` (pure, no DB)
- `src/sessions/grouper.ts` — `splitByIdleGap`, `minutesBetween` (pure, no DB)
- `src/db/types.ts` — `EventRow` and the other row interfaces with no `node:sqlite` import (safe to import in tests)
- `src/capture/repo-name.ts` — parses the `origin` remote and formats `owner/repo` or bare `repo` (pure)

Tests import from these pure modules directly. Never import from `src/db/index.ts` in tests — it triggers the `node:sqlite` import on load and opens the real `~/.workscribe` database. The exceptions, such as `tests/sessions/threads-database.test.ts`, which checks a day's grouping on real SQLite, mock `src/utils/paths` to point `DB_PATH` at a temp folder before the module loads. Copy that setup if another test ever needs the real db module.

### Module map

| Path | Responsibility |
|---|---|
| `src/index.ts` | CLI entry point — registers all commands with commander |
| `src/cli/` | One file per command (`init`, `capture`, `summary`, `sessions`, `events`, `export`, `config`, `status`); `day-notes.ts` what `summary` and `export` print under a day (saved-summary note, left-out events footer) |
| `src/capture/` | `index.ts` orchestrates capture; `filter.ts` noise/dedup (ignore list applied per step); `command-steps.ts` splits compound shell commands into the commands they run (pure, shared by the filter, the normalizer and `workscribe-command.ts`); `redact.ts` credential scrubbing; `commit-message-file.ts` reads a `git commit -F <file>` subject safely (regular files only, bounded read); `git.ts` repo context — `getRepoContext(cwd, config)` is the one way to name a repo (projects override, then the remote in the `git.qualifyRepoName` form, then package.json or the folder), used by both capture paths, `note` and `context` so names always match; `repo-name.ts` the remote parsing and name formats (pure) |
| `src/normalize/patterns.ts` | Ordered rule array (`BASE_RULES`, incl. the nx rule) — first match wins, built on first use. Add new categories here |
| `src/normalize/compound.ts` | Classifies compound commands by their most telling step (`STEP_CATEGORY_PRIORITY`); pure, takes the rule matcher as a parameter |
| `src/normalize/git-invocation.ts`, `git-directory.ts`, `commit-message.ts`, `dependency-metadata.ts` | Pure readers for capture: `git [global options] <subcommand>` (`withoutGitGlobalOptions`, so rules see the subcommand); `effectiveDirectory`, the repo a `git -C`/`--work-tree` command worked in — capture credits it there (a `cd` is never followed: every source reports where the shell ended up); `commitMessageOf` (`-m`, `-am`, `--message=`, `-F`, agent heredocs — found line by line, never with a backtracking regex); package names and workspace, flag values skipped. `normalizeCommand` returns `matchedStep`, the step that set the category, for this |
| `src/normalize/git-move.ts` | Pure reader of the branch-moving work in a stored git command (`gitMovesOf`: create, switch, stash, rebase, merge, discard; every step of a compound command) — `eventRowToPayload` attaches it to the payload for the story; nothing new is stored |
| `src/normalize/reclassify.ts` | Pure helper that decides a stored `other` event's new category (used by migration 006) |
| `src/sessions/` | `grouper.ts` the pure idle-gap split (`splitByIdleGap`, `minutesBetween`); `blocks.ts` (pure) builds a day's work blocks (an idle-gap stretch of every event, never split by a repo switch), one thread per project inside each (the events with no project share an "elsewhere" thread) and 5-minute activity slots (a block's time is its distinct slots, never the sum of its threads'); `GROUPING_VERSION` there is bumped when the rules change. `threads.ts` `ensureDayThreads`/`getOrBuildBlocks` rebuild a day under the write lock, rechecked first, when its stamp (`grouping_day`: version, idle timeout, event count, max id, and two checksums of its project links) no longer matches; `src/db/thread-store.ts` is their SQL (`node:sqlite`-free). `sessions` (both forms), `summary`, `export`, the week (all via `src/cli/thread-day.ts`) and `context` read them |
| `src/summary/` | Shared by `summary`/`week`/`export`/`context`: `payload.ts` builds the template's payloads (`threadToPayload` for a thread of the day, `spanToPayload` for the span `context` answers with), names work outside any project by its folder, and owns the branch rule (`sessionBranch`: the latest the thread was on) (pure); `event-metadata.ts` parses a row's stored metadata (a leaf: no imports); `commits.ts` captured commits and their merge with git's (`collectCapturedCommits`, `mergeCommits`, `isFailedExit`) — a leaf too, so `payload.ts` and `contract/` share it without a cycle; `story-commits.ts` each commit's branch for the story (`branchAt`, by the commit's time) and which session a day's git commit belongs to (pure); `day.ts` a day's summaries as `summary` and `export` both tell them (`renderDay` over the day's blocks: a section per thread — its saved summary (`summariesOfThread` in `anchors.ts`, the rule `context` shares) else the template, git looked up only for those — each followed by an `Alongside:` line, then one `Time worked:` line from the blocks' active time; neither line is in the per-thread `summaries` JSON bullets come from); `day-commits.ts` the one `git log` per repo per day (every local branch) that the day path uses, sharing a 3 s budget (`lookupDayCommits`; null means git wasn't asked — no repo, no `user.email`, git slow or the budget spent); `heading.ts` the `## project (branches) — duration` line, naming every branch the session touched (a thread's payload carries `activeMinutes`, shown instead of its span); `payload.ts`'s `threadToPayload` builds a thread's payload, with `alongside`; `store.ts` session keys and which stored summary to serve (pure); `anchors.ts` what a summary describes (`anchorOfThread` for a thread; `anchorOfSession` for an old session: project, first and last event, and whether the session mixed projects, at ½ or less) and the thread it belongs to when read (`findSummaryThread`: more than ½ of its range, or for one saved for a thread, that thread while it still holds its first event) (pure); `weekly.ts` the weekly flow, Mon–today's threads with git's commits for the whole week (one `lookupDayCommits` call, `WEEK_GIT_BUDGET_MS`), rendered fresh, printed as text or, with `summary.format=json`, as one JSON document; `cli/week.ts` `runWeekCommand` is the one handler `week` and `summary --week` share (upgrade check, then `loadDayThreads`), with `--by project|day`; `writer.ts` what writes summaries (the template); `legacy-ai.ts` detection, notice and cleanup of 1.x AI settings (pure); `webhook.ts` posts finished summaries; `exclusions.ts` default-excluded categories (dependency-free); `contract/` the versioned `--json` contract (types, one version per document — `SESSIONS_SCHEMA_VERSION` 2: sessions are threads, with `blocks`; `EVENTS_SCHEMA_VERSION` 1 — pure builders, key sets pinned by tests); `payload.ts`'s `threadRepoCwd` finds a thread's repo folder without matching `repo_name` against the project's name; `git-commits.ts` `git log`/`rev-parse` lookups via `execFileSync` (optional per-call timeouts; `getFileCommits` shares one budget across its calls and never passes git a timeout of 0, which Node reads as none); `file-details.ts` what `context --file --json` says about the file itself — saves, branch, commits, files edited alongside (pure; paths shown relative to the repo root); `write-back.ts` limits and messages for `sessions summary set` (pure; the command, `src/cli/session-summary.ts`, reads stdin via `src/utils/stdin.ts`). No barrel — import by module path |
| `skills/workscribe/` | The portable Agent Skill (`SKILL.md` + `references/`) shipped in the npm package. It reads `sessions --json` and saves via `sessions summary set`; it must only run commands that start with `workscribe` (see `src/capture/workscribe-command.ts`, which keeps them out of capture, built on the quote-aware helpers in `src/capture/shell-syntax.ts`) |
| `src/skills/` | Installs the agent skill into coding agents: `agents.ts` the agent → skills-folder registry (Codex and Copilot share `~/.agents/skills`); `detect.ts` detection with injected I/O; `state.ts`/`report.ts` install states and messages (pure); `installer.ts` the marker-guarded, move-aside install and uninstall; `package-path.ts` finds the packaged `skills/workscribe/`. Used by `src/cli/skill.ts`, `init`, `status` and `uninstall` |
| `src/ai/` | `types.ts` payload types and the `AIProvider` writer interface; `engine.ts` the `StoredEngine` names of stored summaries; `engines/template/` the offline template engine (pure): `story.ts` renders a day's session as a story (notes, then each branch's commits, outcomes and pushes, then one activity line) — `renderSessionStory` is the one renderer `summary`, `export` and `context` share; `week.ts` the week by project then branch (`weekByProject`: each thread split by branch with `branchGroupsOf`, then merged across the week by project id and branch; `storyOfBranch` tells each, up to `MAX_BRANCH_BULLETS`); `branch-moves.ts` a session's branch moves in plain language (stash moved between branches, branch created from, rebase, merge, discards); `describe.ts` the bullet helpers, and the week digest's bullets (`describeActivity`). The name is historical — there are no AI providers since 2.0 |
| `src/config/index.ts` | Read/write `~/.workscribe/config.json`; `setConfigValue` coerces strings to number/boolean |
| `src/db/index.ts` | SQLite connection singleton, migrations, typed query functions |
| `src/db/index.ts` (deletes) | `runInImmediateTransaction`; `deleteEventsByIds`/`deleteEventsForDate` (`undo`/`clear`), which remove an event's old `session_events` links first while that table exists |
| `src/db/transaction.ts` | `withImmediateTransaction` (`BEGIN IMMEDIATE`, an optional shorter lock wait, rollback), `withReadTransaction` (one snapshot, no write lock; the read's own error is the one thrown) and `isDatabaseLocked`; `node:sqlite`-free so tests run it on real temp-file databases |
| `src/cli/context-file.ts` | The time limits `context` answers within (`LOCK_WAIT_MS`, `GIT_BUDGET_MS`) and the file details for `context --file --json` (`src/summary/file-details.ts` builds them, pure; `getFileCommits` in `git-commits.ts` gets the file's commits within a 2 s git budget) |
| `src/cli/context-threads.ts`, `src/cli/context-view.ts`, `src/db/context-lookup.ts`, `src/summary/thread-context.ts` | `context` on threads: once `project-dimensions` and `summary-anchors` are done, a file's latest save (by `file_path`, or its project's `file` when the saved path is the same file on disk — never a save from another worktree of the repo) or a project's latest event (`idx_events_project_time`) is answered with the thread holding it — its day built within the 1 s lock wait, then read in one snapshot — plus its block and the threads `alongside` it, and the anchored summary that belongs to it (`findSummaryThread`), else the template. When another process holds the lock past that wait, it answers from the day as last built; a day never built, or data not upgraded yet, finds nothing (`null`). The JSON added `schemaVersion`, `thread`, `block`, `alongside`, always set now; `context-view.ts` turns the answer into what's printed |
| `src/db/migrate.ts` | Applies migrations in per-migration transactions; `node:sqlite`-free so tests run it on an in-memory DB. A migration is SQL plus an optional `run(db)` for changes that need code (`migration-types.ts`). From 007 on, migrations are strictly additive — data work goes in a data job |
| `src/capture/project-identity.ts`, `src/capture/dimensions.ts` | What makes events the same project (`canonicalRemote`, `projectIdentity`; pure) and what an event links to (`eventDimensions`; `fileEventDimensions` takes a save's project from the file's own repo, asking git again only when it isn't in the open folder's, or is in a nested repo or submodule inside it). `getRepoContext` returns the identity as `project`, and `probeDirectory` in `git.ts` is the backfill's one question to git. Remote URLs are stripped of any user name and token as git returns them (`withoutCredentials`), so none is ever stored |
| `src/db/dimensions.ts`, `src/db/event-writer.ts` | Insert-or-ignore upserts for projects, aliases, paths, branches and files; `insertEventRecord` writes an event and its links in one transaction, and stores the event without links if linking fails (a lock is thrown, never waited for twice). `node:sqlite`-free |
| `src/db/day-threads.ts`, `src/cli/thread-day.ts` | What `sessions` and `sessions summary set` read: `readDayThreads` returns a built day's blocks, each thread with its key (`project|startedAt`, as `context` names it), project name, events and agent sessions, in one read snapshot (`node:sqlite`-free); `isReadyForThreads` is the gate both they and `context` use — `project-dimensions` and `summary-anchors` done, or no events at all yet; `src/cli/thread-day.ts` exits with `UPGRADE_NEEDED_MESSAGE` when it fails (`requireThreadData`) and builds the day first (`loadDayThreads`); `src/cli/fail.ts` the shared print-and-exit-1 |
| `src/db/recent-events.ts` | The last-N-days counts `status` and `profile` show (`countOtherEventsSince`, `countOtherEventTools`), from an ISO lower bound (`sinceIso`) so they compare with `captured_at` as stored. `node:sqlite`-free; `src/db/index.ts` keeps the day-count wrappers |
| `src/capture/tickets.ts`, `src/db/tickets.ts`, `src/db/jobs/ticket-refs.ts` | Tickets (WOR-144): `ticketKeysOf` (pure) finds the keys matching `tickets.pattern` in an event's *linked* branch name and in the subjects of the commits it made (`collectCapturedCommits`), first 200 characters; `ticketPatternOf`/`ticketPatternProblem` fall back to the default for an invalid, empty-matching or nested-quantifier pattern, so capture never throws or hangs. Capture links them with the event (`linkEventTickets`, in `insertEventRecord`'s transaction); the `ticket-refs` job backfills from the pattern in `meta`, and `config set tickets.pattern` stores it there and restarts the job (`requestTicketRelink`) before writing `config.json`. `ticketsOfEvents` gives a thread's sorted keys for `sessions --json` |
| `src/db/agent-sessions.ts` | `agent_sessions` SQL: `getAgentSessionsOfEvents` (what `sessions --json` lists, never `cwd`), `upsertAgentSession` (first `cwd` and `started_at` kept, `last_seen_at` only moves forward), the session ids of events about to be deleted (`agentSessionIdsOfEvents`, `agentSessionIdsOfDate`) and `deleteEmptyAgentSessions`, which `undo`/`clear` run after deleting, touching only those ids. `node:sqlite`-free |
| `src/db/jobs/` | Data jobs: versioned, batched, resumable normalisation of stored data. `index.ts` the append-only `JOBS` list (bump a job's version to rerun it over every row); `types.ts` the `DataJob` contract (`prepare`, `runBatch`, `verify`, and an optional `gather` for slow outside work, run after `startJob` and outside every transaction; never reads the config, and caches whatever it learns in the database); `ticket-refs.ts` the third (see the tickets row; bump it with `project-dimensions`, whose `branch_id` it reads); `drop-old-sessions.ts` the last: drops `session_events`, `sessions` and `session_summaries` once `summary-anchors` is done with its check passed, else fails (and retries) with the tables kept — never bump `summary-anchors` after it; `summary-anchors.ts` maps every `session_summaries` row onto `summary` (the cached session's events, else its day regrouped by `frozen-old-sessions.ts`, a frozen copy of the old grouper; never overwrites a row `sessions summary set` saved, never deletes one); `project-dimensions.ts` the first job, linking history to projects (`project-resolution.ts` holds its rules, pure: git, then a live checkout above the folder, then the one live repo the name fits, then a project by name, every fallback recorded as an issue; a stored name that doesn't fit the folder's remote is a `git -C` into another repo when exactly one other live project fits it, else an override kept on the folder's project but never as its name; `directory-probes.ts` git's cached answer per folder; `project-dimensions-report.ts` its issues and verification; events captured after its gather mark keep the links capture gave them); `runner.ts` `runPendingJobs` (one immediate transaction per batch, rereading the cursor; `verify` in a read transaction, so it never holds the write lock; stops at the first unfinished job; stops, without marking anything done, when a newer CLI version starts or takes over the job; nothing runs without a backup); `backup.ts` `ensureBackup` (one `VACUUM INTO` copy per CLI version, claimed through `meta`, 0700 folder, 0600 file, newest 3 kept); `store.ts` the `data_jobs`/`data_job_issues`/`meta` SQL; `state.ts` what `status` and `upgrade` report, and `areJobsDone`, which the thread gate (`isReadyForThreads`) builds on — `context` finds nothing when it fails, `sessions`, `summary`, `export` and the week ask for `workscribe upgrade` with `UPGRADE_NEEDED_MESSAGE`. All `node:sqlite`-free. Jobs run only before the commands in `DATA_JOB_COMMANDS` (`src/cli/completions.ts`, within a 2 s budget, via `src/cli/data-jobs.ts`) and from `workscribe upgrade` — never from `_capture`, `_hook`, `context` or `sessions` |
| `shell/` | Static hook scripts appended to `~/.zshrc` / `~/.bashrc` by `workscribe init` |

### Adding a new command category

Add a rule to the `BASE_RULES` array in `src/normalize/patterns.ts`. Rules are evaluated in order — more specific patterns go before generic ones (e.g. `npm run build` before `npm run <anything>`). Add corresponding test cases in `tests/normalize/normalize.test.ts`.

Rules match one simple command. `normalizeCommand` splits compound commands with `src/capture/command-steps.ts` (`cd x && … | tail; …` → steps, glue and assignments set aside, `pnpm exec X` read as `npx X`) and, when several steps match, keeps the one highest in `STEP_CATEGORY_PRIORITY`. New categories that describe outcomes belong in that list. Stored events aren't reclassified automatically — a migration with a `run` step (like `006_reclassify_other`) can do it.

### Data location

Fresh installs use the XDG folders (data `~/.local/share/workscribe/`, config `~/.config/workscribe/`, state `~/.local/state/workscribe/`); installs whose `~/.workscribe/` has a `workscribe.db` or `config.json` keep everything there. `src/utils/data-dirs.ts` (`resolveDataDirs`, pure) decides once per process and `src/utils/paths.ts` exports the paths — never decide by whether `~/.workscribe/` exists, since `init` and the alerts file (`~/.workscribe/alerts.pending`, always there for the shell hooks) create it on every install. The data folder (`getDb`), `~/.workscribe` for the alerts file and the folder the shell hook writes completions to go through `ensurePrivateDirectory` (`src/utils/private-directory.ts`: `0700`, tightening a looser existing one); `init`, `export`, `bug-report`, the backup and the config writer still create theirs with `mode: 0o700` themselves. The data folder holds (shown at its legacy `~/.workscribe/` path):
- `workscribe.db` — SQLite database (WAL mode, foreign keys on)
- `config.json` — user config
- `exports/` — markdown files from `workscribe export`
- `backups/` — database copies taken before the first data job of each CLI version (`src/db/jobs/backup.ts`); newest 3 kept
- `workscribe.db` → `project`, `project_alias`, `project_path`, `branch`, `file`, `event_file`, plus `events.project_id`/`branch_id` — stable identities events link to (migration 008): a project is keyed by its canonical remote (`remote:host/owner/repo`), else its git folder (`local:`), else, for history from a folder that's gone, its name (`name:`). Capture writes the links; the `project-dimensions` job backfills history, caching git's answer per folder in `directory_probe` and each (cwd, name) pair's project in `project_resolution`. Work blocks and threads (WOR-145) group by `project_id`; no command reads either yet
- `workscribe.db` → `ticket`, `ticket_ref` — ticket keys and what names them: a branch (`branch_id`) or a commit event (`event_id`), exactly one (migration 013); an event's refs go with it on `undo`/`clear`, a branch's with the branch
- `workscribe.db` → `agent_sessions`, plus `events.agent_session_id` — the agent conversation each Claude Code hook command came from (`source` + its `session_id`, first `cwd`, `started_at`, `last_seen_at`; migration 012). `_hook` reads `session_id`; `src/db/agent-sessions.ts` upserts it in the event's own transaction (`src/db/event-writer.ts`); `undo`/`clear` delete the sessions their events leave empty. WOR-136 extends the table with how a session ended and its recaps
- `workscribe.db` → `data_jobs`, `data_job_issues`, `meta` — data job progress, the rows jobs couldn't resolve (never deleted), backup claims and the last CLI version that ran (migration 007)
- `workscribe.db` → `work_block`, `thread`, `thread_event`, `activity_slot`, `grouping_day` — derived per day from `events` (migration 009) and rebuilt whenever the day's stamp changes, so they can always be dropped and rebuilt
- `weekly-cache/` — left over from 1.x AI digests; 2.0 no longer reads or writes it
- `workscribe.db` → `summary` — saved summaries anchored to the events they describe (project, first and last event id; migration 010). `sessions summary set` writes only here, with `anchor_source = 'thread'` (`saveAnchoredSummary`, `src/db/summary-store.ts`); such a summary attaches to its own thread even when a busier project dominates its range (`findSummaryThread`). `summary`, `export` and `context` read it (each block's rows come with `readDayThreads`)
- `workscribe.db` → `sessions`, `session_events`, `session_summaries` — the old linear sessions and their summaries (migrations 001, 005), until the `drop-old-sessions` job drops them; until then `undo`/`clear` delete an event's `session_events` rows first (their foreign key), and nothing else touches them
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
