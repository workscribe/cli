---
name: workscribe
description: Summarize the developer's recent work from Workscribe's captured terminal, IDE and AI-session activity, then save the summary back to Workscribe. Use when the user asks what they did today, this week or on a given day, wants a standup, status update or work log, or asks to summarize their sessions or commits. Requires the `workscribe` CLI.
---

# Workscribe work summaries

Workscribe records the developer's commands, IDE saves, AI-tool sessions and commits on their machine. This skill reads that record, writes a short outcome-focused summary per work session, and saves it back — after which `workscribe summary`, `workscribe context` and the VS Code status bar show your summary instead of Workscribe's built-in one.

## Rules that keep the record clean

Every shell command you run is itself recorded by Workscribe. To avoid logging your own work as the developer's:

- **Start every command with `workscribe`.** No `cd … &&`, no `npx`, no piping other commands into it.
- **Never run `git`** (or `cat`, `grep`, `ls`, …) to dig for detail. Commits are already in the JSON. If a commit subject is too vague, read the relevant files under `repoPath` with your own file-reading tool instead of the shell.

## 1. Get the sessions

```bash
workscribe sessions --json
```

Add `--date YYYY-MM-DD` for another day. For "this week", run it once per day (Monday to today) and save each day's sessions — but note `workscribe summary --week` keeps using Workscribe's own digest; saved summaries are per day. The output is one line of JSON; see [references/json-contract.md](references/json-contract.md) for the fields you'll use. An empty `sessions` list means nothing was captured — tell the user and stop.

## 2. Write one block per session

Follow [references/summary-format.md](references/summary-format.md). In short:

```
## <project> (<branches>) — <duration>
- <outcome>
```

- Up to **7 bullets**, most important first: what was built, fixed, shipped or decided.
- Build bullets from `commits` (cite the short hash, e.g. `(a1b2c3d)`), test and build results (`exitCode` 0 vs non-zero; `null` means unknown, never "failed"), `notes` (always include them), and `hint`s on unclassified events.
- Describe outcomes, not commands or tools. Never name the AI tool used. Don't invent anything the data doesn't show.
- Skip a session with nothing notable rather than padding it.

## 3. Save each block

Save each session's block with its `key`, as **one command starting with `workscribe`**:

```bash
workscribe sessions summary set --key 'api|2026-10-25T09:00:00.000Z' <<'EOF'
## api (feature/auth) — 1h 30m
- Fixed the token refresh race in the auth middleware (a1b2c3d)
- Added regression tests for expired sessions; suite now passing
EOF
```

Use the quoted `<<'EOF'` form so nothing in the summary is expanded. Saving again for the same key replaces the earlier summary.

If it reports that **no session matches the key**, new activity regrouped the day: run `workscribe sessions --json` again and retry with the fresh key. Any other error message says what to fix.

## 4. Tell the user

Show the summaries, then say they were saved to Workscribe: `workscribe summary` (including `--slack`), `workscribe context` and the VS Code status bar now use them for those sessions. `workscribe summary --fresh` shows Workscribe's own summary for that run without removing yours.

## Privacy

Running this skill sends the JSON — categories, commit subjects, notes, short redacted hints for unclassified commands, and each session's repo path and working directory; never full commands or IDE file paths — to the model provider behind this agent, along with any files you read under `repoPath`. If the developer needs summaries that never leave their machine, point them to `workscribe summary`, whose template engine runs entirely offline.
