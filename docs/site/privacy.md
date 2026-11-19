---
title: Privacy & Security
description: How Workscribe handles your data and what never leaves your machine.
---

# Privacy & Security

## What stays local

Everything you capture. All captured data is stored in `~/.workscribe/` on your machine. Nothing is sent to any remote server except a small anonymous install ping (on by default, see below). Summaries are built offline by the template engine; your activity leaves your machine only if you ask a coding agent to summarize it with the Workscribe skill (see below).

| Location | Contents |
|---|---|
| `~/.workscribe/workscribe.db` | SQLite database — events, work blocks and threads, summaries your coding agent saved |
| `~/.workscribe/config.json` | Configuration, including webhook URLs |
| `~/.workscribe/exports/` | Markdown files from `workscribe export` |
| `~/.workscribe/backups/` | Copies of the database taken before a data upgrade — the newest 3 are kept, and secrets are removed from them once the upgrade has removed them from your database |

Both the database and config file are written with `0600` permissions (owner read/write only). Backups hold the same data as the database, so they get the same protection: the folder is `0700` and each copy `0600`.

**What's recorded from a command, and what isn't:**
- **Long commands:** a command is stored after redaction with its heredoc bodies (`<<EOF … EOF`) removed, so the text of a script you pipe in never reaches the database; the lines that open and close each heredoc stay. A command still longer than 2000 characters is cut before the step that crosses that limit. Only new commands are shortened; ones captured earlier stay as they were. What Workscribe reads from a command, such as a commit message, is read before this.
- **Claude Code commands:** Workscribe records the command, its folder, how long it took, and its exit code. For a failed command, Claude Code passes the command's output along with the exit code; Workscribe reads only the `Exit code N` line and stores nothing else from it. It also keeps the id Claude Code gives the conversation, so the commands one conversation ran — in any repo — can be grouped together, with the folder and time it was first seen. It never leaves your machine, and `workscribe undo` and `workscribe clear` remove it along with the conversation's last commands. Undoing only some of a conversation's commands keeps its id, with the folder and time it was first seen, even if the command that set them is gone.
- **Files Claude Code changes:** for each file the agent edits or writes, Workscribe records the file's path and how many lines it added and removed, like a save in your editor, and links it to the conversation. It reads the change only to count its lines: the file's text, the old and new text and the agent's diff are never stored. Turn it off with `capture.agentEdits`.
- **How a Claude Code conversation ended:** when it ends, Workscribe records when, and the one-word reason Claude Code gives (such as `other` or `logout`), on the conversation it already knows. A conversation that captured nothing gets no record.
- **Claude Code's recaps, only if you turn them on:** with `capture.agentMessages` on (it's off by default), Workscribe keeps the agent's latest reply of each turn and its latest compaction summary, per conversation. They're free text that can quote code, so they're redacted like commands, cut to 2000 characters, and dropped whole when the secret check flags them. They stay on your machine, but once kept they appear in the closing line of a summary (so in anything you copy or send by webhook), in `context --file --json`, and, only if you also turn on `skill.includeAgentMessages`, in `sessions --json`, where the agent skill reads them. Turning `capture.agentMessages` off hides them and deletes the ones kept. `undo` and `clear` remove them with the conversation.
- **Antigravity commands and files:** with the Antigravity hook installed (`workscribe init` offers it when `agy` is found), Workscribe records each command the agent runs, its folder (the workspace), and the id Antigravity gives the conversation; and for each file the agent edits or writes, the file's path and how many lines it added and removed. Antigravity doesn't report exit codes, so a failed command shows as unknown, except a `git commit` that didn't land, which Workscribe checks against git's `HEAD`. It never reads or stores your prompt (`lastUserInput`), the text of an edit or a new file, the command's output, or the agent's transcript, and it records no recaps. Turn the edits off with `capture.agentEdits`, and all agent capture with `capture.aiTools`.
- **Projects, branches and files:** to tell when events belong to the same project, Workscribe also stores each repo's `origin` remote (host, owner and repo, never credentials), its root folder and git folder, and the path of each saved file relative to its repo. These come from the same folders and names already recorded with each event. To link events captured before this was recorded, a one-time upgrade asks git about each folder in your history, once, and keeps the answer.
- **Line counts on saves:** when an editor sends them, Workscribe stores how many lines a save added and removed, and when a file's repeated saves last changed it. Never the text of the change.
- **`git commit -F <file>`:** Workscribe reads the message file's first line (the subject) when the command is captured, redacted like the command itself. Only regular files are read, at most 4 KB, and the file's path isn't stored.

