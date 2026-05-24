# Workscribe — IDE Integration PRD

**Version:** 1.0  
**Date:** 2026-05-24  
**Status:** Draft  
**Scope:** Phase 2 — IDE & Editor Integration

---

## 1. Overview

Workscribe's shell hook captures everything that happens in the terminal. It does not capture what happens inside an IDE: files being edited, debug sessions, IDE-triggered builds, or notebook cell executions.

This phase extends Workscribe to capture IDE activity using the same mechanism as the shell hook — a thin plugin spawns `workscribe _capture` as a background subprocess. No daemon. No HTTP server. No changes to the installation flow.

The result: developers who spend most of their time in an editor get a complete work summary, not just a record of git commits and terminal commands.

---

## 2. Problem Being Solved

A developer working in VS Code or IntelliJ may spend 3 hours editing code, debugging, and running tests — and generate only two terminal commands: `git add` and `git commit`. The current summary would describe 3 hours of work as "committed changes". That is not useful.

IDE integration bridges this gap. File saves, debug sessions, and IDE-triggered builds all become first-class events that the session grouper and AI summariser can reason about.

---

## 3. Goals

- Capture meaningful IDE activity (file saves, debug sessions, builds, test runs, refactors) without disrupting the editor experience
- Add zero new infrastructure — no daemon, no background server, no port to manage
- Keep the installation flow identical: `npm install -g @workscribe/cli && workscribe init`
- IDE plugins are thin shims — each is under 100 lines and has one job: detect an event, spawn `workscribe _capture`
- IDE events feed into the same session grouping and AI summarisation pipeline as shell events

---

## 4. Privacy Guarantee

All captured data — from the shell hook and from IDE plugins — is stored exclusively on the user's local machine in `~/.workscribe/`. Nothing is sent to any remote server except the user's configured AI provider at summary time, and only on explicit request (`workscribe summary`).

### What stays local forever

| Data | Storage |
|---|---|
| Captured events (commands, file paths, git context) | `~/.workscribe/workscribe.db` only |
| Session groupings | `~/.workscribe/workscribe.db` only |
| Config (API keys, provider settings) | `~/.workscribe/config.json` only |
| Exported summaries | `~/.workscribe/exports/` only |
| Debug logs | `~/.workscribe/debug.log` only |

### What is sent to the AI provider (only at summary time)

`workscribe summary` sends a structured payload to the configured AI provider. The payload contains:

- Date
- Project name (git repo name)
- Branch name
- Session time ranges
- Normalised event categories and metadata (e.g. `dependency_install`, `test_run`)

**What is never sent:**
- Raw command strings
- File contents
- Credentials or redacted values
- Working directory paths
- File paths from IDE events (see §4.1)

The AI provider receives enough to write a meaningful summary — not enough to reconstruct what was typed or what files contain.

### 4.1 File paths from IDE events

IDE plugins capture file paths (e.g. `src/auth/middleware.ts`). These are stored locally in the `file_path` column. They are **not** included in the AI payload. The AI receives only the event category (`code_edit`) and, optionally, the file extension (for language context). Full paths remain on device.

This is a deliberate constraint. File paths can reveal project structure, client names, or confidential feature names to a third-party AI provider.

### 4.2 Plugin telemetry

IDE marketplaces and plugin SDKs sometimes include telemetry by default. Workscribe plugins opt out explicitly:

- **VS Code:** The extension does not import `@vscode/extension-telemetry`. It respects the user's VS Code telemetry setting (`telemetry.telemetryLevel`) and adds no telemetry of its own.
- **JetBrains:** The plugin does not register with the JetBrains telemetry service. No usage data is collected.
- **Neovim / Jupyter:** No telemetry infrastructure exists in these ecosystems; no action required.

### 4.3 Using Ollama for full on-device operation

Users who configure `ai.provider = ollama` keep all data on-device end to end. No data leaves the machine at any point, including at summary time.

```bash
workscribe config set ai.provider ollama
```

---

## 5. Out of Scope

