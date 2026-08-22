#!/usr/bin/env node
// Usage: node scripts/linear-import.mjs

const API_KEY = 'lin_api_usguv1LoLJKtwCVvtLHM13B74xLBbaIPvOtqY8TY'
const ENDPOINT = 'https://api.linear.app/graphql'

const PRIORITY = { Urgent: 1, High: 2, Medium: 3, Low: 4 }

const LABEL_COLORS = {
  'bug':        '#e11d48',
  'feature':    '#2563eb',
  'infra':      '#7c3aed',
  'dx':         '#0891b2',
  'team':       '#059669',
  'enterprise': '#d97706',
  'phase-0':    '#111827',
  'phase-1':    '#1f2937',
  'phase-2':    '#374151',
  'phase-3':    '#4b5563',
  'phase-4':    '#6b7280',
}

const ISSUES = [
  // ── World-class CLI polish ───────────────────────────────────────────────
  {
    title: '[W-01] World-class CLI quality improvements',
    priority: 'Medium',
    labels: ['dx', 'phase-1'],
    description: `Audit against top-tier CLI tools (gh, stripe, vercel) identified five gaps to close. Item 6 (offline resilience) is already shipped.

**1. Distribution — standalone binaries and one-liner installer**
- Use \`pkg\` or \`caxa\` to produce self-contained macOS (arm64/x64) and Linux (x64) binaries as release artifacts
- Add \`scripts/install.sh\` one-liner that detects platform and installs the correct binary
- Document Homebrew tap process in \`RELEASING.md\`
- No Node.js required for end users

**2. Update notifications**
- Async version check on each run against the npm registry, result cached in \`~/.workscribe/update-check.json\` (24 h TTL)
- If a newer version is available, print one non-intrusive line to stderr after the command completes
- No new runtime dependencies (use native \`fetch\`)

**3. Cross-platform shell support**
- Add \`shell/hook.fish\` and update \`detectShell()\` in \`src/cli/init.ts\` to handle fish
- Update \`src/utils/paths.ts\` to use XDG Base Directory spec on fresh installs (\`~/.config/workscribe\`, \`~/.local/share/workscribe\`, \`~/.local/state/workscribe\`); existing \`~/.workscribe/\` dirs are kept as-is

**4. Shell autocompletion**
- Add \`workscribe completions [shell]\` command that prints a completion script for zsh / bash / fish
- Extend \`workscribe init\` to offer installing completions immediately after the shell hook

**5. Bug-report command**
- \`workscribe bug-report\` collects workscribe version, Node version, OS/arch, redacted config, and last 100 lines of \`debug.log\`
- Writes a \`bug-report-<timestamp>.txt\` to \`~/.workscribe/\` and prints the path
- Prints a pre-filled GitHub issue URL so users can file a report in one step`,
  },

  // ── Phase 0: Stabilize ──────────────────────────────────────────────────
  {
    title: '[F-01] DB migration system',
    priority: 'Urgent',
    labels: ['bug', 'infra', 'phase-0'],
    description: `Implement a versioned migration system for the SQLite schema. Currently any schema change risks corrupting existing user installs. Required before IDE integration or any team/cloud schema additions.

**Acceptance criteria**
- Migration files versioned in \`src/db/migrations/\`
- Runs automatically on startup, skips already-applied migrations
- Rolls back cleanly on failure
- Existing installs upgrade without data loss`,
  },
  {
    title: '[F-02] Midnight session split',
    priority: 'High',
    labels: ['bug', 'phase-0'],
    description: `Sessions that span midnight (e.g. 11 pm–1 am) are attributed entirely to the start date, causing the next day to show missing activity and the previous day to be inflated.

**Acceptance criteria**
- Session grouper splits events at midnight boundary
- Each day gets only the events that occurred within it
- Pure function change in \`src/sessions/grouper.ts\` with test coverage`,
  },
  {
    title: '[F-03] Test coverage — events / status / export / sessions CLI',
    priority: 'High',
    labels: ['dx', 'phase-0'],
    description: `Four CLI commands have zero test coverage: \`events.ts\`, \`status.ts\`, \`export.ts\`, \`sessions.ts\`. These are user-facing commands that can regress silently.

**Acceptance criteria**
- Unit tests for each command in \`tests/cli/\`
- Cover happy path and key error states
- No DB imports in test files (mock at boundary)`,
  },
  {
    title: '[F-04] Fix Node engine version documentation',
    priority: 'Medium',
    labels: ['dx', 'phase-0'],
    description: `\`package.json\` sets \`engines.node >= 22\` (required for \`node:sqlite\`) but README and some docs imply >= 18. This misleads users and causes confusing install failures.

**Acceptance criteria**
- README, \`getting-started.md\`, and \`package.json\` all consistently state Node >= 22
- Error message on older Node is clear and actionable`,
  },

  // ── Phase 1: Solo Polish ─────────────────────────────────────────────────
  {
    title: '[P-03] VS Code / Cursor IDE hook',
    priority: 'High',
    labels: ['feature', 'phase-1'],
    description: `Capture IDE activity (file opens, saves, debug runs) alongside terminal events. The terminal alone misses significant engineering time spent in the editor.

**Acceptance criteria**
- VS Code extension or workspace settings hook
- Events flow into the same \`events\` table via \`workscribe _capture\`
- Category: \`ide_session\` or per-action category
- Optional install — not bundled with the main CLI`,
  },
  {
    title: '[P-04] Gemini and Groq provider support',
    priority: 'Medium',
    labels: ['feature', 'phase-1'],
    description: `Add Google Gemini and Groq as AI providers. Reduces barrier for users without Anthropic or OpenAI accounts and adds a fast/cheap tier via Groq.

**Acceptance criteria**
- \`src/ai/gemini.ts\` and \`src/ai/groq.ts\` implementing \`AIProvider\`
- Router updated in \`src/ai/router.ts\`
- Config and provider docs updated
- Default models documented`,
  },
  {
    title: '[P-05] workscribe undo — session-aware invalidation',
    priority: 'Medium',
    labels: ['bug', 'phase-1'],
    description: `Currently \`workscribe undo\` deletes events from the DB but does not invalidate cached sessions for the affected date. Sessions shown after undo are stale until the event count diverges.

**Acceptance criteria**
- \`undo\` calls \`clearSessionsForDate()\` for the affected date after deleting events
- Sessions rebuild correctly on next \`workscribe sessions\` or \`workscribe summary\``,
  },
  {
    title: '[P-06] Email digest — daily summary delivery',
    priority: 'Medium',
    labels: ['feature', 'phase-1'],
    description: `Send the daily summary via email so developers receive it without opening a terminal. Supports SMTP (self-configured) and optionally SendGrid.

**Acceptance criteria**
- \`workscribe config set integrations.email user@example.com\`
- Triggered manually via \`workscribe summary --email\` or cron
- Plain-text and HTML variants
- No email sent if no events captured`,
  },
  // ── Phase 2: Team MVP ────────────────────────────────────────────────────
  {
    title: '[T-01] Cloud backend — user accounts and team workspaces',
    priority: 'Urgent',
    labels: ['infra', 'team', 'phase-2'],
    description: `Design and implement the cloud backend required for all team features. Infrastructure foundation for Phase 2.

**Acceptance criteria**
- Auth: email/password + GitHub OAuth
- Team workspace model: one workspace, multiple members
- API accepts summary payloads from CLI
- Deployed and reachable at \`api.workscribe.co\`
- Secrets management and environment config documented`,
  },
  {
    title: '[T-02] Secure sync — local to cloud opt-in',
    priority: 'Urgent',
    labels: ['feature', 'team', 'phase-2'],
    description: `Developers must control what leaves their machine. Opt-in per repo or per session. Non-negotiable for professional adoption.

**Acceptance criteria**
- \`workscribe sync\` pushes summaries (not raw events) to cloud
- Per-repo opt-out via config
- Raw events never leave the device — only AI summaries sync
- Clear confirmation before first sync
- \`--dry-run\` shows what would be synced`,
  },
  {
    title: '[T-03] Slack team digest — daily and weekly rollup',
    priority: 'High',
    labels: ['feature', 'team', 'phase-2'],
    description: `Post a daily or weekly digest to a team Slack channel with per-member summaries. This is the first team touchpoint and the primary organic spread mechanism.

**Acceptance criteria**
- Team admin configures a shared Slack webhook
- Each member's summary is attributed by name
- Daily digest posts automatically at a configured time
- Opt-out per member
- Formatted for Slack (bold headings, bullet conversion)`,
  },
  {
    title: '[T-04] Team web dashboard — read-only summary view',
    priority: 'High',
    labels: ['feature', 'team', 'phase-2'],
    description: `A web dashboard where team members and managers can view aggregated work summaries without installing anything.

**Acceptance criteria**
- Auth via invite link or GitHub
- Shows today + last 7 days per member
- Grouped by project/repo
- Mobile-readable
- No raw event data exposed — summaries only`,
  },
  {
    title: '[T-05] Privacy controls — per-repo and per-session opt-out',
    priority: 'Urgent',
    labels: ['feature', 'team', 'phase-2'],
    description: `Developers must be able to exclude sensitive repos or sessions from any cloud sync or team visibility. Without this, adoption in professional teams is blocked.

**Acceptance criteria**
- \`workscribe privacy exclude /path/to/repo\`
- Excluded repos: events captured locally but never synced or in team view
- Paused sessions flagged and excluded from sync
- Privacy settings visible in \`workscribe status\``,
  },
  {
    title: '[T-06] Invite flow — workscribe invite',
    priority: 'High',
    labels: ['feature', 'team', 'phase-2'],
    description: `Bottom-up team onboarding. One developer installs and invites teammates without requiring admin involvement.

**Acceptance criteria**
- \`workscribe invite user@example.com\` sends an invite to join the workspace
- Invite email includes install instructions
- Invitee CLI prompts to join workspace on first sync
- Team admin can revoke invites`,
  },

  // ── Phase 3: Team Intelligence ───────────────────────────────────────────
  {
    title: '[I-01] GitHub integration — link sessions to PRs and issues',
    priority: 'High',
    labels: ['feature', 'team', 'phase-3'],
    description: `Connect captured terminal sessions to the GitHub PRs and issues they contributed to. Closes the loop between work captured and work shipped.

**Acceptance criteria**
- GitHub OAuth in cloud backend
- Sessions with \`git push\` events are linked to the corresponding PR automatically
- PR description can be auto-populated from Workscribe summary
- Team dashboard shows sessions grouped by PR`,
  },
  {
    title: '[I-02] Linear integration — tag sessions to issues',
    priority: 'High',
    labels: ['feature', 'team', 'phase-3'],
    description: `Link captured sessions to Linear issues. Developers tag sessions; managers see which issues consumed the most real time.

**Acceptance criteria**
- \`workscribe tag LIN-123\` links current session to a Linear issue
- OAuth with Linear API
- Time-on-issue visible in team dashboard
- Linear issue comments optionally updated with session summary`,
  },
  {
    title: '[I-03] Sprint retrospective generation',
    priority: 'Medium',
    labels: ['feature', 'team', 'phase-3'],
    description: `Generate a sprint retrospective from actual terminal data rather than from memory. Replaces the "what did we do this sprint?" question with a factual answer.

**Acceptance criteria**
- \`workscribe retro --sprint <start> <end>\` generates a markdown retro
- Grouped by team member and project
- Highlights: what shipped, what took longest, inferred blockers
- Exportable to Linear, Notion, or markdown file`,
  },
  {
    title: '[I-04] Manager aggregate view — trends and bottlenecks',
    priority: 'High',
    labels: ['feature', 'team', 'phase-3'],
    description: `Give engineering managers a view of where time actually goes across the team — by project, by work type, over time.

**Acceptance criteria**
- Time breakdown by category (feature, bug, infra)
- Trend chart: week-over-week per project
- Bottleneck signal: repos with high event density but low commit frequency
- Exportable as PDF or CSV`,
  },
  {
    title: '[I-05] Jira integration',
    priority: 'Medium',
    labels: ['feature', 'team', 'phase-3'],
    description: `Enterprise teams require Jira integration for adoption. Link sessions to Jira tickets and surface time-on-ticket data.

**Acceptance criteria**
- Jira OAuth (cloud and server)
- \`workscribe tag PROJ-456\` links session to Jira issue
- Jira issue time-tracking fields optionally updated
- Team dashboard Jira view`,
  },
  {
    title: '[I-06] workscribe report — sharable engineering time report',
    priority: 'Medium',
    labels: ['feature', 'team', 'phase-3'],
    description: `Generate a sharable report of engineering time for a period — replaces manual status updates sent to leadership.

**Acceptance criteria**
- \`workscribe report --week\` / \`--month\` outputs markdown or PDF
- Includes: total time by project, key achievements, open work
- Sharable link via cloud backend
- Team aggregate and individual views`,
  },

  // ── Phase 4: Enterprise ──────────────────────────────────────────────────
  {
    title: '[E-01] SSO / SAML authentication',
    priority: 'Medium',
    labels: ['infra', 'enterprise', 'phase-4'],
    description: `Enterprise procurement requires SSO. Without it, large orgs cannot approve Workscribe for team-wide use.

**Acceptance criteria**
- SAML 2.0 SSO (Okta, Google Workspace, Azure AD)
- Enforce SSO for workspace (admin setting)
- JIT provisioning of new members on first SSO login`,
  },
  {
    title: '[E-02] Audit logs',
    priority: 'Medium',
    labels: ['infra', 'enterprise', 'phase-4'],
    description: `Compliance requirement for enterprise customers — who captured what, what was synced, who accessed it.

**Acceptance criteria**
- Immutable audit log: member activity, sync events, permission changes
- Exportable as CSV
- Retention policy configurable (90 / 180 / 365 days)
- Accessible by workspace admin only`,
  },
  {
    title: '[E-03] On-prem and self-hosted cloud tier',
    priority: 'Low',
    labels: ['infra', 'enterprise', 'phase-4'],
    description: `Security-sensitive orgs won't send any data to a SaaS. Self-hosted option removes this blocker.

**Acceptance criteria**
- Docker Compose deployment of cloud backend
- Helm chart for Kubernetes
- Self-hosted licence key model
- Full feature parity with cloud SaaS tier`,
  },
  {
    title: '[E-04] Custom AI model configuration per org',
    priority: 'Low',
    labels: ['feature', 'enterprise', 'phase-4'],
    description: `Some enterprises cannot send code context to Anthropic or OpenAI due to data policies. Custom model support removes the last adoption blocker.

**Acceptance criteria**
- Workspace-level AI provider config (overrides individual user config)
- Supports Azure OpenAI (data residency)
- Supports self-hosted models (Ollama on-prem, vLLM)
- Admin can restrict which providers members can use`,
  },
  {
    title: '[E-05] Public API for third-party integrations',
    priority: 'Medium',
    labels: ['infra', 'enterprise', 'phase-4'],
    description: `Allow ecosystem tools to build on top of Workscribe data — custom dashboards, BI tools, HR systems.

**Acceptance criteria**
- REST API with OAuth 2.0 client credentials
- Endpoints: sessions, summaries, team members, projects
- Rate limiting and API key management in dashboard
- API reference in docs`,
  },
]