---

## Anonymous install telemetry

Workscribe sends a small anonymous ping on startup, at most once every 24 hours per install — on by default.

**Sent:**
- A randomly generated install ID — not tied to your identity, your repos, or any account
- CLI version
- OS platform
- Node.js version

**Never sent:** commands, events, sessions, or summaries — nothing from the "What gets redacted" or "When your activity leaves your machine" sections below.

Telemetry does not run for the background shell-hook process that captures each command (`_capture`/`_hook`) — only for commands you run directly, and never more than once in a 24-hour window.

**Opt out:**
```bash
workscribe config set telemetry.enabled false
```

---

## What gets redacted

Before any event is written to disk, Workscribe strips sensitive patterns from the raw command string:

**Automatically redacted:**
- Bearer tokens (`Bearer <token>`)
- Authorization, API key, token (such as `PRIVATE-TOKEN` and `X-Token`) and cookie headers
- API keys and tokens from common providers, such as GitHub, GitLab, AWS, Anthropic, OpenAI, Google, npm, Slack and Stripe
- Passwords and tokens passed as flags (`--password`, `--token=…`), and tools' short flags where they mean a password, such as `mysql -p…` (also `mycli` and `mysqlsh`), `7z -p…`, `sshpass -p`, `docker login -p`, `redis-cli -a`, `openssl -k`, `curl -u user:password` and `http -a user:password`, plus `--from-literal=token=…` and `gh secret set --body`
- `password=` in connection strings, passwords in URLs, sensitive environment variables and tokens piped to `--password-stdin`
- Credentials assigned in code, such as `const API_KEY = '…'` or `token: "…"` in a `node -e` or `python3 -c` script: a quoted value of 8 or more characters assigned to a name that ends in key, token, secret, password or similar. A shorter value isn't caught, and a quoted phrase of the same shape in a commit message or note, such as `auth: 'invalid credentials'`, is redacted too. Linear API keys (`lin_api_…`) are redacted wherever they appear.
- JWT tokens
- Private keys
- Slack incoming webhook URLs (`hooks.slack.com/services/...`)

**Backups:** before each upgrade a copy of your database is taken, and the newest 3 files named `workscribe-*.db` are kept. Once the upgrade has removed secrets from your stored events, it removes them from every `.db` copy in `~/.workscribe/backups/` too, and rewrites those files so the old text doesn't stay in them. A backup then holds what your database held, minus the removed secrets: restoring one brings your history back without them. A copy that is locked or in use is retried on a later command, one that isn't a Workscribe database is left alone, and one that can't be written is named in a message once, so you can delete it or fix its permissions. Delete `~/.workscribe/backups/` yourself if you'd rather not keep any.

**Events already stored:** when you update, a data upgrade applies the built-in patterns to the commands and structured fields of your existing events, including notes, then rewrites the database file so the old text doesn't stay in it. Some things can still hold it:

- Copies of the database you made yourself, or kept anywhere but `~/.workscribe/backups/`. The upgrade only reaches the `.db` files in that folder, and nothing prunes a copy outside it, so delete those yourself.
- Saved summaries, which aren't rewritten. Summaries from older versions weren't always redacted when they were saved.
- An Aider prompt stored by an older version, if it was cut off partway through a secret. A pattern can't recognise part of one.

**Add your own patterns:**

```bash
workscribe config set redact.extra '["MY_INTERNAL_SECRET"]'
```

Your own patterns only apply to new events, not to ones already stored.

Redaction is applied as a regex replace — matched values are replaced with `[REDACTED]` before the command touches the database. Notes and commands sent by IDE integrations are redacted the same way.

