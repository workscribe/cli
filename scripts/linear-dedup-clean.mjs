#!/usr/bin/env node
// Usage:
//   node scripts/linear-dedup-clean.mjs            # dry run — shows what would be archived
//   node scripts/linear-dedup-clean.mjs --confirm  # archives the duplicates

const API_KEY = 'lin_api_usguv1LoLJKtwCVvtLHM13B74xLBbaIPvOtqY8TY'
const ENDPOINT = 'https://api.linear.app/graphql'
const DRY_RUN = !process.argv.includes('--confirm')

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

async function archiveIssue(id) {
  const data = await gql(
    `mutation($id: String!) {
      issueArchive(id: $id) {
        success
      }
    }`,
    { id }
  )
  if (!data.issueArchive.success) throw new Error(`Archive mutation returned success: false for id ${id}`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main() {
  if (DRY_RUN) {
    console.log('DRY RUN — pass --confirm to apply changes\n')
  }

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
      group: [...group].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
    }))

  if (duplicateGroups.length === 0) {
    console.log('✓ No duplicates found. Nothing to do.')
    return
  }

  const toArchive = duplicateGroups.flatMap(({ group }) => group.slice(1))

  console.log(`Found ${duplicateGroups.length} duplicate group(s) — ${toArchive.length} issue(s) to archive:\n`)

  for (const { key, group } of duplicateGroups) {
    console.log(`  "${key}"`)
    for (let index = 0; index < group.length; index++) {
      const issue = group[index]
      const tag = index === 0 ? '  KEEP   ' : '  ARCHIVE'
      const date = issue.createdAt.slice(0, 10)
      console.log(`   ${tag}  ${issue.identifier.padEnd(10)} ${date}  ${issue.title}`)
    }
    console.log()
  }

  if (DRY_RUN) {
    console.log(`Run with --confirm to archive ${toArchive.length} issue(s).`)
    return
  }

  console.log(`Archiving ${toArchive.length} issue(s)…\n`)
  let archived = 0
  for (const issue of toArchive) {
    try {
      await archiveIssue(issue.id)
      console.log(`  ✓ Archived  ${issue.identifier.padEnd(10)} ${issue.title}`)
      archived++
    } catch (error) {
      console.error(`  ✗ Failed    ${issue.identifier.padEnd(10)} ${issue.title} — ${error.message}`)
    }
    await sleep(300)
  }

  console.log(`\n✓ Done — ${archived}/${toArchive.length} issue(s) archived.`)
}

main().catch((err) => {
  console.error('\n✗', err.message)
  process.exit(1)
})