// ── API helpers ──────────────────────────────────────────────────────────────

async function gql(query, variables = {}) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (json.errors) throw new Error(JSON.stringify(json.errors, null, 2))
  return json.data
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  // 1. Fetch team
  const { teams } = await gql(`{ teams { nodes { id name } } }`)
  const team = teams.nodes[0]
  if (!team) throw new Error('No team found in this Linear workspace.')
  console.log(`✓ Team: ${team.name} (${team.id})`)

  // 2. Fetch Backlog state
  const { workflowStates } = await gql(
    `query($teamId: ID!) {
      workflowStates(filter: { team: { id: { eq: $teamId } } }) {
        nodes { id name }
      }
    }`,
    { teamId: team.id }
  )
  const backlog = workflowStates.nodes.find((s) => s.name === 'Backlog')
  if (!backlog) throw new Error('No "Backlog" workflow state found.')
  console.log(`✓ Backlog state: ${backlog.id}`)

  // 3. Fetch existing labels (workspace-wide, case-insensitive key)
  const { issueLabels } = await gql(
    `{ issueLabels(first: 250) { nodes { id name } } }`
  )
  const labelMap = new Map(issueLabels.nodes.map((l) => [l.name.toLowerCase(), l.id]))
  console.log(`✓ Existing labels: ${[...labelMap.keys()].join(', ') || 'none'}`)

  // 4. Create any missing labels (compare lowercase to avoid "Bug" vs "bug" conflict)
  const allLabels = [...new Set(ISSUES.flatMap((i) => i.labels))]
  for (const name of allLabels) {
    if (!labelMap.has(name.toLowerCase())) {
      const color = LABEL_COLORS[name] ?? '#6b7280'
      const { issueLabelCreate } = await gql(
        `mutation($input: IssueLabelCreateInput!) {
          issueLabelCreate(input: $input) {
            success
            issueLabel { id name }
          }
        }`,
        { input: { name, color, teamId: team.id } }
      )
      if (!issueLabelCreate.success) throw new Error(`Failed to create label: ${name}`)
      labelMap.set(name.toLowerCase(), issueLabelCreate.issueLabel.id)
      console.log(`  + Created label: ${name}`)
      await sleep(200)
    }
  }
  console.log(`✓ All labels ready`)

  // 5. Create issues
  console.log(`\nCreating ${ISSUES.length} issues...\n`)
  for (const issue of ISSUES) {
    const labelIds = issue.labels.map((l) => {
      const id = labelMap.get(l.toLowerCase())
      if (!id) throw new Error(`Label not found in map: ${l}`)
      return id
    })

    const { issueCreate } = await gql(
      `mutation($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue { id identifier title }
        }
      }`,
      {
        input: {
          teamId: team.id,
          stateId: backlog.id,
          title: issue.title,
          description: issue.description,
          priority: PRIORITY[issue.priority] ?? 0,
          labelIds,
        },
      }
    )

    if (!issueCreate.success) throw new Error(`Failed to create: ${issue.title}`)
    console.log(`  ✓ ${issueCreate.issue.identifier}  ${issueCreate.issue.title}`)
    await sleep(300)
  }

  console.log(`\n✓ Done — ${ISSUES.length} issues created in Linear.`)
}

main().catch((err) => {
  console.error('\n✗', err.message)
  process.exit(1)
})
