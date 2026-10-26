# Summary format

One block per session, in exactly the shape Workscribe uses everywhere else, so saved summaries look native in `workscribe summary`, `workscribe context` and the VS Code status bar.

## Heading

```
## <project> (<branch>) — <duration>
```

- Leave out ` (<branch>)` when `branch` is `null`.
- If `project` is `null` (no repo and no events), use `unknown`, as Workscribe does.
- Duration from `durationMinutes`: under an hour as `45m`; otherwise `1h` or `1h 30m`.

## Bullets

Up to **7**, each starting with `- `, most important first:

1. Notes from `notes`, as written — prefix with `Note: `
2. What was built, fixed or changed, from `commits` — cite the short hash in parentheses when there is one
3. Test and build outcomes: "Resolved failing tests (now passing)", "Build still failing" — only when `exitCode` shows it; `null` exit codes are unknown, not failures
4. Dependencies added or removed, releases and deploys, pushes — when they matter

Write outcomes in plain past tense ("Fixed…", "Added…", "Shipped…"). Fold routine steps (installing, pushing, re-running) into the outcome they served. Never list commands, file names or the AI tool used. If several commits are steps toward one change, describe the change once.

## Example

Input (trimmed): commits `a1b2c3d fix: token refresh race` and `e4f5a6b test: expired session regression`, five `testing` events failing then passing, `dependencies` with `packages: ["jose"]`, note "blocked on staging credentials".

```
## api (feature/auth) — 1h 30m
- Note: blocked on staging credentials
- Fixed the token refresh race in the auth middleware (a1b2c3d)
- Added regression tests for expired sessions (e4f5a6b); suite now passing
- Switched JWT handling to the jose library
```
