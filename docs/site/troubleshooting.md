---
title: Troubleshooting
description: Common issues and how to fix them.
---

# Troubleshooting

## Capture isn't working

**Check status first:**

```bash
workscribe status
```

If it shows `Capture active` but no events are appearing, the shell hook may not be loaded.

**Reload your shell:**

```bash
source ~/.zshrc   # or ~/.bashrc
```

Then run a command and check:

```bash
workscribe events
```

**Enable debug mode** to see what the capture process is doing:

```bash
WORKSCRIBE_DEBUG=1 workscribe status
cat ~/.workscribe/debug.log
```

---

## Shell hook is not installed

If `workscribe init` didn't detect your shell or the hook is missing:

```bash
workscribe init
```

Re-running init is safe — it skips steps already completed and re-attempts the hook install.

If you're using a non-standard shell (fish, nushell), the hook is not currently supported. You can manually trigger capture:

```bash
workscribe _capture --cmd "your command" --cwd "$PWD" --exit 0
```

**Windows is not supported.** The shell hook requires zsh or bash. If you're on Windows, use WSL2 with zsh or bash — Workscribe works normally inside WSL2.

---

## Tab completion isn't working

Shell completions are a snapshot taken at the time you ran `workscribe init` — upgrading the npm package doesn't update an already-installed `~/.workscribe/completion.*` file on its own. If completions stop working or are missing commands after an upgrade, refresh the cache file directly:

```bash
workscribe completions zsh > ~/.workscribe/completion.zsh    # or bash / fish
```

Then reload your shell:

```bash
source ~/.zshrc   # or ~/.bashrc
```

You can also re-run `workscribe init` and accept the completions prompt again — as of v1.14.2 this is safe to repeat and won't duplicate lines in your rc file.

---

## "No activity captured for today"

Either no events have been captured yet, or all commands ran were on the ignore list. Check:

```bash
workscribe events
```

If events exist but `workscribe summary` shows nothing, check the date:

```bash
workscribe summary --date $(date +%Y-%m-%d)
```

---

## Summary looks wrong or generic

**Wrong project name:**
The project name comes from the git remote URL, `package.json`, or folder name. If the folder name doesn't match the repo, set an override:

```bash
workscribe config set projects./full/path/to/repo correct-name
```

**Summary has no heading:**
This shouldn't happen — headings are generated from your data. If you're seeing this, run `workscribe --version` to check your installed version.

**Bullet points are off-topic:**
If the session shows a summary your coding agent saved (or one an AI provider wrote in 1.x), `--fresh` renders the template from your captured activity instead:

```bash
workscribe summary --fresh
```

To have the agent write a better one, ask it again — the Workscribe skill replaces the saved summary.

---

## Summary uses bullets instead of AI prose

That's expected: `workscribe summary` always uses the offline template engine, which builds bullets from your captured activity rather than writing prose. For AI-written summaries, ask your coding agent — install the Workscribe skill first:

```bash
workscribe skill install
```

Then, in Claude Code, Codex, GitHub Copilot or Cursor, ask *"summarize my work today"* (or type `/workscribe` in Claude Code). The summary the agent writes is saved, so `workscribe summary` shows it from then on.

---

## "AI providers were removed in Workscribe 2.0"

Your config still has AI provider settings from 1.x (`ai.provider`, `ai.apiKey`, `ai.model`, `ai.baseUrl` or `summary.engine`). 2.0 ignores them — summaries use the offline template, and AI-written summaries come from the agent skill. To stop the notice and delete the old settings, including any stored API key:

```bash
workscribe init
```

and answer **yes** when asked to remove the old AI settings. `workscribe config set ai.…` and `config set summary.engine` are refused with the same message. See [Migrating to 2.0](/migrating-to-2).

---

## Saving a summary: "No session matches this key"

