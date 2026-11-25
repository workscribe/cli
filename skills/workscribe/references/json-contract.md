# `workscribe sessions --json` — fields this skill uses

The full contract is documented at workscribe.co/docs/commands#json-output-contract. Within `schemaVersion: 2`, fields are only ever added — ignore any you don't recognise.

Each session is one project's **thread**: that project's work inside a work block (a stretch between idle gaps). Working across several repos at once gives one block with a thread per repo, so sessions of one block overlap in time.

```json
{
  "schemaVersion": 2,
  "date": "2026-10-25",
  "blocks": [
    {
      "id": 1,
      "startedAt": "2026-10-25T09:00:00.000Z",
      "endedAt": "2026-10-25T10:30:00.000Z",
      "activeMinutes": 85,
      "threadKeys": ["api|2026-10-25T09:00:00.000Z", "web|2026-10-25T09:40:00.000Z"]
    }
  ],
  "sessions": [
    {
      "key": "api|2026-10-25T09:00:00.000Z",
      "project": "api",
      "repoPath": "/Users/dev/api",
      "branch": "feature/auth",
      "branches": ["feature/auth", "main"],
      "startedAt": "2026-10-25T09:00:00.000Z",
      "endedAt": "2026-10-25T10:30:00.000Z",
      "activeMinutes": 70,
      "blockId": 1,
      "alongside": ["web|2026-10-25T09:40:00.000Z"],
      "tickets": ["API-412"],
      "notes": ["blocked on staging credentials"],
      "commits": [
        { "hash": "a1b2c3d", "subject": "fix: token refresh race", "committedAt": "2026-10-25T10:12:00+01:00", "source": "git" },
        { "hash": null, "subject": "wip: amended away", "committedAt": "2026-10-25T09:41:07.000Z", "source": "captured" }
      ],
      "events": [
        { "category": "testing", "exitCode": 1, "metadata": { "tool": "npm" } },
        { "category": "testing", "exitCode": 0, "metadata": { "tool": "npm" } },
        { "category": "other", "hint": "make deploy-staging", "metadata": {} }
      ]
    }
  ]
}
```

| Field | Use it for |
|---|---|
| `key` | The `--key` when saving this session's summary. Copy it exactly. |
| `project`, `branch`, `activeMinutes` | The block heading. `project` is the project's name, a `~/path` for work outside any project, or `null` (write `unknown`). `activeMinutes` is the time spent on this project; `startedAt`–`endedAt` can span other projects' work too. |
| `branches` | Every branch the session touched, in the order first seen. `branch` is the latest of them, the one the session ended on. Each commit's `committedAt` says when it was made. |
| `alongside` | The keys of the sessions worked in the same block. Don't mention those projects — Workscribe adds an `Alongside:` line under each summary itself — and leave their work to their own blocks. |
| `tickets` | Ticket keys the session's branches and commits name. Mention one when the work is about it (e.g. "Fixed the token refresh race (API-412)"); don't list them for their own sake. May be empty even when a branch names one, right after an update. |
| `repoPath` | Where to read files if a commit needs context. `null` outside a git repo. |
| `notes` | The developer's own notes — always include them. |
| `commits` | The main source of outcomes. `source: "git"` has a short `hash` to cite; `"captured"` commits have `hash: null` (amended or rebased). |
| `events[].category` | What kind of work: `testing`, `building`, `shipping`, `dependencies`, `releasing`, `ai_session`, `code_edit`, `other`, … |
| `events[].exitCode` | `0` passed, non-zero failed, `null` unknown (commands run by AI tools). A failure followed by a pass means a fix. |
| `events[].metadata` | Structured detail: `packages` for dependencies, `tool`, `message`, `remote`/`branch` for pushes; `linesAdded`/`linesRemoved` (`null` when unknown) and `lastEditAt` on `code_edit`; `intent`, only when the developer turned the agent's words on: what the coding agent said the command was for ("Run the retention tests"). It is the agent's own wording, so use it to understand what a run, a read or an unclassified command was for, and don't quote it. |
| `events[].hint` | Only on `other` events: a short, redacted start of the command. Infer intent from it; don't quote it. |
