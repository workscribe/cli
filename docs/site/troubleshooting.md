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
This shouldn't happen — headings are generated from your data, not the AI. If you're seeing this, run `workscribe --version` to check your installed version.

**Bullet points are off-topic:**
Try `--fresh` to regenerate without cache:

```bash
workscribe summary --fresh
```

For local models (Ollama), try a larger model:

```bash
workscribe config set ai.model llama3:70b
```

---

## "AI provider not configured"

```bash
workscribe config set ai.provider anthropic   # or openai, ollama
workscribe config set ai.apiKey <your-key>
```

---

## Ollama: "connection refused"

Ollama isn't running. Start it:

```bash
ollama serve
```

And ensure the model is pulled:

```bash
ollama pull llama3
```

---

## API key errors (401 / 403)

Confirm a key is stored (output is masked for security):

```bash
workscribe config get ai.apiKey
# sk-a******** (51 chars)
```

If no key is set or you need to replace it:

```bash
workscribe config set ai.apiKey <new-key>
```

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

## Uninstalling

Run the uninstall command first — it removes the shell hook from your rc file before the binary is deleted:

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

> **Note:** From v1.8.0 onwards, `npm uninstall -g` removes the shell hook automatically via a `preuninstall` lifecycle script. Running `workscribe uninstall` first is still recommended if you want to be prompted about deleting your data.

---

## Shell errors after uninstalling (`workscribe_precmd: unknown function`)

If you uninstalled the package without running `workscribe uninstall` first, the shell hook block may still be in your rc file. The binary is gone so you can't use the CLI to clean it up — use this one-liner instead.

**zsh:**

```bash
perl -i -0pe 's/\n?# Workscribe[^\n]*\n# Do not edit[^\n]*\n# workscribe:hook:start.*?# workscribe:hook:end\n?//s' ~/.zshrc && source ~/.zshrc
```

**bash:**

```bash
perl -i -0pe 's/\n?# Workscribe[^\n]*\n# Do not edit[^\n]*\n# workscribe:hook:start.*?# workscribe:hook:end\n?//s' ~/.bashrc && source ~/.bashrc
```

Or open the file in any editor and manually delete everything between (and including) the two lines:

```
# workscribe:hook:start
...
# workscribe:hook:end
```

After removing the block, restart your terminal or run `source ~/.zshrc` (or `~/.bashrc`).