It works from patterns, so an unusual form or an unlisted tool can get through. It also errs towards removing too much, so a command can occasionally lose a harmless word. For sensitive work, use `workscribe pause` (see below), and add anything specific to you with `redact.extra`.

---

## When your activity leaves your machine

**`workscribe summary`, `week` and `export` never send your activity anywhere.** Since 2.0 they use Workscribe's offline template engine, which runs entirely on your machine — there are no AI providers and no API keys.

Your activity leaves your machine only when **you ask your coding agent to summarize it with the Workscribe skill**. The agent then reads `workscribe sessions --json` (described below) and sends it to its own model provider, as it does with the rest of your conversation.

**What that JSON contains:** event categories, structured fields, commit subjects, and for each session its repo path and the directory most commands ran in.

**For unclassified commands only:** a `hint` — the first 120 characters of the command after redaction — so the agent can describe work that doesn't match a known pattern (e.g. `make deploy`, `terraform apply`).

**Structured fields can echo command arguments:** the normaliser extracts fields such as `ssh` targets, the package run by `npx`, package names (which can be local paths or URLs) and Docker image names. These are redacted like everything else, but they are values you typed.

**Aider prompts:** when an Aider session ends, Workscribe stores your last prompt from Aider's history file in that event's metadata while `capture.includeAiderPrompt` is on (the default), and it's included with the other structured fields. Turn it off to stop capturing it: `workscribe config set capture.includeAiderPrompt false`.

**Never included:**
- Full command strings
- Per-event working directories, IDE file paths or file contents
- Credentials or tokens (redacted before anything is stored)

---

## JSON output for coding agents

`workscribe sessions --json` and `workscribe events --json` expose the structured data described above — categories, structured fields, unclassified-command hints and commit subjects — plus, for each session, its repo path, the directory most commands ran in, and the ids the agent gave the conversations its events came from (never those conversations' folders). They never include full commands, per-event working directories or IDE file paths. `workscribe history` shows your stored, redacted git commands in the terminal, locally; its `--json` has none of them. The output goes wherever you or your tools send it: when a coding-agent skill reads it, it is sent to that agent's model provider.

### The Workscribe agent skill

When you ask your coding agent to summarize your work with the Workscribe skill:

- **What leaves your machine:** the `sessions --json` output above, plus any files the agent chooses to read in your repos for context, go to the agent's model provider (as all of your conversation with that agent does).
- **What's stored locally:** the summary the agent writes is saved in `~/.workscribe/workscribe.db`, after the same secret redaction as captured commands. It's kept in the `summary` table, tied to the events it describes so it survives regrouping. Summaries saved by older versions were copied there before the old `sessions` and `session_summaries` tables were removed (after the upgrade's backup). It's shown by `workscribe summary`, `workscribe context` and the VS Code status bar for that session.
- **What isn't recorded:** the skill's own `workscribe` commands are kept out of your captured activity.

If you need summaries that never leave your machine, don't use the skill — `workscribe summary` runs entirely locally.

---

## Fully offline operation

`workscribe summary`, `week` and `export` never make an external network request for your summary data. The anonymous install ping (see above) still runs unless you disable it — add `workscribe config set telemetry.enabled false` for fully offline operation, and don't use the agent skill.

Ollama was supported in 1.x for offline AI-written summaries; it was removed in 2.0 along with the cloud providers. See [Migrating to 2.0](/migrating-to-2).

---

## Pausing capture

To temporarily stop capturing — for example, when working with sensitive data or sharing your screen:

```bash
workscribe pause
# ... do sensitive work ...
workscribe resume
```

When paused, the shell hook still fires but all events are silently discarded before touching disk.

---

## Removing your data

Delete the entire data directory:

```bash
rm -rf ~/.workscribe
```

This removes the database, config, exports and backups. The shell hook in your `~/.zshrc`, `~/.bashrc` or fish `conf.d/workscribe.fish` will still fire but write nothing (it will error silently). To remove the hook, delete the block between `# workscribe:hook:start` and `# workscribe:hook:end` in your shell rc file.
