#!/usr/bin/env node
'use strict'

// Turns a recording from record-hook.js into a fixture: the payload alone, with ids and machine details replaced by
// placeholders in the style of tests/fixtures/claude-code-hooks/. Usage:
//   node sanitize-fixture.js <recording.json> <scratch folder> <fixture.json>

const fs = require('fs')
const os = require('os')

const FIXTURE_HOME = '/Users/dev'
const FIXTURE_PROJECT = '/Users/dev/api'
const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi
const EMAIL_PATTERN = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
// Fields whose value is an id, a private path or terminal output (which can hold the user's prompt, and so their name),
// so the key itself names the placeholder. An empty value stays empty, because being empty is itself a finding
const PLACEHOLDER_KEYS = new Set([
  'artifactDirectoryPath',
  'conversationId',
  'session_id',
  'sessionId',
  'tool_response',
  'tool_use_id',
  'toolUseId',
  'transcript_path',
  'transcriptPath',
])

/** macOS reports a temp folder as both /tmp/x and /private/tmp/x, and a payload may hold either. */
function spellingsOf(folder) {
  const withoutPrivate = folder.replace(/^\/private\//, '/')
  return [`/private${withoutPrivate}`, withoutPrivate]
}

function sanitizeString(text, { scratchFolder, homeFolder, hostName }) {
  const withoutScratch = spellingsOf(scratchFolder).reduce(
    (current, spelling) => current.split(spelling).join(FIXTURE_PROJECT),
    text
  )
  return withoutScratch
    .split(homeFolder)
    .join(FIXTURE_HOME)
    .split(hostName)
    .join('<hostname>')
    .replace(UUID_PATTERN, '<uuid>')
    .replace(EMAIL_PATTERN, '<email>')
}

function sanitizeValue(value, machine) {
  if (typeof value === 'string') return sanitizeString(value, machine)
  if (Array.isArray(value)) return value.map((item) => sanitizeValue(item, machine))
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      PLACEHOLDER_KEYS.has(key) && typeof item === 'string' && item !== '' ? `<${key}>` : sanitizeValue(item, machine),
    ])
  )
}

/** The fixture for a recorded payload. `machine` names what identifies the run: scratchFolder, homeFolder, hostName. */
function sanitizePayload(payload, machine) {
  return sanitizeValue(payload, machine)
}

function main() {
  const [recordingPath, scratchFolder, fixturePath] = process.argv.slice(2)
  const recording = JSON.parse(fs.readFileSync(recordingPath, 'utf8'))
  const machine = { scratchFolder, homeFolder: os.homedir(), hostName: os.hostname() }
  fs.writeFileSync(fixturePath, `${JSON.stringify(sanitizePayload(recording.payload, machine), null, 2)}\n`)
}

if (require.main === module) main()

module.exports = { sanitizePayload }