- Keystroke-level tracking, cursor movement, file opens, tab switches (too noisy, no signal value)
- Browser DevTools or web console capture (Phase 3)
- Cloud sync of IDE events
- Team-level activity aggregation
- Windows support for IDE plugins (Phase 3)

---

## 6. Target Users

Developers who:
- Spend most of their working time inside an IDE rather than the terminal
- Currently see sparse summaries because their work doesn't generate many shell commands
- Use VS Code, a JetBrains IDE, Neovim, or Jupyter Notebooks

---

## 7. User Stories

| ID | As a developer, I want to... | So that... |
|---|---|---|
| US-11 | Have my file edits captured automatically | My summary reflects the time I spent writing code, not just committing it |
| US-12 | Have debug sessions appear in my summary | Investigation work gets documented even when it produces no commit |
| US-13 | Have IDE-triggered builds and test runs captured | I don't have to switch to the terminal just to generate a work event |
| US-14 | Install the IDE plugin with one command | I don't need to configure a server or background process |
| US-15 | Have IDE events appear alongside terminal events in summaries | My summary is complete regardless of where the work happened |
| US-16 | Use Workscribe with Neovim | My editor choice doesn't exclude me from the tool |
| US-17 | Use Workscribe with any JetBrains IDE | My backend/mobile/data work is captured the same way as web work |

---

## 8. Architecture

### 8.1 Design principle

IDE plugins follow the same model as the shell hook: spawn `workscribe _capture` as a detached background process and ignore errors. The plugin has no persistent state and requires no IPC.

```
IDE event fires
  → plugin builds CLI args
  → spawns: workscribe _capture --type <event> --file <path> --source <ide> --cwd <dir> &
  → capture pipeline runs (filter → dedup → git context → normalize → insertEvent)
  → event written to SQLite
```

### 8.2 Why not a local HTTP server

A local HTTP server would require:
- A daemon process that must be running for events to land
- Process management and startup agents
- Port conflict handling
- A separate install step per IDE

The subprocess approach requires none of this. The tradeoff is ~50–100ms subprocess spawn overhead per event, which is acceptable because IDE events are low-frequency (file saves, not keystrokes).

### 8.3 PATH resolution

IDE processes often do not inherit the user's shell PATH. Plugins must locate `workscribe` explicitly:

1. Check the user-configurable path setting (e.g. `workscribe.executablePath` in VS Code)
2. Query `which workscribe` / `where workscribe` via shell
3. Check common install locations: `~/.npm-global/bin`, `/usr/local/bin`, `$(npm root -g)/../bin`
4. If not found: show a one-time warning with instructions — do not crash the IDE

---

## 9. Core Changes (Phase 1 — prerequisite for all plugins)

### 8.1 New `_capture` flags

The existing `_capture` command gains three optional flags. Shell events continue to work unchanged.

| Flag | Values | Purpose |
|---|---|---|
| `--type <event>` | See §8.3 | IDE event type — triggers the IDE event path |
| `--source <name>` | `vscode`, `jetbrains`, `neovim`, `jupyter` | Identifies the plugin origin |
| `--file <path>` | Relative or absolute file path | File involved in the event |

When `--type` is present, the event is treated as an IDE event and bypasses command normalization.

### 8.2 DB schema additions

Two new columns added via migration. Existing rows default gracefully.

```sql
ALTER TABLE events ADD COLUMN source    TEXT NOT NULL DEFAULT 'shell';
ALTER TABLE events ADD COLUMN file_path TEXT;
```

`EventRow` in `src/db/types.ts` gains:

```ts
source:    string       // 'shell' | 'vscode' | 'jetbrains' | 'neovim' | 'jupyter'
file_path: string | null
```

### 8.3 IDE event type → category mapping

| `--type` | `category` | `command` (stored for display) |
|---|---|---|
| `file_save` | `code_edit` | `"Saved <relative-file>"` |
| `debug_start` | `debug` | `"Started debug session"` |
| `debug_end` | `debug` | `"Ended debug session"` |
| `build_start` | `build` | `"Build started"` |
| `build_end` | `build` | `"Build completed"` |
| `test_run` | `test_run` | `"Test run (IDE)"` |
| `refactor` | `code_edit` | `"Refactored <file>"` |
| `notebook_cell` | `script_run` | `"Ran notebook cell"` |

