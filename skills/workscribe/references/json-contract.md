# `workscribe sessions --json` — fields this skill uses

The full contract is documented at workscribe.co/docs/commands#json-output-contract. Within `schemaVersion: 1`, fields are only ever added — ignore any you don't recognise.

```json
{
  "schemaVersion": 1,
  "date": "2026-10-25",
  "sessions": [
    {
      "key": "api|2026-10-25T09:00:00.000Z",
      "project": "api",
      "repoPath": "/Users/dev/api",
      "branch": "feature/auth",
      "startedAt": "2026-10-25T09:00:00.000Z",
      "endedAt": "2026-10-25T10:30:00.000Z",
      "durationMinutes": 90,
      "notes": ["blocked on staging credentials"],
      "commits": [
        { "hash": "a1b2c3d", "subject": "fix: token refresh race", "source": "git" },
        { "hash": null, "subject": "wip: amended away", "source": "captured" }
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
| `project`, `branch`, `durationMinutes` | The block heading. `project` is the repo name, a `~/path` for work outside git, or `null` (write `unknown`). |
| `repoPath` | Where to read files if a commit needs context. `null` outside a git repo. |
| `notes` | The developer's own notes — always include them. |
| `commits` | The main source of outcomes. `source: "git"` has a short `hash` to cite; `"captured"` commits have `hash: null` (amended or rebased). |
| `events[].category` | What kind of work: `testing`, `building`, `shipping`, `dependencies`, `releasing`, `ai_session`, `code_edit`, `other`, … |
| `events[].exitCode` | `0` passed, non-zero failed, `null` unknown (commands run by AI tools). A failure followed by a pass means a fix. |
| `events[].metadata` | Structured detail: `packages` for dependencies, `tool`, `message`, `remote`/`branch` for pushes. |
| `events[].hint` | Only on `other` events: a short, redacted start of the command. Infer intent from it; don't quote it. |
