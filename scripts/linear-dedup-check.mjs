#!/usr/bin/env node
// Usage: node scripts/linear-dedup-check.mjs

const API_KEY = 'lin_api_usguv1LoLJKtwCVvtLHM13B74xLBbaIPvOtqY8TY'
const ENDPOINT = 'https://api.linear.app/graphql'

async function gql(query, variables = {}) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: API_KEY },
    body: JSON.stringify({ query, variables }),
  })
  const json = await res.json()
  if (json.errors) throw new Error(JSON.stringify(json.errors, null, 2))
  return json.data
}

// Strip [X-NN] prefix, lowercase, trim — so [W-01] Foo and [P-03] Foo collapse to "foo"
function normalizeTitle(title) {
  return title
    .replace(/^\[[A-Z]-\d+\]\s*/i, '')
    .toLowerCase()
    .trim()
}

async function fetchAllIssues(teamId) {
  const issues = []
  let cursor = null

  do {
    const data = await gql(
      `query($teamId: ID!, $after: String) {
        issues(
          first: 100
          after: $after
          filter: { team: { id: { eq: $teamId } } }
          includeArchived: false
        ) {
          pageInfo { hasNextPage endCursor }
          nodes { id identifier title createdAt }
        }
      }`,
      { teamId, after: cursor }
    )
    issues.push(...data.issues.nodes)
    cursor = data.issues.pageInfo.hasNextPage ? data.issues.pageInfo.endCursor : null
  } while (cursor)

  return issues
}

async function main() {
  const { teams } = await gql(`{ teams { nodes { id name } } }`)
  const team = teams.nodes[0]
  if (!team) throw new Error('No team found in this Linear workspace.')
  console.log(`✓ Team: ${team.name} (${team.id})`)

  const issues = await fetchAllIssues(team.id)
  console.log(`✓ Fetched ${issues.length} active issues\n`)

  const groups = new Map()
  for (const issue of issues) {
    const key = normalizeTitle(issue.title)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(issue)
  }

  const duplicateGroups = [...groups.entries()]
    .filter(([, group]) => group.length > 1)
    .map(([key, group]) => ({
      key,
      // oldest first — that's the one we keep
      group: [...group].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
    }))

  if (duplicateGroups.length === 0) {
    console.log('✓ No duplicates found.')
    return
  }

  console.log(`⚠  Found ${duplicateGroups.length} duplicate group(s):\n`)

  for (const { key, group } of duplicateGroups) {
    console.log(`  Normalized title: "${key}"`)
    for (let index = 0; index < group.length; index++) {
      const issue = group[index]
      const tag = index === 0 ? '[KEEP]   ' : '[ARCHIVE]'
      const date = issue.createdAt.slice(0, 10)
      console.log(`    ${tag} ${issue.identifier.padEnd(10)} ${date}  ${issue.title}`)
    }
    console.log()
  }

  const toArchive = duplicateGroups.flatMap(({ group }) => group.slice(1))
  console.log(`${toArchive.length} issue(s) would be archived.`)
  console.log(`Run linear-dedup-clean.mjs --confirm to apply.`)
}

main().catch((err) => {
  console.error('\n✗', err.message)
  process.exit(1)
})