Mapping lives in `src/capture/ide.ts` — a pure module with no DB import, fully testable.

### 8.4 Deduplication adjustment

File saves fire rapidly. The existing 5-second dedup window is too tight. For `file_save` events, the dedup window is extended to 30 seconds per file. The `isDuplicate` function already accepts a `windowMs` parameter — this wires it.

### 8.5 AI prompt update

`src/ai/prompt.ts` system prompt addition:

> "file_save and code_edit events represent active development — group clusters of saves on the same area of the codebase into a single bullet (e.g. 'worked on authentication module'). Do not list individual file names unless there is only one."

`buildUserMessage` appends `[IDE]` to events with a non-shell source so the AI can distinguish them from terminal events.

### 8.6 New tests

`tests/ide-capture.test.ts`:
- `buildIdeEvent` returns correct category and display command for each type
- Unknown `--type` falls through to category `other`
- File path is made relative to cwd
- Dedup window is 30s for `file_save`, 5s for shell events

---

## 10. Phase 2 — VS Code Extension

**Package:** `@workscribe/vscode`  
**Repository:** `workscribe-vscode` (separate repo)  
**Distribution:** VS Code Marketplace

### 9.1 Events captured

| VS Code API | Trigger | Flags |
|---|---|---|
| `workspace.onDidSaveTextDocument` | File saved | `--type file_save --file <path>` |
| `debug.onDidStartDebugSession` | Debugger attached | `--type debug_start` |
| `debug.onDidTerminateDebugSession` | Debugger detached | `--type debug_end` |
| `tasks.onDidStartTask` | Task started (build/test) | `--type build_start` |
| `tasks.onDidEndTask` | Task ended | `--type build_end` |

### 9.2 File save filtering

- Skip files matching `ignorePaths` patterns (default: `**/node_modules/**`, `**/.git/**`, `**/*.log`)
- Skip saves where the document version has not changed (VS Code auto-save without modification)
- Core dedup (30s window) handles the rest

### 9.3 Extension settings

```json
{
  "workscribe.enabled": true,
  "workscribe.executablePath": "",
  "workscribe.captureFileSaves": true,
  "workscribe.captureDebugSessions": true,
  "workscribe.captureBuilds": true,
  "workscribe.ignorePaths": ["**/node_modules/**", "**/.git/**", "**/*.log"]
}
```

### 9.4 Subprocess invocation

```ts
import { execFile } from 'child_process'

function capture(args: string[]): void {
  execFile(resolvedPath, ['_capture', ...args, '--source', 'vscode'], {
    timeout: 5000,
    windowsHide: true,
  }, () => {}) // errors silently ignored
}
```

---

## 11. Phase 3 — Neovim Plugin

**Package:** `workscribe.nvim`  
**Repository:** `workscribe-nvim` (separate repo)  
**Distribution:** lazy.nvim / packer / vim-plug compatible

### 10.1 Events captured

| Neovim autocommand | Trigger | Flags |
|---|---|---|
| `BufWritePost` | Buffer written to disk | `--type file_save --file <buf>` |

Neovim users are terminal-native — their builds, tests, and git operations already appear via the shell hook. File saves are the main gap.

### 10.2 Plugin structure

```lua
-- Single autocommand, fires after successful write
vim.api.nvim_create_autocmd("BufWritePost", {
  callback = function(ev)
    vim.system({
      "workscribe", "_capture",
      "--type", "file_save",
      "--file", ev.file,
      "--cwd",  vim.fn.getcwd(),
      "--source", "neovim",
      "--exit", "0", "--duration", "0",
    }, { detach = true })
  end,
})
```

### 10.3 Configuration

```lua
require('workscribe').setup({
  enabled = true,
  executable = "",            -- override if workscribe not on PATH
  ignore_patterns = { "%.git/", "node_modules/" },
})
```

---

## 12. Phase 4 — JetBrains Plugin