The session's `key` came from an earlier `workscribe sessions --json`, and new activity has since regrouped that day's sessions (a session's key is its repo and start time). Run `workscribe sessions --json` again and save with the new key. The Workscribe agent skill does this automatically.

---

## Saving a summary: "it can't be typed in here" or "Nothing to save"

`workscribe sessions summary set` reads the summary text from what's sent into it, not from the keyboard. Send it with a heredoc:

```bash
workscribe sessions summary set --key '<key>' <<'EOF'
## my-project (main) — 1h 30m
- What you got done
EOF
```

---

## Saving a summary: "This summary is too long to save"

A saved summary can be at most 8 KB per session. Shorten it — Workscribe summaries are meant to be a few outcome bullets per session.

---

## Webhook not posting

Test your webhook URL directly:

```bash
curl -X POST <your-webhook-url> \
  -H "Content-Type: application/json" \
  -d '{"text":"test"}'
```

If that works but `--slack` doesn't, confirm the webhook is set (output is masked):

```bash
workscribe config get integrations.slackWebhook
# http******** (68 chars)
```

---

## Database errors

If you see SQLite errors, the database may be corrupted. The safest fix:

```bash
# Back up first
cp ~/.workscribe/workscribe.db ~/.workscribe/workscribe.db.bak

# Delete and reinitialise
rm ~/.workscribe/workscribe.db
workscribe status   # triggers reinitialisation
```

This loses captured history but config is unaffected.

---

## "upgrade failed" in `workscribe status`

An update brought a data upgrade that stopped partway. Your data is still usable as it was, and what the upgrade finished is kept. Run it again:

```bash
workscribe upgrade
```

It picks up where it stopped and prints what failed. If it keeps failing, run it with `WORKSCRIBE_DEBUG=1` and attach `~/.workscribe/debug.log` to a bug report (`workscribe bug-report`).

"upgrade check failed" means an upgrade finished but its check found data that didn't carry over. Running it again won't change that: run `workscribe bug-report`, and see below to go back to the backup taken before it.

"Another Workscribe command is backing up your data right now" clears on its own — run `workscribe upgrade` again in a moment.

"Couldn't back up your data" means Workscribe couldn't copy the database to `~/.workscribe/backups/` (often a full disk), so it changed nothing. Free some space and run `workscribe upgrade` again.

## Restoring a backup from before an upgrade

Workscribe copies your database to `~/.workscribe/backups/workscribe-<version>-<time>.db` before the first data upgrade of each version, and keeps the newest 3. To go back to one:

```bash
workscribe pause                     # stop capturing while you swap files
cp ~/.workscribe/workscribe.db ~/.workscribe/workscribe.db.before-restore
cp ~/.workscribe/backups/workscribe-<version>-<time>.db ~/.workscribe/workscribe.db
rm -f ~/.workscribe/workscribe.db-wal ~/.workscribe/workscribe.db-shm
workscribe resume
```

Activity captured after the backup was taken isn't in it. If you're still on the same Workscribe version, the next data command runs the upgrade again on the restored copy.

---

## Uninstalling

Run the uninstall command first — it removes the shell hook from your rc file and the Workscribe skill from your coding agents before the binary is deleted:

```bash
workscribe uninstall
```

Then remove the package:

```bash
# npm
npm uninstall -g @workscribe/cli

# yarn
yarn global remove @workscribe/cli

# pnpm
pnpm remove -g @workscribe/cli

# bun
bun remove -g @workscribe/cli
```

> **Note:** Run `workscribe uninstall` first. npm 7 and later don't run package cleanup scripts, so removing the package on its own leaves the shell hook in your rc file and the agent skill in your coding agents. If that already happened, see the next section.

---

## The Workscribe skill doesn't show up in my coding agent

1. Check what's installed: `workscribe skill status`. If your agent shows **not detected**, install it for that agent anyway with `workscribe skill install --agent <id>` (`claude-code`, `codex`, `copilot` or `cursor`).
2. If it shows **not installed** or **outdated**, run `workscribe skill install`.
3. Restart the agent — most agents only load skills when they start.

In Claude Code the skill appears as `/workscribe`; in other agents, ask in plain language: *"summarize my work today"*.

---

## "A different workscribe skill is already there"

`workscribe skill install` found a `workscribe` folder in the agent's skills folder that Workscribe didn't install (it has no `.workscribe-skill.json` marker) — usually an earlier manual copy. Workscribe leaves it alone so it never overwrites your own work. To replace it with the current version:

```bash
workscribe skill install --force
```

---

## `/workscribe` still shows up after removing the CLI

If you ran `npm uninstall -g @workscribe/cli` without `workscribe uninstall` first, the skill stays in your coding agents and tells them to run a `workscribe` command that no longer exists. Delete the copies Workscribe installed:

```bash
rm -rf ~/.claude/skills/workscribe ~/.agents/skills/workscribe ~/.cursor/skills/workscribe
```

Check each folder first if you've ever added a `workscribe` skill of your own there. Then restart the agent.

---

## Errors after removing Workscribe without `workscribe uninstall`

`npm uninstall -g` (and pnpm or yarn) can't clean up after Workscribe: npm 7 and later don't run package cleanup scripts. If you removed the package without running `workscribe uninstall` first, two leftovers can print errors. The shell hook itself stays silent without the binary, so it isn't one of them.

**`no such file or directory: …/completion.zsh` in every new terminal.** Workscribe 2.0.0 and earlier added a completions line to your rc file that fails once the data folder is deleted. Remove it:

```bash
perl -i -0pe 's/\n?# Workscribe completions\n(?:autoload -Uz compinit && compinit\n)?source "[^"\n]*completion\.(?:zsh|bash)"\n?/\n/g' ~/.zshrc    # or ~/.bashrc
```

**Hook errors in Claude Code on every prompt or tool call.** Open `~/.claude/settings.json` and delete the `hooks` entries whose `command` contains `_hook --source claude-code` — under `PostToolUse` and `UserPromptSubmit`. Leave every other hook alone. Hooks written by Workscribe 2.0.1 and later stay silent once the binary is gone.

**Optional tidy-up: the shell hook block.** It does nothing without the binary, but you can remove it too:

```bash
perl -i -0pe 's/\n?# Workscribe[^\n]*\n# Do not edit[^\n]*\n# workscribe:hook:start.*?# workscribe:hook:end\n?//s' ~/.zshrc    # or ~/.bashrc
```

Then restart your terminal. If Workscribe is still installed, `workscribe uninstall` removes all of this for you — and `workscribe init` updates older completions and Claude Code hooks to the silent versions.
