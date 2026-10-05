import { execSync } from 'child_process'

// Only enforced when the branch follows <type>/<TICKET>-description (see CLAUDE.md
// Git workflow) — the segment right after the first "/" starting with an uppercase
// prefix + number, e.g. WOR-89, WCLI-12. Not hardcoded to one prefix, since different
// repos may use different ones. Branches without that shape are exempt.
const branch = execSync('git rev-parse --abbrev-ref HEAD').toString().trim()
const afterType = branch.split('/')[1] ?? ''
const ticketMatch = afterType.match(/^[A-Z]+-\d+/)
const ticket = ticketMatch ? ticketMatch[0] : null

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'references-branch-ticket': (parsed) => {
          if (!ticket) return [true]
          const message = parsed.raw ?? ''
          // The prepare-commit-msg hook auto-appends this footer; this rule is the
          // safety net in case that hook didn't run (e.g. --no-verify on prepare step only).
          return [message.includes(`Closes ${ticket}`), `commit message must include a "Closes ${ticket}" footer (from branch "${branch}")`]
        },
      },
    },
  ],
  rules: {
    'references-branch-ticket': [2, 'always'],
  },
}