**Package:** `workscribe-jetbrains`  
**Repository:** `workscribe-jetbrains` (separate repo, Kotlin)  
**Distribution:** JetBrains Marketplace  
**Covers:** IntelliJ IDEA, WebStorm, GoLand, PyCharm, Rider, CLion, Android Studio

### 11.1 Events captured

| JetBrains listener | Trigger | Flags |
|---|---|---|
| `VirtualFileListener.contentsChanged` | File saved | `--type file_save --file <path>` |
| `CompilationStatusListener.compilationFinished` | Build completed | `--type build_end` |
| `ExecutionListener.processStarted` | Run/debug started | `--type debug_start` |
| `ExecutionListener.processTerminated` | Run/debug ended | `--type debug_end` |

### 11.2 Subprocess invocation

Uses `ProcessBuilder` on a non-blocking background thread. PATH is sourced from the JetBrains shell integration layer (`com.intellij.openapi.util.SystemInfo` + environment). User-configurable executable path in plugin settings.

### 11.3 Scope note

JetBrains plugins require the Platform SDK and Kotlin. This is the most effort of the four plugins but covers the largest enterprise developer segment — Java, Kotlin, .NET, mobile (Android Studio), Python (PyCharm), and Go. Build after VS Code and Neovim have validated the model.

---

## 13. Phase 5 — Jupyter Extension

**Package:** `jupyter-workscribe`  
**Repository:** `workscribe-jupyter` (separate repo, Python)  
**Distribution:** PyPI (`pip install jupyter-workscribe`)

### 12.1 Events captured

| Jupyter hook | Trigger | Flags |
|---|---|---|
| `post_execute` kernel callback | Notebook cell executed | `--type notebook_cell` |

### 12.2 Extension structure

Jupyter server extension that registers a kernel execution hook:

```python
def post_execute_hook(cell_source: str, execution_count: int) -> None:
    subprocess.Popen([
        "workscribe", "_capture",
        "--type", "notebook_cell",
        "--source", "jupyter",
        "--cwd", os.getcwd(),
        "--exit", "0",
        "--duration", "0",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
```

### 12.3 Scope note

Data scientists are the most underserved segment for work journaling — most of their work happens in notebooks with no shell footprint. This phase closes that gap. Python package is straightforward; the primary risk is kernel environment PATH isolation (same problem as VS Code, same solution: configurable executable path).

---

## 14. Data Model Changes

### 13.1 Updated events table

```sql
CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  captured_at TEXT    NOT NULL,
  command     TEXT    NOT NULL,   -- human-readable for IDE events (e.g. "Saved src/auth.ts")
  cwd         TEXT    NOT NULL,
  exit_code   INTEGER,
  duration_ms INTEGER,
  repo_name   TEXT,
  branch      TEXT,
  category    TEXT    NOT NULL DEFAULT 'other',
  metadata    TEXT,
  source      TEXT    NOT NULL DEFAULT 'shell',  -- NEW
  file_path   TEXT                               -- NEW
);
```

### 13.2 Event categories (additions)

| Category | Source | Meaning |
|---|---|---|
| `code_edit` | IDE | File saves and refactors |
| `debug` | IDE | Debug session start/end |

Existing categories (`build`, `test_run`) are reused for IDE-triggered equivalents.

---

## 15. AI Summarisation Impact

IDE events enrich the summary in a specific way: they reveal work that happened between commits.

**Before IDE integration:**
```
## api-service (feature/auth) — 3h 10m
- Committed authentication middleware
```

**After IDE integration:**
```
## api-service (feature/auth) — 3h 10m
- Worked on authentication middleware across several files
- Investigated session handling bugs via debug session
- Resolved failing build after middleware changes
- Committed authentication middleware
```

The AI prompt is updated to group clusters of `code_edit` events into single bullets describing the area of work, not individual file saves.

---

## 16. Functional Requirements

### 15.1 Core (Phase 1)

| ID | Requirement |
|---|---|
| FR-34 | `workscribe _capture` accepts `--type`, `--source`, and `--file` flags |
| FR-35 | When `--type` is present, the event bypasses shell command normalization |
| FR-36 | IDE events are stored with `source` set to the plugin origin |
| FR-37 | IDE event types map to categories as defined in §8.3 |
| FR-38 | File save events deduplicate within a 30-second window per file (not 5 seconds) |
| FR-39 | File path is stored relative to `cwd` where possible |
| FR-40 | IDE events participate in session grouping identically to shell events |
| FR-41 | AI prompt handles `code_edit` events without listing individual file names |

### 15.2 VS Code Extension

| ID | Requirement |
|---|---|
| FR-42 | Extension activates without requiring any configuration beyond install |
| FR-43 | Extension locates `workscribe` binary via PATH, common install locations, or user setting |
| FR-44 | If `workscribe` is not found, extension shows a one-time status bar warning — it does not crash |
| FR-45 | File saves to paths matching `ignorePaths` are not captured |
| FR-46 | All capture calls are fire-and-forget — extension never waits on `workscribe` |

### 15.3 All Plugins

| ID | Requirement |
|---|---|
| FR-47 | Plugin failure never affects the IDE or editor session |
| FR-48 | All plugins accept a user-configurable `workscribe` executable path |
| FR-49 | Plugin can be disabled without uninstalling |

---

## 17. Non-Functional Requirements

| ID | Requirement |
|---|---|
| NFR-07 | IDE plugin adds < 5ms of synchronous overhead per event (subprocess spawns async) |
| NFR-08 | Plugin does not spawn more than one `workscribe` process per second |
| NFR-09 | All plugins are < 150 lines of code (they are shims, not applications) |
| NFR-10 | Each plugin published to its respective marketplace under the `workscribe` namespace |

---

## 18. Build Sequence

Phases 2–5 are independent and can be worked in parallel once Phase 1 ships.

```
Phase 1: Core changes (this repo)
  ├── extends _capture flags
  ├── DB migration
  ├── ide.ts pure module
  ├── prompt update
  └── tests

Phase 2: VS Code (workscribe-vscode)       ← highest reach, start here
Phase 3: Neovim (workscribe-nvim)          ← low effort, strong community signal
Phase 4: JetBrains (workscribe-jetbrains)  ← high effort, enterprise coverage
Phase 5: Jupyter (workscribe-jupyter)      ← data science gap
```

---

## 19. Distribution & Publishing

Each plugin lives in its own repository and publishes to its platform's marketplace independently. The core CLI (`@workscribe/cli`) does not need to be republished when plugins are updated.

### 18.1 VS Code — Visual Studio Marketplace

**Publish tool:** `vsce` (Visual Studio Code Extension CLI)

**One-time setup:**
1. Create a publisher account at marketplace.visualstudio.com under the `workscribe` publisher name
2. Generate a Personal Access Token in Azure DevOps with Marketplace (publish) scope
3. Run `vsce login workscribe` and paste the token

**Publishing a release:**
```bash
npm install -g @vscode/vsce
vsce package          # produces workscribe-vscode-x.y.z.vsix
vsce publish          # pushes to marketplace.visualstudio.com
```

**Open VSX (Cursor, Windsurf, VSCodium):**

VS Code forks use the Open VSX Registry instead of the Microsoft marketplace. Publish there separately to cover them:
```bash
npm install -g ovsx
ovsx publish workscribe-vscode-x.y.z.vsix -p <open-vsx-token>
```

One extra command after every VS Code publish doubles reach to all VS Code-compatible editors.

**How users install:**
```
VS Code → Extensions panel → search "Workscribe" → Install
```
Or via CLI: `code --install-extension workscribe.workscribe-vscode`

---

### 18.2 JetBrains — JetBrains Marketplace

**Publish tool:** Gradle plugin (`org.jetbrains.intellij`)

**One-time setup:**
1. Create a vendor account at plugins.jetbrains.com
2. Generate a plugin publish token in the vendor portal
3. Set `JETBRAINS_PUBLISH_TOKEN` in CI environment

**Publishing a release:**
```bash
./gradlew buildPlugin      # produces build/distributions/workscribe-jetbrains-x.y.z.zip
./gradlew publishPlugin    # pushes to plugins.jetbrains.com
```

**Review process:** First-time plugin submissions are reviewed by JetBrains before going live. This takes 1–3 business days. Subsequent version updates publish automatically without review.

**Compatibility declaration:** `plugin.xml` specifies the IDE version range the plugin supports. A single listing covers all JetBrains products (IntelliJ, WebStorm, GoLand, PyCharm, Rider, CLion, Android Studio) — the user installs from whichever IDE they are in.

**How users install:**
```
Any JetBrains IDE → Settings → Plugins → Marketplace tab → search "Workscribe" → Install
```

---

### 18.3 Neovim — GitHub + Community Directories

Neovim has no official marketplace. The GitHub repository is the package. Users add it to their plugin manager of choice.

**Publishing a release:**
```bash
git tag v1.0.0
git push origin v1.0.0
```
That's it. Plugin managers (lazy.nvim, packer, vim-plug) pull directly from GitHub tags or the default branch.

**User installation:**
```lua
-- lazy.nvim
{ "eldrego/workscribe-nvim" }
```
```vim
" vim-plug
Plug "eldrego/workscribe-nvim"
```

**Discovery:** There is no search-based marketplace. Discoverability depends on:
- Submitting to **dotfyle.com** (the de facto Neovim plugin directory — submit via PR to their GitHub repo)
- Adding to the **awesome-neovim** list on GitHub (submit a PR)
- A post on **r/neovim** at launch — the fastest route to early users

---

### 18.4 Jupyter — PyPI

**Publish tool:** `twine`

**One-time setup:**
1. Create an account at pypi.org
2. Generate an API token in account settings
3. Add token to `~/.pypirc` or set `TWINE_PASSWORD` in CI

**Publishing a release:**
```bash
pip install build twine
python -m build                    # produces dist/
twine upload dist/*                # pushes to pypi.org
```

**How users install:**
```bash
pip install jupyter-workscribe
```

If implemented as a Jupyter server extension, it activates automatically on server start — no additional enable step required. Users on older Jupyter versions may need:
```bash
jupyter server extension enable jupyter_workscribe
```

---

### 18.5 CI/CD for plugin releases

Each plugin repo should have a release workflow (GitHub Actions) that:

1. Triggers on a version tag push (`v*`)
2. Runs tests
3. Builds the plugin artifact
4. Publishes to the respective marketplace using a stored secret token
5. Creates a GitHub release with changelog

This mirrors the release-it workflow used in the core CLI repo.

---

### 18.6 Versioning

Plugins are versioned independently of the core CLI. A plugin version communicates compatibility with `workscribe _capture` flags, not the CLI version.

| Scenario | Action |
|---|---|
| New `_capture` flag added to core | Minor bump on core; plugin can adopt it without a major bump |
| Plugin-breaking change to `_capture` interface | Major bump on core; plugin bumps its minimum required CLI version in README |
| Plugin bug fix or new IDE event | Plugin releases independently, core unchanged |

Plugins should document the minimum `@workscribe/cli` version they require in their README.

---

## 20. Success Criteria



| Metric | Target |
|---|---|
| IDE event capture latency | Zero perceptible impact on editor experience |
| Plugin install time | Under 2 minutes from extension marketplace |
| Summary completeness | Developer working entirely in IDE produces a useful summary |
| Plugin failure isolation | IDE session unaffected if `workscribe` is missing or crashes |
| PATH resolution | Plugin locates `workscribe` correctly on nvm, volta, and fnm environments |

---

## 21. Open Questions

1. Should `file_save` events include the file extension so the AI can infer language context (e.g. "edited TypeScript files" vs "edited Python files")?
2. Should there be a `workscribe status --ide` command that shows which IDE sources have sent events in the last 24 hours?
3. For JetBrains: should the plugin cover all IDEs with one Marketplace listing, or separate listings per product?
4. For Jupyter: should cell execution events include the cell type (code vs markdown) to filter out documentation-only work?
5. Should IDE-only sessions (no shell events at all) be handled differently in the session grouper, given they lack exit codes and durations?
